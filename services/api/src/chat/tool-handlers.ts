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
import {
  spawnProposalGenerator,
  type ProcessorPayload,
} from '@ai-engine/plugin-proposal-generator';
import { queryKnowledgeBase } from '@ai-engine/runtime';
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
import { buildRunner } from '../agent-routes.js';
import type { ToolName } from './planner.js';

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
  const lines: string[] = [
    `name: ${draft.name}`,
    `version: "${version}"`,
    `description: >`,
    `  ${draft.description.trim()}`,
    ``,
    `sections:`,
  ];
  for (const section of draft.sections) {
    lines.push(`  - title: ${section.title}`);
    lines.push(`    query: >-`);
    for (const line of section.query.trim().split('\n')) {
      lines.push(`      ${line}`);
    }
    lines.push(`    instruction: >-`);
    for (const line of section.instruction.trim().split('\n')) {
      lines.push(`      ${line}`);
    }
  }
  return lines.join('\n') + '\n';
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
  const industry = ((params.industry as string | undefined) ?? 'General').trim();
  const template = ((params.template as string | undefined) ?? 'default').trim();
  const { workdir, namespace, policyConfig, generateFn } = ctx;

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
        ? `${industry} Proposal`
        : template.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    const description = `A proposal template for the ${industry} industry${client ? ` tailored for ${client}` : ''}.`;

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
    tone: null,
    memory: null,
  };

  let doc: Awaited<ReturnType<typeof spawnProposalGenerator>>;

  if (policyConfig) {
    const policy = resolvePolicy(policyConfig, namespace, 'query');
    const { result } = await executeWithPolicy(policy, () => spawnProposalGenerator(payload));
    doc = result;
  } else {
    doc = await spawnProposalGenerator(payload);
  }

  const outputFile = (doc.metadata as Record<string, unknown>).output_file as string | undefined;
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
    data: { fileName: namespacedFile, client, industry, template },
    artifacts: [namespacedFile],
    actionCards: [
      {
        type: 'view_proposal',
        label: 'View Proposal',
        href: `/proposal?artifact=${encodeURIComponent(fileName)}&namespace=${encodeURIComponent(namespace)}`,
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
        href: `/proposal?artifact=${encodeURIComponent(bareFileName(proposalFileName))}&namespace=${encodeURIComponent(namespace)}`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 3. generate_microsite
//    Mirrors POST /agent/run with agent=microsite-generator-agent
// ---------------------------------------------------------------------------

export async function handleGenerateMicrosite(
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PartialResult> {
  const proposalFileName = ((params.proposalFileName as string | undefined) ?? '').trim();
  const { workdir, namespace } = ctx;

  const filePath = resolveProposalPath(proposalFileName, workdir, namespace);
  let proposalContent: string;
  try {
    proposalContent = await readFile(filePath, 'utf-8');
  } catch {
    return { success: false, message: `Proposal not found: "${proposalFileName}"` };
  }

  const runner = await buildRunner(workdir);
  const result = await runner.run('microsite-generator-agent', {
    namespace,
    documents: [proposalContent],
    metadata: {
      proposalMarkdown: proposalContent,
      proposalFileName,
      ...(params.primaryColor != null && { primaryColor: params.primaryColor }),
      ...(params.secondaryColor != null && { secondaryColor: params.secondaryColor }),
      ...(params.theme != null && { theme: params.theme }),
      ...(params.companyName != null && { companyName: params.companyName }),
      ...(params.tagline != null && { tagline: params.tagline }),
      ...(params.customInstructions != null && { customInstructions: params.customInstructions }),
    },
  });

  // Write the AST to the path the presentation UI reads from.
  // This mirrors what presentation-routes.ts /generate does at line 494-496.
  if (result.json != null) {
    const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
    await mkdir(path.dirname(astPath), { recursive: true });
    await writeFile(astPath, JSON.stringify(result.json, null, 2), 'utf-8');
  }

  return {
    success: true,
    message: `Presentation microsite generated from "${proposalFileName}".`,
    data: { namespace, proposalFileName, hasAst: result.json != null },
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
  const { workdir, namespace } = ctx;

  const result = await queryKnowledgeBase({
    question: query,
    storageDir: path.join(workdir, 'namespaces', namespace),
    namespace,
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

  return {
    success: true,
    message: `Found ${proposals.length} proposal${proposals.length !== 1 ? 's' : ''}.`,
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

  return {
    success: true,
    message: `Found ${templates.length} template${templates.length !== 1 ? 's' : ''}.`,
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
        href: `/proposal?artifact=${encodeURIComponent(bareFileName(proposalFileName))}&namespace=${encodeURIComponent(namespace)}`,
      },
    ],
  };
}
