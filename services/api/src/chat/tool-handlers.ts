// services/api/src/chat/tool-handlers.ts
//
// Chat Pipeline Stage 7 — Tool Handlers.
//
// Ten thin wrappers around existing API services. Each handler calls the same
// underlying service as its corresponding HTTP endpoint. Handlers NEVER
// generate content directly — they call services that may use the LLM.
//
// Return shape: Omit<ToolExecutionResult, 'tool' | 'durationMs'>
// The router stamps `tool` and `durationMs` before returning to the pipeline.

import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { recommendTemplate } from '../templates/template-recommendation.service.js';
import {
  spawnProposalGenerator,
  type ProcessorPayload,
} from '@ai-engine/plugin-proposal-generator';
import { retrieveProposalContext } from '../proposals/proposal-rag.js';
import { queryKnowledgeBase, type VectorStoreConfig } from '@ai-engine/runtime';
import type { GenerateFn } from '@ai-engine/planner';
import {
  readMeta,
  writeMeta,
  ensureMeta,
  validateTransition,
  type ProposalStatus,
} from '../proposal-meta.js';
import { createVersionFromEdit } from '../proposals/proposal-version.service.js';
import { resolvePolicy, executeWithPolicy, type ProviderPolicyConfig } from '../provider-policy.js';
import type { ToolName } from './planner.js';
import { listSkills as listSkillsFromDisk, createSkill, loadSkill } from '../skills/skill.service.js';
import { generateSkillFromDescription } from '../skills/skill-generator.js';
import { listDesignSkills as listDesignSkillsFromDisk, getDesignSkill } from '../skills/design-skill.service.js';
import type { DesignSkill } from '../skills/design-skill.types.js';
import { buildDesignPromptFromSkill, generateThemeCSSTokens, generateSectionHtml, CUSTOM_HTML_SECTION_TYPES, type CSSTheme, type Tone } from '../skills/design-skill-microsite.js';
import { generateStructuredMicrosite, assignSectionIds } from '../presentation/structured-microsite-generator.js';
import { ContextService } from './context.service.js';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// CSS token cache (shared with presentation-routes logic)
// ---------------------------------------------------------------------------

const CSS_TOKEN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function getCachedCSSTokens(
  cacheDir: string,
  tone: string,
  brandPrimaryColor: string | undefined,
  generateFn: (prompt: string) => Promise<string>,
  clientIndustry: string | undefined,
  designPromptOverride: string | undefined,
): Promise<CSSTheme | null> {
  const keySource = [tone, brandPrimaryColor ?? '', clientIndustry ?? '', designPromptOverride ?? ''].join('::');
  const key       = crypto.createHash('md5').update(keySource).digest('hex');
  const cachePath = path.join(cacheDir, `${key}.json`);

  try {
    const s = await stat(cachePath);
    if (Date.now() - s.mtimeMs < CSS_TOKEN_CACHE_TTL_MS) {
      const theme = JSON.parse(await readFile(cachePath, 'utf-8')) as CSSTheme;
      console.log(`[css-cache] HIT  tone="${tone}" key=${key.slice(0, 8)}`);
      return theme;
    }
  } catch { /* cache miss */ }

  const theme = await generateThemeCSSTokens(tone, brandPrimaryColor, generateFn, clientIndustry, designPromptOverride);
  if (theme) {
    try {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(cachePath, JSON.stringify(theme), 'utf-8');
      console.log(`[css-cache] MISS tone="${tone}" key=${key.slice(0, 8)} — stored`);
    } catch { /* non-fatal */ }
  }
  return theme;
}

// ---------------------------------------------------------------------------
// Base design skill — used when no explicit skill is requested from chat
// ---------------------------------------------------------------------------

const BASE_DESIGN_SKILL: DesignSkill = {
  slug: 'base-default',
  displayName: 'Base Default',
  description: 'Clean, professional default for any proposal type.',
  aestheticTone: 'luxury/refined',
  colorPalette: {
    primary: '#2563EB',
    secondary: '#1E40AF',
    background: '#FFFFFF',
  },
  typography: {
    headingFont: 'Raleway',
    bodyFont: 'DM Sans',
    headingStyle: 'bold',
  },
  animations: 'minimal',
  customInstructions: '',
  themeClass: 'light',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ActionCard {
  type: string;
  label: string;
  href: string;
}

export interface ToolExecutionResult {
  tool: ToolName;
  success: boolean;
  data?: unknown;
  message: string;
  artifacts?: string[];
  actionCards?: ActionCard[];
  durationMs: number;
}

export interface ToolContext {
  workdir: string;
  namespace: string;
  generateFn: GenerateFn;
  policyConfig?: ProviderPolicyConfig | null;
  vectorStoreConfig?: VectorStoreConfig;
}

// ---------------------------------------------------------------------------
// Path helpers (mirror proposal-routes.ts conventions)
// ---------------------------------------------------------------------------

function proposalDir(workdir: string, namespace: string): string {
  return path.join(workdir, 'namespaces', namespace, 'proposals');
}

function templateDir(workdir: string): string {
  return path.join(workdir, 'data', 'templates');
}

function resolveProposalPath(fileName: string, workdir: string, namespace: string): string {
  const sep = fileName.indexOf('::');
  if (sep !== -1) {
    const ns = fileName.slice(0, sep);
    const file = fileName.slice(sep + 2);
    return path.join(workdir, 'namespaces', ns, 'proposals', file);
  }
  return path.join(workdir, 'namespaces', namespace, 'proposals', fileName);
}

function bareFileName(namespacedOrPlain: string): string {
  const sep = namespacedOrPlain.indexOf('::');
  return sep !== -1 ? namespacedOrPlain.slice(sep + 2) : namespacedOrPlain;
}

// ---------------------------------------------------------------------------
// Markdown section helpers (same logic as POST /chat/proposal/section/edit)
// ---------------------------------------------------------------------------

interface ParsedSection {
  heading: string;
  content: string;
}

function parseMarkdownSections(markdown: string): ParsedSection[] {
  const lines = markdown.split('\n');
  const sections: ParsedSection[] = [];
  let currentHeading = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      sections.push({ heading: currentHeading, content: currentLines.join('\n').trim() });
      currentHeading = headingMatch[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  sections.push({ heading: currentHeading, content: currentLines.join('\n').trim() });
  return sections;
}

function assembleSections(sections: ParsedSection[]): string {
  return (
    sections
      .map((s) => (s.heading ? `## ${s.heading}\n\n${s.content}` : s.content))
      .join('\n\n')
      .trim() + '\n'
  );
}

// ---------------------------------------------------------------------------
// Template YAML helpers (same logic as template-creation.handlers.ts)
// ---------------------------------------------------------------------------

interface TemplateSectionDraft {
  title: string;
  query: string;
  instruction: string;
}

interface TemplateDraft {
  name: string;
  description: string;
  sections: TemplateSectionDraft[];
}

function buildTemplateYaml(draft: TemplateDraft, version = '1.0'): string {
  const doc = {
    name: draft.name,
    version,
    description: draft.description.trim(),
    sections: draft.sections.map((s) => ({
      title: s.title,
      query: s.query.trim(),
      instruction: s.instruction.trim(),
    })),
  };
  return yaml.dump(doc, { lineWidth: 120, quotingType: '"', forceQuotes: false });
}

function parseTemplateDraft(raw: string): TemplateDraft | null {
  const jsonMatch =
    raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[1]) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).name !== 'string' ||
      !Array.isArray((parsed as Record<string, unknown>).sections)
    ) {
      return null;
    }
    return parsed as TemplateDraft;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Partial result type (router stamps tool + durationMs)
// ---------------------------------------------------------------------------

type PartialResult = Omit<ToolExecutionResult, 'tool' | 'durationMs'>;

// ---------------------------------------------------------------------------
// 1. generate_proposal
//    Mirrors POST /generate-proposal → spawnProposalGenerator
// ---------------------------------------------------------------------------

export async function handleGenerateProposal(
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PartialResult> {
  const client = ((params.client as string | undefined) ?? '').trim();
  const clientIndustry = ((params.clientIndustry as string | undefined) ?? 'General').trim();
  const projectType = ((params.projectType as string | undefined) ?? '').trim();
  const industry = clientIndustry; // processor payload field name kept for compatibility
  const template = ((params.template as string | undefined) ?? 'default').trim();
  const skillSlug = ((params.skill as string | undefined) ?? '').trim();
  const { workdir, namespace, policyConfig, generateFn } = ctx;

  // Load skill context if specified
  let skillTone: string | null = null;
  let skillMemoryLessons: string[] = [];
  if (skillSlug) {
    try {
      const loaded = await loadSkill(workdir, skillSlug);
      skillTone = loaded.skill.toneDescription || null;
      skillMemoryLessons = [
        `SKILL INSTRUCTIONS:\n${loaded.instructionsMd}`,
        ...loaded.sections.map((s) => `SECTION HINT [${s.title}]: ${s.promptHint}`),
      ];
    } catch {
      // Skill not found — proceed without skill context
    }
  }

  // Auto-generate a missing template rather than letting Python fail.
  const tplDir = templateDir(workdir);
  const tplFilePath = path.join(tplDir, `${template}.yaml`);
  try {
    await stat(tplFilePath);
  } catch {
    // Template file not found — generate one via LLM and save it at the
    // exact path the Python processor expects, so this and future calls succeed.
    const displayName =
      template === 'default'
        ? `${(projectType || clientIndustry).replace(/\b\w/g, (c) => c.toUpperCase())} Proposal`
        : template.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    const description = `A ${projectType || industry} proposal template${client ? ` for ${client}` : ''}${clientIndustry !== 'General' ? ` in the ${clientIndustry} industry` : ''}.`;

    const autoGenPrompt = [
      'You are a proposal architect. Generate a reusable proposal template structure.',
      '',
      `Template description: ${description}`,
      '',
      'Output a single JSON object:',
      '```json',
      '{',
      '  "name": "<human-readable template name>",',
      '  "description": "<one-sentence description of when to use this template>",',
      '  "sections": [',
      '    {',
      '      "title": "<section heading>",',
      '      "query": "<RAG search phrase for this section>",',
      '      "instruction": "<LLM writing instruction for this section>"',
      '    }',
      '  ]',
      '}',
      '```',
      '',
      'Requirements:',
      '- Include 6–10 sections covering the template purpose',
      '- Professional, proposal-appropriate section titles',
      `- Use the display name: "${displayName}"`,
      '- Output ONLY the JSON block — no explanation',
    ].join('\n');

    const raw = await generateFn(autoGenPrompt);
    const draft = parseTemplateDraft(raw);

    if (draft) {
      draft.name = displayName;
      await mkdir(tplDir, { recursive: true });
      await writeFile(tplFilePath, buildTemplateYaml(draft), 'utf-8');
    }
    // If LLM failed to produce a valid draft, fall through and let
    // spawnProposalGenerator surface its own error with full context.
  }

  const outputDir = proposalDir(workdir, namespace);
  await mkdir(outputDir, { recursive: true });

  const retrievedContext = await retrieveProposalContext(workdir, namespace, client, industry);

  const payload: ProcessorPayload = {
    workdir,
    outputDir,
    client,
    industry,
    namespace,
    template,
    templateDir: templateDir(workdir),
    overwrite: false,
    pricing: null,
    tone: skillTone,
    memory: skillMemoryLessons.length > 0
      ? { pastLessons: skillMemoryLessons, avoidPhrases: [] }
      : null,
    retrievedContext,
  };

  let doc: Awaited<ReturnType<typeof spawnProposalGenerator>>;

  if (policyConfig) {
    const policy = resolvePolicy(policyConfig, namespace, 'query');
    const { result } = await executeWithPolicy(policy, () => spawnProposalGenerator(payload));
    doc = result;
  } else {
    doc = await spawnProposalGenerator(payload);
  }

  const m = doc.metadata as Record<string, unknown>;
  const outputFile = (m.output_file ?? m.output_path) as string | undefined;
  const fileName = outputFile
    ? path.basename(outputFile)
    : `${client.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 100)}_proposal.md`;

  if (outputFile) {
    await ensureMeta(outputFile);
    // Version snapshot (fire-and-forget)
    void createVersionFromEdit(
      workdir,
      namespace,
      fileName,
      doc.content,
      null,
      'system',
      `Generated proposal for "${client}"`,
    ).catch(() => { /* non-fatal */ });
  }

  const namespacedFile = `${namespace}::${fileName}`;

  return {
    success: true,
    message: `Proposal for "${client}" generated successfully.`,
    data: { fileName: namespacedFile, client, projectType, clientIndustry, template, skill: skillSlug || undefined },
    artifacts: [namespacedFile],
    actionCards: [
      {
        type: 'view_proposal',
        label: 'View Proposal',
        href: `/proposal?artifact=${encodeURIComponent(fileName)}&namespace=${encodeURIComponent(namespace)}&from=chat`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 2. edit_proposal_section
//    Mirrors POST /chat/proposal/section/edit → readFile + LLM rewrite + writeFile
// ---------------------------------------------------------------------------

export async function handleEditProposalSection(
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PartialResult> {
  const proposalFileName = ((params.proposalFileName as string | undefined) ?? '').trim();
  const sectionName = ((params.sectionName as string | undefined) ?? '').trim();
  const instruction = ((params.instruction as string | undefined) ?? '').trim();
  const { workdir, namespace, generateFn } = ctx;

  const filePath = resolveProposalPath(proposalFileName, workdir, namespace);

  let markdown: string;
  try {
    markdown = await readFile(filePath, 'utf-8');
  } catch {
    return { success: false, message: `Proposal not found: "${proposalFileName}"` };
  }

  const parsed = parseMarkdownSections(markdown);
  const target = parsed.find(
    (s) => s.heading.toLowerCase() === sectionName.toLowerCase(),
  );
  if (!target) {
    return { success: false, message: `Section not found: "${sectionName}"` };
  }

  const editPrompt = [
    `You are rewriting the **${target.heading}** section of a proposal.`,
    '',
    'Original section content:',
    target.content,
    '',
    'User instruction:',
    instruction,
    '',
    'Rules:',
    '- Apply the instruction precisely to this section only',
    '- Output ONLY the new section body — no heading, no commentary',
    '- Maintain professional, persuasive tone',
  ].join('\n');

  const updatedContent = await generateFn(editPrompt);

  const updatedSections = parsed.map((s) =>
    s.heading === target.heading ? { ...s, content: updatedContent.trim() } : s,
  );
  const updatedMarkdown = assembleSections(updatedSections);
  await writeFile(filePath, updatedMarkdown, 'utf-8');

  // Version snapshot (fire-and-forget)
  void createVersionFromEdit(
    workdir,
    namespace,
    bareFileName(proposalFileName),
    updatedMarkdown,
    null,
    'user',
    `Edited via chat: ${instruction.slice(0, 80)}`,
  ).catch(() => { /* non-fatal */ });

  return {
    success: true,
    message: `Section "${sectionName}" updated successfully.`,
    data: { proposalFileName, sectionName, updatedContent: updatedContent.trim() },
    actionCards: [
      {
        type: 'view_proposal',
        label: 'View Proposal',
        href: `/proposal?artifact=${encodeURIComponent(bareFileName(proposalFileName))}&namespace=${encodeURIComponent(namespace)}&from=chat`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 3. generate_microsite
// ---------------------------------------------------------------------------

export async function handleGenerateMicrosite(
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PartialResult> {
  const proposalFileName = ((params.proposalFileName as string | undefined) ?? '').trim();
  const designSkillSlug  = (params.designSkillSlug as string | undefined) ?? null;
  const { workdir, namespace, generateFn } = ctx;

  const filePath = resolveProposalPath(proposalFileName, workdir, namespace);
  let proposalContent: string;
  try {
    proposalContent = await readFile(filePath, 'utf-8');
  } catch {
    return { success: false, message: `Proposal not found: "${proposalFileName}"` };
  }

  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  const model  = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
  if (!apiKey) return { success: false, message: 'ANTHROPIC_API_KEY is not configured.' };

  // Load brand context from context.json
  let brandHint: { companyName?: string; industry?: string; clientName?: string; primaryColor?: string } = {};
  let clientIndustry = '';
  try {
    const ctxSvc = new ContextService(workdir);
    const ctx2 = await ctxSvc.get(namespace);
    const fields = (ctx2?.requirements as { fields?: Record<string, { value?: unknown }> } | undefined)?.fields ?? {};
    brandHint = {
      companyName: (fields.clientName?.value as string | undefined) ?? '',
      clientName:  (fields.clientName?.value as string | undefined) ?? '',
      industry:    (fields.clientIndustry?.value as string | undefined) ?? '',
    };
    clientIndustry = brandHint.industry ?? '';
  } catch { /* non-fatal */ }

  // Resolve skill: explicit slug → disk (fallback to BASE_DESIGN_SKILL on miss), no slug → BASE_DESIGN_SKILL
  let skill: DesignSkill = BASE_DESIGN_SKILL;
  if (designSkillSlug) {
    try {
      skill = await getDesignSkill(workdir, designSkillSlug);
    } catch { /* skill not found — use base */ }
  }

  const built = buildDesignPromptFromSkill(skill);
  const skillTone = built.tone;
  const designPromptOverride: string | undefined = built.prompt || undefined;

  if (skill.colorPalette.primary && !brandHint.primaryColor) {
    brandHint = { ...brandHint, primaryColor: skill.colorPalette.primary };
  }

  // Phase 1 + CSS in parallel. CSS tokens are cached by skill slug/tone so repeat
  // generations skip the Sonnet call entirely.
  const proposalId = proposalFileName.replace(/\.md$/i, '');
  const cacheDir   = path.join(workdir, 'cache', 'css-tokens');
  const [ast, cssTheme] = await Promise.all([
    generateStructuredMicrosite(proposalContent, brandHint, proposalId, apiKey, model),
    getCachedCSSTokens(cacheDir, skillTone, brandHint.primaryColor, generateFn, clientIndustry, designPromptOverride).catch(() => null),
  ]);

  ast.sections = assignSectionIds(ast.sections);

  const astRaw = ast as unknown as Record<string, unknown>;

  // Inject CSS theme into brand so colours/fonts render via CSS variables.
  if (cssTheme) {
    astRaw.brand = {
      ...(ast.brand ?? {}),
      extractedCssVariables: cssTheme.cssVars,
      overrideTheme: true,
      ...(cssTheme.googleFontsUrl ? { googleFontsUrl: cssTheme.googleFontsUrl } : {}),
      ...(cssTheme.fontFaceDeclarations ? { fontFaceDeclarations: cssTheme.fontFaceDeclarations } : {}),
    };
  }

  astRaw.plugin = designSkillSlug ?? skill.slug;

  const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast-chat.json');
  await mkdir(path.dirname(astPath), { recursive: true });
  await writeFile(astPath, JSON.stringify(ast, null, 2), 'utf-8');

  // Phase 3 — generate per-section custom HTML using the main model (Sonnet).
  // Runs in the background so the chat response is returned immediately.
  // Re-writes site-ast.json when all sections are done.
  if (cssTheme) {
    const capturedAst = ast;
    const capturedAstPath = astPath;
    const capturedTone = skillTone as Tone;
    const capturedOverride = designPromptOverride ?? null;
    const capturedCssVars = cssTheme.cssVars;

    void (async () => {
      try {
        const sectionsAsRecords = capturedAst.sections as unknown as Record<string, unknown>[];
        const targets = sectionsAsRecords.filter(s => CUSTOM_HTML_SECTION_TYPES.has(s.sectionType as string));
        const CONCURRENCY = 4;
        let cursor = 0;

        async function htmlWorker() {
          while (cursor < targets.length) {
            const section = targets[cursor++];
            const idx = sectionsAsRecords.indexOf(section);
            try {
              section.customHtml = await generateSectionHtml(
                section,
                capturedTone,
                capturedCssVars,
                null,
                generateFn,
                idx,
                capturedOverride ?? undefined,
              );
            } catch { /* non-fatal — section falls back to generic layout */ }
          }
        }

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => htmlWorker()));
        await writeFile(capturedAstPath, JSON.stringify(capturedAst, null, 2), 'utf-8');
      } catch { /* non-fatal background task */ }
    })();
  }

  const usedSkillLabel = designSkillSlug ? `design skill "${designSkillSlug}"` : 'base design theme';
  return {
    success: true,
    message: `Presentation microsite generated from "${proposalFileName}" using ${usedSkillLabel}.`,
    data: { namespace, proposalFileName, designSkillSlug: designSkillSlug ?? skill.slug, hasAst: true },
    actionCards: [
      {
        type: 'view_microsite',
        label: 'View Presentation',
        href: `/presentation?ns=${encodeURIComponent(namespace)}`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 4. generate_template
//    Mirrors POST /templates/:name — LLM generates structure, writes YAML
// ---------------------------------------------------------------------------

export async function handleGenerateTemplate(
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PartialResult> {
  const description = ((params.description as string | undefined) ?? '').trim();
  const displayName = ((params.name as string | undefined) ?? 'Custom Template').trim();
  const { workdir, generateFn } = ctx;

  const prompt = [
    'You are a proposal architect. Generate a reusable proposal template structure.',
    '',
    `Template description: ${description}`,
    '',
    'Output a single JSON object:',
    '```json',
    '{',
    '  "name": "<human-readable template name>",',
    '  "description": "<one-sentence description of when to use this template>",',
    '  "sections": [',
    '    {',
    '      "title": "<section heading>",',
    '      "query": "<RAG search phrase for this section>",',
    '      "instruction": "<LLM writing instruction for this section>"',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    'Requirements:',
    '- Include 6–10 sections covering the template purpose',
    '- Professional, proposal-appropriate section titles',
    `- Use the display name: "${displayName}"`,
    '- Output ONLY the JSON block — no explanation',
  ].join('\n');

  const raw = await generateFn(prompt);
  const draft = parseTemplateDraft(raw);

  if (!draft) {
    return {
      success: false,
      message: 'Failed to generate a valid template structure. Please try with a more specific description.',
    };
  }

  draft.name = displayName;

  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const yamlContent = buildTemplateYaml(draft);
  const tplDir = templateDir(workdir);
  await mkdir(tplDir, { recursive: true });
  const filePath = path.join(tplDir, `${slug}.yaml`);
  await writeFile(filePath, yamlContent, 'utf-8');

  return {
    success: true,
    message: `Template "${displayName}" created successfully.`,
    data: { name: displayName, slug, sections: draft.sections.map((s) => s.title) },
    artifacts: [`${slug}.yaml`],
    actionCards: [
      { type: 'view_templates', label: 'View Templates', href: '/proposal/templates' },
    ],
  };
}

// ---------------------------------------------------------------------------
// 5. modify_template
//    Mirrors POST /templates/:name (create-or-update) with LLM-guided modification
// ---------------------------------------------------------------------------

export async function handleModifyTemplate(
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PartialResult> {
  const templateName = ((params.templateName as string | undefined) ?? '').trim();
  const instruction = ((params.instruction as string | undefined) ?? '').trim();
  const { workdir, generateFn } = ctx;

  const slug = templateName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const tplDir = templateDir(workdir);
  const filePath = path.join(tplDir, `${slug}.yaml`);

  let existingContent: string;
  try {
    existingContent = await readFile(filePath, 'utf-8');
  } catch {
    return { success: false, message: `Template not found: "${templateName}"` };
  }

  const prompt = [
    `You are modifying the template "${templateName}".`,
    '',
    'Existing template YAML:',
    existingContent,
    '',
    'Modification instruction:',
    instruction,
    '',
    'Return the complete updated template as a JSON object:',
    '```json',
    '{',
    '  "name": "...",',
    '  "description": "...",',
    '  "sections": [{ "title": "...", "query": "...", "instruction": "..." }]',
    '}',
    '```',
    '',
    'Output ONLY the JSON block — no explanation.',
  ].join('\n');

  const raw = await generateFn(prompt);
  const draft = parseTemplateDraft(raw);

  if (!draft) {
    return {
      success: false,
      message: `Failed to apply modifications to template "${templateName}".`,
    };
  }

  const yamlContent = buildTemplateYaml(draft);
  await writeFile(filePath, yamlContent, 'utf-8');

  return {
    success: true,
    message: `Template "${templateName}" updated successfully.`,
    data: { templateName, slug, sections: draft.sections.map((s) => s.title) },
    artifacts: [`${slug}.yaml`],
  };
}

// ---------------------------------------------------------------------------
// 6. search_documents
//    Mirrors GET /agent/run with search-documents tool → queryKnowledgeBase
// ---------------------------------------------------------------------------

export async function handleSearchDocuments(
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PartialResult> {
  const query = ((params.query as string | undefined) ?? '').trim();
  const { workdir, namespace, vectorStoreConfig } = ctx;

  const result = await queryKnowledgeBase({
    question: query,
    storageDir: path.join(workdir, 'namespaces', namespace),
    namespace,
    ...(vectorStoreConfig ? { vectorStoreConfig } : {}),
  });

  return {
    success: true,
    message: result.answer ?? 'No relevant documents found.',
    data: { query, answer: result.answer },
  };
}

// ---------------------------------------------------------------------------
// 7. list_proposals
//    Mirrors GET /proposals — scans namespace proposals directory
// ---------------------------------------------------------------------------

export async function handleListProposals(
  _params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PartialResult> {
  const { workdir, namespace } = ctx;
  const dir = proposalDir(workdir, namespace);

  let files: string[] = [];
  try {
    const entries = await readdir(dir);
    files = entries.filter((f) => f.endsWith('.md') && !f.startsWith('.'));
  } catch {
    // Directory doesn't exist yet — return empty list
  }

  const proposals = await Promise.all(
    files.map(async (file) => {
      const filePath = path.join(dir, file);
      const [fileStat, meta] = await Promise.all([
        stat(filePath).catch(() => null),
        readMeta(filePath).catch(() => null),
      ]);
      const match = file.match(/^(.+)_proposal(?:_v(\d+))?\.md$/);
      return {
        fileName: `${namespace}::${file}`,
        client: match ? match[1].replace(/_/g, ' ') : file.replace(/\.md$/, ''),
        status: meta?.status ?? null,
        createdAt: fileStat?.mtime.toISOString() ?? null,
      };
    }),
  );

  proposals.sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  );

  if (proposals.length === 0) {
    return { success: true, message: 'No proposals found in this namespace.', data: { proposals } };
  }

  const lines = proposals.map((p) => {
    const parts = [`- **${p.client}**`];
    if (p.status) parts.push(`(${p.status})`);
    if (p.createdAt) parts.push(`— created ${p.createdAt.slice(0, 10)}`);
    return parts.join(' ');
  });
  return {
    success: true,
    message: `Found ${proposals.length} proposal${proposals.length !== 1 ? 's' : ''}:\n\n${lines.join('\n')}`,
    data: { proposals },
  };
}

// ---------------------------------------------------------------------------
// 8. list_templates
//    Mirrors GET /templates — reads YAML files from template directory
// ---------------------------------------------------------------------------

export async function handleListTemplates(
  _params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PartialResult> {
  const { workdir } = ctx;
  const tplDir = templateDir(workdir);

  let templates: Array<{ id: string; name: string; description: string }> = [];
  try {
    const entries = await readdir(tplDir);
    const yamlFiles = entries
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();

    templates = await Promise.all(
      yamlFiles.map(async (file) => {
        const raw = await readFile(path.join(tplDir, file), 'utf-8').catch(() => '');
        const parsed = raw ? (yaml.load(raw) as Record<string, unknown>) : {};
        const id = path.basename(file, path.extname(file));
        return {
          id,
          name: (parsed.name as string) ?? id,
          description: (parsed.description as string) ?? '',
        };
      }),
    );
  } catch {
    // Template directory doesn't exist — return empty list
  }

  if (templates.length === 0) {
    return { success: true, message: 'No templates found.', data: { templates } };
  }

  const lines = templates.map(
    (t) => `- **${t.name}** (\`${t.id}\`)${t.description ? `: ${t.description}` : ''}`,
  );
  return {
    success: true,
    message: `Found ${templates.length} template${templates.length !== 1 ? 's' : ''}:\n\n${lines.join('\n')}`,
    data: { templates },
  };
}

// ---------------------------------------------------------------------------
// 9. get_proposal_status
//    Mirrors GET /proposals/:fileName/meta → readMeta
// ---------------------------------------------------------------------------

export async function handleGetProposalStatus(
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PartialResult> {
  const proposalFileName = ((params.proposalFileName as string | undefined) ?? '').trim();
  const { workdir, namespace } = ctx;

  const filePath = resolveProposalPath(proposalFileName, workdir, namespace);
  const meta = await readMeta(filePath);

  if (!meta) {
    return {
      success: false,
      message: `No metadata found for "${proposalFileName}". The proposal may not exist.`,
    };
  }

  return {
    success: true,
    message: `Proposal "${proposalFileName}" is currently **${meta.status}**.`,
    data: {
      proposalFileName,
      status: meta.status,
      lockedSections: meta.lockedSections,
      updatedAt: meta.updatedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// 10. set_proposal_status
//     Mirrors POST /proposals/:fileName/set-status → validateTransition + writeMeta
// ---------------------------------------------------------------------------

export async function handleSetProposalStatus(
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PartialResult> {
  const proposalFileName = ((params.proposalFileName as string | undefined) ?? '').trim();
  const newStatus = ((params.status as string | undefined) ?? '').trim() as ProposalStatus;
  const { workdir, namespace } = ctx;

  if (!newStatus) {
    return { success: false, message: 'Missing required param: status' };
  }

  const filePath = resolveProposalPath(proposalFileName, workdir, namespace);

  let meta;
  try {
    meta = await ensureMeta(filePath);
  } catch {
    return { success: false, message: `Proposal not found: "${proposalFileName}"` };
  }

  if (!validateTransition(meta.status, newStatus)) {
    const validNext = (['draft', 'under_review', 'approved', 'finalized'] as ProposalStatus[])
      .filter((s) => validateTransition(meta.status, s))
      .join(', ') || 'none';
    return {
      success: false,
      message: `Cannot transition from "${meta.status}" to "${newStatus}". Valid next statuses: ${validNext}.`,
    };
  }

  meta.status = newStatus;
  await writeMeta(filePath, meta);

  return {
    success: true,
    message: `Proposal "${proposalFileName}" status updated to **${newStatus}**.`,
    data: { proposalFileName, status: newStatus },
    actionCards: [
      {
        type: 'view_proposal',
        label: 'View Proposal',
        href: `/proposal?artifact=${encodeURIComponent(bareFileName(proposalFileName))}&namespace=${encodeURIComponent(namespace)}&from=chat`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 11. recommend_template
//     Surfaces the template recommendation engine to the planner/chat.
//     Returns the best matching template or fallback-generate signal.
// ---------------------------------------------------------------------------

export async function handleRecommendTemplate(
  _params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PartialResult> {
  const { workdir, namespace } = ctx;

  // Load namespace context to build the recommendation context
  let nsContext: import('./context.types.js').NamespaceContext | null = null;
  try {
    const { readFile: rf } = await import('node:fs/promises');
    const raw = await rf(path.join(workdir, 'namespaces', namespace, 'context.json'), 'utf-8');
    nsContext = JSON.parse(raw) as import('./context.types.js').NamespaceContext;
  } catch {
    return { success: false, message: 'No context found. Please ingest documents first.' };
  }

  const fields = nsContext?.requirements?.fields ?? {};
  const knowledge = nsContext?.knowledge ?? [];

  const recContext = {
    requirementMatrix: {
      functional: knowledge.filter((k) => !k.supersededBy && ['requirement', 'priority', 'action_item'].includes(k.category)).map((k) => k.content).slice(0, 10),
      compliance: knowledge.filter((k) => !k.supersededBy && k.category === 'constraint').map((k) => k.content).slice(0, 5),
      timeline: fields.timeline?.value ? [String(fields.timeline.value)] : [],
      pricing: fields.budget?.value ? [String(fields.budget.value)] : [],
    },
    detectedIndustry: fields.clientIndustry?.value ? String(fields.clientIndustry.value) : undefined,
    keyCapabilities: [],
    namespace,
  };

  let recommendation;
  try {
    recommendation = await recommendTemplate(recContext, workdir);
  } catch (err) {
    return { success: false, message: `Template recommendation failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (recommendation.fallbackGenerate) {
    return {
      success: true,
      message: `No existing template is a strong match. ${recommendation.reasoning}\n\nI can generate a custom template tailored to your project. Reply "generate custom template" to proceed.`,
      data: { fallbackGenerate: true, confidence: recommendation.confidence },
    };
  }

  const template = recommendation.template!;
  const pct = Math.round(recommendation.confidence * 100);
  const sections = template.structure.join(', ');

  return {
    success: true,
    message: `I recommend the **${template.name}** template (${pct}% match).\n\n${recommendation.reasoning}\n\n**Sections:** ${sections}`,
    data: {
      templateId: template.id,
      templateName: template.name,
      confidence: recommendation.confidence,
      sections: template.structure,
    },
    actionCards: [
      {
        type: 'view_template',
        label: 'View Template',
        href: `/template?artifact=${encodeURIComponent(template.id + '.yaml')}&namespace=${encodeURIComponent(namespace)}&from=chat`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 12. create_skill
//     Generates a new skill from a natural-language description and saves it.
// ---------------------------------------------------------------------------

export async function handleCreateSkill(
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PartialResult> {
  const description = ((params.description as string | undefined) ?? '').trim();
  if (!description) {
    return { success: false, message: 'A description is required to create a skill.' };
  }

  const { workdir, generateFn } = ctx;

  let generated;
  try {
    generated = await generateSkillFromDescription(description, generateFn);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Failed to generate skill: ${msg}` };
  }

  const slug = generated.displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'new-skill';

  try {
    await createSkill(workdir, {
      slug,
      displayName: generated.displayName,
      description: generated.description,
      industries: generated.industries,
      projectTypes: generated.projectTypes,
      tags: generated.tags,
      toneDescription: generated.toneDescription,
      micrositeDefaults: generated.micrositeDefaults ?? {},
      pricingDefaults: generated.pricingDefaults,
      scope: 'global',
      author: 'chat',
      version: '1.0',
      instructionsMd: generated.instructions,
      sections: generated.sections,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Failed to save skill: ${msg}` };
  }

  // Save suggested assets
  if (generated.suggestedAssets?.length) {
    await Promise.allSettled(
      generated.suggestedAssets.map((asset) =>
        import('../skills/skill.service.js').then(({ uploadAsset }) =>
          uploadAsset(workdir, slug, asset.fileName, Buffer.from(asset.content, 'utf-8')),
        ),
      ),
    );
  }

  return {
    success: true,
    message: `Skill **${generated.displayName}** created with ${generated.sections.length} sections.${generated.pricingDefaults ? ` Pricing model: ${generated.pricingDefaults.model}.` : ''}`,
    data: { slug, displayName: generated.displayName, sectionCount: generated.sections.length },
    actionCards: [
      {
        type: 'view_skill',
        label: 'View & Edit Skill',
        href: `/skills?skill=${slug}`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 13. list_skills
//     Lists all available skills in the workdir.
// ---------------------------------------------------------------------------

export async function handleListSkills(
  _params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PartialResult> {
  const skills = await listSkillsFromDisk(ctx.workdir);
  if (skills.length === 0) {
    return {
      success: true,
      message: 'No skills found. Visit the Skills page to create one, or say "create a skill for [your use case]".',
      data: { skills: [] },
    };
  }
  const lines = skills.map(
    (s) => `- **${s.displayName}** (\`${s.slug}\`) v${s.version} — ${s.description || s.industries.join(', ')}`,
  );
  return {
    success: true,
    message: `**${skills.length} skill${skills.length !== 1 ? 's' : ''} available:**\n\n${lines.join('\n')}`,
    data: { skills },
    actionCards: [{ type: 'view_skills', label: 'Manage Skills', href: '/skills' }],
  };
}

// ---------------------------------------------------------------------------
// 14. list_design_skills
//     Lists all available design skills in the workdir.
// ---------------------------------------------------------------------------

export async function handleListDesignSkills(
  _params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PartialResult> {
  const skills = await listDesignSkillsFromDisk(ctx.workdir);
  if (skills.length === 0) {
    return {
      success: true,
      message: 'No design skills yet. Visit **Skills → 🎨 Design Skills** to create one.',
      data: { designSkills: [] },
      actionCards: [{ type: 'view_skills', label: 'Create Design Skill', href: '/skills' }],
    };
  }
  const lines = skills.map(
    (s) => `- **${s.displayName}** (\`${s.slug}\`) — ${s.aestheticTone}, ${s.themeClass} theme${s.description ? ` — ${s.description.slice(0, 80)}${s.description.length > 80 ? '…' : ''}` : ''}`,
  );
  return {
    success: true,
    message: `**${skills.length} design skill${skills.length !== 1 ? 's' : ''} available:**\n\n${lines.join('\n')}\n\nUse a design skill when generating a microsite by saying e.g. _"generate microsite with obsidian-editorial"_.`,
    data: { designSkills: skills },
    actionCards: [{ type: 'view_skills', label: 'Manage Design Skills', href: '/skills' }],
  };
}
