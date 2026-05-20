/**
 * Microsite Generation Workflow — state handlers.
 *
 * Converts an existing proposal document into a presentation microsite using
 * the microsite-generator-agent.
 *
 * States driven by this file:
 *   checking_proposal        — locate the target proposal in the namespace
 *   collecting_design_inputs — gather brand/design preferences from the user
 *   generating_microsite     — run microsite-generator-agent on the proposal
 */

import path from 'node:path';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { env } from 'node:process';
import { llmGenerateFn } from '../agent-routes.js';
import { applyDesignSkill, generateThemeCSSTokens, generateSectionHtml, CUSTOM_HTML_SECTION_TYPES } from '../skills/design-skill-microsite.js';
import { generateStructuredMicrosite, assignSectionIds } from '../presentation/structured-microsite-generator.js';
import type { HandlerContext, HandlerResult } from './proposal-generation.handlers.js';
import { ContextService } from '../chat/context.service.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Brief-aware instruction builders
// ---------------------------------------------------------------------------

/**
 * Builds a framing rule from the namespace Brief so every section is written
 * from the Provider's service perspective — not the client's business perspective.
 * Works for any proposal type: marketing, software, construction, etc.
 */
export function buildBriefFramingRule(
  projectType: string,
  clientName: string,
  clientIndustry: string,
): string {
  return [
    'PROPOSAL CONTEXT — read before generating any section:',
    `  Provider is proposing: ${projectType}`,
    `  Client name: ${clientName}`,
    `  Client industry: ${clientIndustry}`,
    '',
    'STRICT FRAMING RULE — this overrides the source document:',
    `  - Every headline, subheadline, and body copy MUST describe the ${projectType} services the Provider delivers.`,
    `  - The subject of every sentence is the Provider's ${projectType} work — not ${clientName}'s business.`,
    `  - NEVER write headlines like "Elevate Your [client product] Experience" or "Building a [client facility]".`,
    `  - CORRECT: "How We Drive Results with ${projectType}" / "Our ${projectType} Approach for ${clientName}"`,
    `  - WRONG: "Captivating Families at ${clientName}" / "${clientName} Development Phases"`,
    `  - The timeline section must describe ${projectType} campaign/project phases — not ${clientName}'s build or operations.`,
    `  - The risk section must describe risks to the ${projectType} engagement — not operational risks of ${clientName}.`,
    `  - If the source proposal text frames things from ${clientName}'s perspective, REFRAME it to the Provider's perspective.`,
    '',
    'SECTION TITLE RULE:',
    `  - Titles describe what the Provider offers or does — not what ${clientName} is or does.`,
    `  - Use "${clientName}" in a title AT MOST ONCE across all sections (hero only).`,
    `  - All other titles must stand alone without the client name.`,
    `  - CORRECT titles: "Our Approach", "Campaign Strategy", "Why Choose Us", "Implementation Phases"`,
    `  - WRONG titles: "${clientName} Risk Management", "Phases for ${clientName} Success", "${clientName} Background"`,
    '',
    'HERO HEADLINE SOURCING RULE:',
    `  - Scan the proposal's Executive Summary for strong transformation phrases and use them verbatim or near-verbatim for the hero headline.`,
    `  - Priority order: (1) direct quote from Executive Summary, (2) rephrased key outcome from the proposal, (3) client name + primary workstream benefit.`,
    `  - NEVER fabricate a generic headline when the proposal contains specific compelling language.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Section type affinity table
// Each specialist type declares the signal words that make it relevant.
// Universal types (always valid) are not listed here — they are always included.
// ---------------------------------------------------------------------------

const UNIVERSAL_SECTION_TYPES = [
  'hero', 'overview', 'challenge', 'problem', 'approach',
  'deliverables', 'timeline', 'pricing', 'nextsteps', 'approval',
  'whyus', 'team', 'benefits', 'faq',
];

interface SectionTypeAffinity {
  /** Words in projectType that make this type relevant */
  include: string[];
  /** Words in projectType that make this type irrelevant (overrides include) */
  exclude: string[];
}

const SPECIALIST_SECTION_AFFINITIES: Record<string, SectionTypeAffinity> = {
  security: {
    include: ['software', 'development', 'engineering', 'platform', 'app', 'api', 'saas',
              'data', 'cloud', 'infrastructure', 'compliance', 'healthcare', 'finance',
              'legal', 'government', 'enterprise', 'security', 'cyber'],
    exclude: ['marketing', 'brand', 'construction', 'facility', 'interior', 'landscaping',
              'events', 'hospitality', 'retail', 'food', 'education'],
  },
  techstack: {
    include: ['software', 'development', 'engineering', 'platform', 'app', 'web', 'mobile',
              'api', 'saas', 'cloud', 'infrastructure', 'data', 'ai', 'ml', 'integration'],
    exclude: ['marketing', 'brand', 'construction', 'facility', 'interior', 'landscaping',
              'consulting', 'strategy', 'hr', 'training', 'events'],
  },
  testing: {
    include: ['software', 'development', 'engineering', 'platform', 'app', 'web', 'mobile',
              'api', 'saas', 'qa', 'quality', 'automation'],
    exclude: ['marketing', 'brand', 'construction', 'facility', 'consulting', 'strategy',
              'landscaping', 'events', 'hospitality'],
  },
  stats: {
    include: ['marketing', 'digital', 'seo', 'analytics', 'research', 'audit', 'performance',
              'data', 'growth', 'advertising', 'campaign', 'consulting', 'strategy'],
    exclude: [],
  },
  metrics: {
    include: ['marketing', 'digital', 'analytics', 'performance', 'data', 'research',
              'software', 'engineering', 'saas', 'growth', 'consulting'],
    exclude: ['construction', 'facility', 'interior', 'landscaping'],
  },
  testimonials: {
    include: ['marketing', 'brand', 'consulting', 'strategy', 'advisory', 'training',
              'design', 'creative', 'agency', 'services'],
    exclude: ['software', 'engineering', 'infrastructure', 'compliance'],
  },
  casestudy: {
    include: ['marketing', 'consulting', 'strategy', 'advisory', 'design', 'creative',
              'construction', 'facility', 'engineering', 'services', 'agency'],
    exclude: [],
  },
  showcase: {
    include: ['marketing', 'brand', 'design', 'creative', 'product', 'software', 'platform',
              'agency', 'portfolio'],
    exclude: [],
  },
  comparison: {
    include: ['software', 'saas', 'platform', 'marketing', 'consulting', 'strategy',
              'technology', 'data'],
    exclude: ['construction', 'facility', 'landscaping'],
  },
};

/**
 * Scores each specialist section type against the projectType string using
 * per-type include/exclude signal words. Returns a dynamic allowlist and blocklist.
 * Works for any proposal type — no hardcoded category buckets.
 */
export function buildSectionTypeGuidance(projectType: string): string {
  const pt = projectType.toLowerCase();
  const ptWords = pt.split(/[\s\-_/,]+/);

  const allowed: string[] = [...UNIVERSAL_SECTION_TYPES];
  const blocked: string[] = [];

  for (const [type, affinity] of Object.entries(SPECIALIST_SECTION_AFFINITIES)) {
    const excluded = affinity.exclude.some((w) => ptWords.some((pw) => pw.includes(w) || w.includes(pw)));
    if (excluded) {
      blocked.push(type);
      continue;
    }
    const included = affinity.include.some((w) => ptWords.some((pw) => pw.includes(w) || w.includes(pw)));
    if (included) {
      allowed.push(type);
    }
    // Not excluded and not matched → omit (neither recommended nor blocked)
  }

  const lines = [
    `SECTION TYPE RULE for a "${projectType}" proposal:`,
    `  Recommended types: ${allowed.join(', ')}.`,
  ];
  if (blocked.length > 0) {
    lines.push(`  Do NOT use: ${blocked.join(', ')}.`);
  }
  lines.push('  Only add a specialist type if the proposal content clearly supports it.');
  lines.push('  IMPORTANT: Do NOT map a "Risk Management" or "Risks" section to type "security" — use type "generic" instead.');
  return lines.join('\n');
}

/**
 * Returns preferred section ordering and count guidance for the given projectType.
 * Derived dynamically from the projectType string — no hardcoded category buckets.
 */
export function buildSectionOrderGuidance(projectType: string): string {
  const pt = projectType.toLowerCase();
  const ptWords = pt.split(/[\s\-_/,]+/);
  const has = (words: string[]) =>
    words.some((w) => ptWords.some((pw) => pw.includes(w) || w.includes(pw)));

  let preferredOrder: string[];
  let countGuidance: string;

  if (has(['marketing', 'digital', 'brand', 'seo', 'social', 'advertising', 'campaign', 'content'])) {
    preferredOrder = ['hero', 'overview', 'challenge', 'approach', 'stats', 'deliverables', 'timeline', 'pricing', 'whyus', 'testimonials', 'casestudy', 'team', 'nextsteps'];
    countGuidance = 'Start with at least 8 sections. Add more if source content supports it — every piece of proposal content must appear somewhere. MANDATORY: include a whyus section whenever the proposal contains a "Why Choose Us" or credentials section. Never drop content to hit a count.';
  } else if (has(['software', 'development', 'engineering', 'platform', 'app', 'api', 'saas', 'web', 'mobile'])) {
    preferredOrder = ['hero', 'overview', 'challenge', 'approach', 'techstack', 'security', 'testing', 'deliverables', 'timeline', 'pricing', 'team', 'nextsteps'];
    countGuidance = 'Start with at least 10 sections. Add more if the source content supports it — every piece of source content must appear somewhere. Never drop content to meet a section count.';
  } else if (has(['consult', 'strateg', 'advisory', 'research', 'audit', 'training'])) {
    preferredOrder = ['hero', 'overview', 'challenge', 'approach', 'deliverables', 'stats', 'casestudy', 'timeline', 'pricing', 'team', 'nextsteps'];
    countGuidance = 'Start with at least 8 sections. Add more if the source content supports it — every piece of source content must appear somewhere. Never drop content to meet a section count.';
  } else if (has(['construction', 'facility', 'interior', 'design', 'build', 'renovation'])) {
    preferredOrder = ['hero', 'overview', 'challenge', 'approach', 'deliverables', 'timeline', 'casestudy', 'pricing', 'team', 'nextsteps'];
    countGuidance = 'Start with at least 8 sections. Add more if the source content supports it — every piece of source content must appear somewhere. Never drop content to meet a section count.';
  } else if (has(['discovery', 'scoping', 'assessment'])) {
    preferredOrder = ['hero', 'overview', 'challenge', 'approach', 'deliverables', 'timeline', 'team', 'nextsteps'];
    countGuidance = 'Start with at least 6 sections. Omit pricing and approval for discovery/scoping proposals. Add more sections if the source content supports it — never drop content.';
  } else {
    preferredOrder = ['hero', 'overview', 'challenge', 'approach', 'deliverables', 'timeline', 'pricing', 'team', 'nextsteps'];
    countGuidance = 'Start with at least 7 sections. Add more if the source content supports it — every piece of source content must appear somewhere. Never drop content to meet a section count.';
  }

  return [
    'SECTION ORDER RULE:',
    `  Preferred order for a "${projectType}" proposal: ${preferredOrder.join(' → ')}.`,
    `  ${countGuidance}`,
    '  Follow the source document structure only where it improves on this order.',
    '  Do not repeat section types — merge duplicate content into one section.',
    '  CONTENT COMPLETENESS: Every heading and paragraph from the source proposal must be represented.',
    '  If content does not fit the preferred order, create an additional section rather than dropping it.',
    '  FINAL SECTION RULE: "nextsteps" or "approval" MUST always be the very last section — no exceptions.',
  ].join('\n');
}

/**
 * Reads the namespace context.json and builds combined Brief instructions
 * (framing rule + section type guidance + section order) to pass to the microsite agent.
 * Falls back to safe defaults if context is unavailable.
 */
const SKIP_PATTERN = /^(generate|go|skip|use defaults?|proceed|yes|y|ok|okay|sure)$/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MicrositeDesignInputs {
  companyName?: string;
  primaryColor?: string;
  designStyle?: string;
  pdfFriendly?: boolean;
  customInstructions?: string;
}

// ---------------------------------------------------------------------------
// Proposal discovery
// ---------------------------------------------------------------------------

interface ProposalEntry {
  fileName: string;
  filePath: string;
  createdAt: Date;
}

async function discoverProposals(workdir: string, namespace: string): Promise<ProposalEntry[]> {
  const proposalsDir = path.join(workdir, 'namespaces', namespace, 'proposals');
  try {
    const entries = await readdir(proposalsDir);
    const mdFiles = entries.filter((f) => f.endsWith('.md'));
    return mdFiles
      .map((f) => ({
        fileName: f,
        filePath: path.join(proposalsDir, f),
        // Parse timestamp from filename pattern: chat-draft-<timestamp>.md or <name>-<timestamp>.md
        createdAt: new Date(
          (() => {
            const match = /(\d{10,13})/.exec(f);
            return match ? parseInt(match[1], 10) * (match[1].length === 10 ? 1000 : 1) : 0;
          })(),
        ),
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // newest first
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// checking_proposal handler
// ---------------------------------------------------------------------------

/**
 * Locate the proposal to convert into a microsite.
 *
 * Flow:
 *   1. If proposalArtifactId already in context → signal READY immediately.
 *   2. Scan the namespace proposals directory for .md files.
 *   3. If none found → inform user to generate a proposal first.
 *   4. If one found → ask user to confirm it.
 *   5. If multiple found → list them, ask which one to use.
 *   6. On user confirmation/selection → set context.proposalArtifactId → signal READY.
 */
export async function handleCheckingProposal(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, incomingMessage } = ctx;

  // Already resolved — proceed immediately
  if (instance.context.proposalArtifactId) {
    return { message: '', stateSignal: 'READY' };
  }

  const proposals = await discoverProposals(workdir, namespace);

  if (proposals.length === 0) {
    return {
      message: [
        'No proposals found in this namespace.',
        '',
        'Generate a proposal first using:',
        '> "Create a proposal for [client / project]"',
        '',
        'Then come back and I can convert it into a microsite.',
      ].join('\n'),
    };
  }

  // If user is confirming a previously listed selection
  if (instance.context.awaitingMicrositeProposalSelection) {
    const lower = incomingMessage.toLowerCase().trim();

    // Match by number
    const numMatch = /^\s*(\d+)\s*$/.exec(incomingMessage.trim());
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10) - 1;
      if (idx >= 0 && idx < proposals.length) {
        instance.context.proposalArtifactId = proposals[idx].fileName;
        instance.context.awaitingMicrositeProposalSelection = undefined;
        return {
          message: `Using **${proposals[idx].fileName}**.`,
          stateSignal: 'READY',
        };
      }
    }

    // Match by filename fragment
    const matched = proposals.find((p) => lower.includes(p.fileName.toLowerCase().replace('.md', '')));
    if (matched) {
      instance.context.proposalArtifactId = matched.fileName;
      instance.context.awaitingMicrositeProposalSelection = undefined;
      return {
        message: `Using **${matched.fileName}**.`,
        stateSignal: 'READY',
      };
    }

    // Treat any affirmative short reply as "use the first one"
    const isYes = /^(yes|y|ok|okay|sure|go|proceed|use (this|it|that)|confirm)$/i.test(lower);
    if (isYes) {
      instance.context.proposalArtifactId = proposals[0].fileName;
      instance.context.awaitingMicrositeProposalSelection = undefined;
      return {
        message: `Using **${proposals[0].fileName}**.`,
        stateSignal: 'READY',
      };
    }

    // Unrecognised reply — re-list
  }

  // First entry: list proposals and ask
  instance.context.awaitingMicrositeProposalSelection = true;

  if (proposals.length === 1) {
    const p = proposals[0];
    return {
      message: [
        'I found one proposal in your namespace:',
        '',
        `**${p.fileName}**`,
        '',
        'Reply **yes** to convert it into a microsite, or upload / generate a different proposal first.',
      ].join('\n'),
    };
  }

  const fileList = proposals
    .slice(0, 10) // cap at 10 to keep the message readable
    .map((p, i) => `${i + 1}. **${p.fileName}**`)
    .join('\n');

  return {
    message: [
      'I found the following proposals in your namespace:',
      '',
      fileList,
      '',
      'Which proposal should I convert into a microsite? Reply with the number or file name.',
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// collecting_design_inputs handler
// ---------------------------------------------------------------------------

/**
 * Ask the user for brand and design preferences before generation.
 *
 * Flow:
 *   1. First call — show the design questions form.
 *   2. If user says "generate" / "skip" — signal READY with empty inputs.
 *   3. Otherwise — use LLM to parse the reply into structured design inputs,
 *      store in context.micrositeDesignInputs, signal READY.
 */
export async function handleCollectingDesignInputs(ctx: HandlerContext): Promise<HandlerResult> {
  const { instance, incomingMessage } = ctx;

  // Skip shortcut — user wants to proceed with defaults
  if (SKIP_PATTERN.test(incomingMessage.trim())) {
    instance.context.micrositeDesignInputs = {};
    return { message: '', stateSignal: 'READY' };
  }

  // First visit — show the question form
  if (!instance.context.awaitingMicrositeDesignInputs) {
    instance.context.awaitingMicrositeDesignInputs = true;
    return {
      message: [
        'Before I generate the microsite, a few quick questions to tailor the design:',
        '',
        '1. **Brand name** — What company or product name should be featured?',
        '2. **Brand color** — Primary color (hex or name, e.g. `#1a73e8` or `navy`). Skip if unsure.',
        '3. **Style** — `professional` / `bold` / `minimal` / `editorial` (default: professional)',
        '4. **PDF-friendly?** — yes / no (optimises layout for PDF export, default: no)',
        '5. **Custom instructions** — Anything specific to include or emphasise? (or skip)',
        '',
        'You can answer all at once, skip any question, or just say **"generate"** to use defaults.',
      ].join('\n'),
    };
  }

  // User has replied — parse with LLM
  const parsePrompt = [
    'Extract microsite design preferences from the following user message.',
    'Return a JSON object with these optional fields:',
    '  companyName: string',
    '  primaryColor: string (hex or CSS color name, normalise to hex if possible)',
    '  designStyle: "professional" | "bold" | "minimal" | "editorial"',
    '  pdfFriendly: boolean',
    '  customInstructions: string (verbatim instructions for the microsite generator)',
    '',
    'Rules:',
    '- Only include a field if the user clearly provided a value for it.',
    '- If a field is absent or the user said "skip", omit it from the object.',
    '- Return only the raw JSON object, no markdown fences.',
    '',
    `User message: ${incomingMessage}`,
  ].join('\n');

  let designInputs: MicrositeDesignInputs = {};
  try {
    const raw = await llmGenerateFn(parsePrompt);
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/```json|```/g, '').trim();
    designInputs = JSON.parse(cleaned) as MicrositeDesignInputs;
  } catch {
    // Parsing failed — use the raw message as custom instructions and proceed
    designInputs = { customInstructions: incomingMessage };
  }

  instance.context.micrositeDesignInputs = designInputs;
  instance.context.awaitingMicrositeDesignInputs = undefined;

  const confirmParts: string[] = ['Got it! Here\'s what I\'ll use:'];
  if (designInputs.companyName) confirmParts.push(`- **Brand name**: ${designInputs.companyName}`);
  if (designInputs.primaryColor) confirmParts.push(`- **Brand color**: ${designInputs.primaryColor}`);
  if (designInputs.designStyle) confirmParts.push(`- **Style**: ${designInputs.designStyle}`);
  if (designInputs.pdfFriendly) confirmParts.push('- **PDF-friendly**: yes');
  if (designInputs.customInstructions) confirmParts.push(`- **Instructions**: ${designInputs.customInstructions}`);
  if (confirmParts.length === 1) confirmParts.push('- Using default settings');

  return {
    message: confirmParts.join('\n'),
    stateSignal: 'READY',
  };
}

// ---------------------------------------------------------------------------
// generating_microsite handler
// ---------------------------------------------------------------------------

/**
 * Convert the selected proposal into a microsite using the microsite-generator-agent.
 *
 * Flow:
 *   1. Emit phase "Loading proposal".
 *   2. Read the proposal markdown from the namespace proposals directory.
 *   3. Emit phase "Generating microsite".
 *   4. Invoke MicrositeGeneratorAgent.run() with proposal + collected design inputs.
 *      Sections are streamed to the client in real-time via onSectionComplete.
 *   5. Emit phase "Microsite ready".
 *   6. Store micrositeArtifactId and layout AST in context.
 *   7. Signal DONE.
 */
const SECTION_NAV_LABEL: Record<string, string> = {
  hero: 'Home', overview: 'Overview', challenge: 'Challenge', problem: 'Problem',
  approach: 'Approach', deliverables: 'Deliverables', timeline: 'Timeline',
  pricing: 'Pricing', whyus: 'Why Us', nextsteps: 'Next Steps',
  testimonials: 'Testimonials', showcase: 'Our Work', benefits: 'Key Benefits',
  stats: 'Stats', metrics: 'Performance', security: 'Risk & Compliance',
  techstack: 'Tech Stack', testing: 'Testing', faq: 'FAQs', team: 'Our Team',
  comparison: 'How We Compare', casestudy: 'Case Study', approval: 'Sign Off',
  generic: 'Details',
};

function deduplicateSections(ast: Record<string, unknown>): void {
  const sections = ast.sections as Record<string, unknown>[] | undefined;
  if (!Array.isArray(sections) || sections.length === 0) return;

  const firstOccurrence = new Map<string, number>();
  const toRemove: number[] = [];

  sections.forEach((section, idx) => {
    const type = section.sectionType as string;
    if (firstOccurrence.has(type)) {
      const firstIdx = firstOccurrence.get(type)!;
      const first = sections[firstIdx];
      // Merge customHtml — concatenate so no content is lost
      const firstHtml = first.customHtml as string | undefined;
      const thisHtml = section.customHtml as string | undefined;
      if (thisHtml) {
        first.customHtml = firstHtml ? `${firstHtml}\n${thisHtml}` : thisHtml;
      }
      toRemove.push(idx);
    } else {
      firstOccurrence.set(type, idx);
      // Normalise heading to clean nav label so MicrositeNav always shows the mapped name
      const label = SECTION_NAV_LABEL[type];
      if (label) section.heading = label;
    }
  });

  // Remove duplicates in reverse order to preserve indices
  for (let i = toRemove.length - 1; i >= 0; i--) {
    sections.splice(toRemove[i], 1);
  }
}

export async function handleGeneratingMicrosite(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, onPhase, onChunk, onSection } = ctx;

  const artifactId = instance.context.proposalArtifactId as string;
  const proposalPath = path.join(workdir, 'namespaces', namespace, 'proposals', artifactId);
  const design = (instance.context.micrositeDesignInputs ?? {}) as MicrositeDesignInputs;

  // ── Load proposal markdown ───────────────────────────────────────
  onPhase('Loading proposal');

  let proposalMarkdown: string;
  try {
    proposalMarkdown = await readFile(proposalPath, 'utf-8');
  } catch {
    return {
      message: [
        `Could not read proposal file **${artifactId}**.`,
        '',
        'The file may have been moved or deleted. Please generate a new proposal first.',
      ].join('\n'),
    };
  }

  if (!proposalMarkdown.trim()) {
    return {
      message: `The proposal file **${artifactId}** appears to be empty. Please regenerate the proposal.`,
    };
  }

  const apiKey = env.ANTHROPIC_API_KEY ?? '';
  const model  = env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

  // Build brandHint from context.json — same approach as generate-structured-stream
  let brandHint: { companyName?: string; industry?: string; clientName?: string; primaryColor?: string } = {};
  let structuredCtx: Record<string, unknown> | null = null;
  try {
    const ctxSvc = new ContextService(workdir);
    structuredCtx = await ctxSvc.get(namespace) as Record<string, unknown> | null;
    const fields = ((structuredCtx as Record<string, unknown>)?.requirements as Record<string, Record<string, { value?: unknown }>> | undefined)?.fields ?? {};
    brandHint = {
      companyName:  (fields.clientName?.value    as string | undefined) ?? '',
      clientName:   (fields.clientName?.value    as string | undefined) ?? '',
      industry:     (fields.clientIndustry?.value as string | undefined) ?? '',
      primaryColor: design.primaryColor ?? (fields.primaryColor?.value as string | undefined),
    };
  } catch { /* non-fatal */ }

  const clientIndustry  = brandHint.industry ?? '';
  const designOverride  = design.customInstructions || undefined;

  // Tone detection (industry-aware, same as generate-structured-stream)
  const { tone: industryTone } = applyDesignSkill('microsite-generator-agent', {
    proposalMarkdown,
    clientIndustry,
  });

  // ── Phase 1: single LLM call → complete AST ─────────────────────
  onPhase('Building microsite structure');
  let ast: Awaited<ReturnType<typeof generateStructuredMicrosite>>;
  try {
    ast = await generateStructuredMicrosite(proposalMarkdown, brandHint, artifactId, apiKey, model);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      message: [
        'Microsite generation encountered an error:',
        '',
        `> ${msg}`,
        '',
        'Please try again, or check that the proposal content is valid markdown.',
      ].join('\n'),
    };
  }

  const sections = assignSectionIds(ast.sections);
  ast.sections   = sections;

  // Emit each section so the chat UI shows streaming section blocks
  let sectionIndex = 0;
  for (const s of sections) {
    const artifactSectionId = `microsite-section-${++sectionIndex}-${Date.now()}`;
    if (onSection) {
      onSection(s.sectionType, JSON.stringify(s), artifactSectionId);
    } else {
      onChunk(`\n_Section ready: ${s.sectionType}_`);
    }
  }

  // ── Phase 2: LLM CSS theme generation ───────────────────────────
  onPhase('Applying design theme');
  const cssTheme = await generateThemeCSSTokens(
    industryTone as string,
    brandHint.primaryColor,
    llmGenerateFn,
    clientIndustry,
    designOverride,
  ).catch(() => null);

  if (cssTheme) {
    ast.brand = {
      ...ast.brand,
      extractedCssVariables: cssTheme.cssVars,
      overrideTheme: true,
      ...(cssTheme.googleFontsUrl        ? { googleFontsUrl: cssTheme.googleFontsUrl }               : {}),
      ...(cssTheme.fontFaceDeclarations  ? { fontFaceDeclarations: cssTheme.fontFaceDeclarations }   : {}),
    } as typeof ast.brand;
  }

  // ── Phase 3: per-section HTML generation (5 concurrent) ─────────
  onPhase('Generating section designs');
  if (cssTheme) {
    const htmlGenerateFn = async (prompt: string): Promise<string> => {
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] }),
        });
        if (r.status === 429) {
          const delay = parseInt(r.headers.get('retry-after') ?? '30', 10) * 1000 * (attempt + 1);
          await new Promise(res => setTimeout(res, delay));
          continue;
        }
        if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
        const d = await r.json() as { content: Array<{ type: string; text: string }> };
        return d.content.filter(b => b.type === 'text').map(b => b.text).join('');
      }
      throw new Error('HTML generation: max retries exceeded');
    };

    const CONCURRENCY = 5;
    const targets = sections.filter(s => CUSTOM_HTML_SECTION_TYPES.has(s.sectionType));
    let cursor = 0;

    const htmlWorker = async () => {
      while (cursor < targets.length) {
        const section = targets[cursor++];
        const idx     = sections.indexOf(section);
        try {
          const html = await generateSectionHtml(
            section as unknown as Record<string, unknown>,
            industryTone as import('../skills/design-skill-microsite.js').Tone,
            cssTheme.cssVars,
            null,
            htmlGenerateFn,
            idx,
            designOverride,
          );
          section.customHtml = html;
          onChunk(`\n_Section designed: ${section.sectionType}_`);
        } catch (err) {
          console.warn(`[chat-microsite] HTML failed: ${section.sectionType}:`, err instanceof Error ? err.message : err);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => htmlWorker()));
  }

  // Attach hero metadata strip (client name, prepared-by, date, version)
  const heroSec = sections.find(s => s.sectionType === 'hero');
  if (heroSec) {
    (heroSec as unknown as Record<string, unknown>)._meta = {
      clientName:  brandHint.clientName || '—',
      preparedBy:  design.companyName   || '—',
      date:        new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      version:     'v1',
    };
  }

  // ── Store result ─────────────────────────────────────────────────
  onPhase('Microsite ready');

  const micrositeArtifactId = `microsite-${Date.now()}.json`;
  instance.context.micrositeArtifactId = micrositeArtifactId;
  instance.context.micrositeLayoutAST  = ast;

  // Deduplicate sections and normalise headings before persisting
  deduplicateSections(ast as unknown as Record<string, unknown>);

  // Persist AST to disk so the presentation page can load it
  const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
  await mkdir(path.dirname(astPath), { recursive: true });
  await writeFile(astPath, JSON.stringify(ast, null, 2), 'utf-8').catch(() => { /* non-fatal */ });

  const summary = [
    '## Microsite Generated',
    '',
    'Your proposal has been converted into a presentation microsite.',
    '',
    'The microsite is now available in your workspace. You can view and edit it from the UI.',
  ].join('\n');

  onChunk(summary);

  return {
    message: summary,
    stateSignal: 'DONE',
    actions: {
      openMicrositeUrl: `/presentation?namespace=${encodeURIComponent(namespace)}&proposalId=${encodeURIComponent(artifactId)}&mode=view`,
      sourceProposal: artifactId,
    },
  };
}
