/**
 * Proposal Generator — single authoritative content generation path.
 *
 * ALL proposal section content must be produced through generateProposal().
 * No handler or service may call the LLM directly for section content.
 *
 * Responsibilities:
 *   - Generate each section with focused LLM prompts
 *   - Maintain cross-section coherence via ProposalState
 *   - Retrieve per-section knowledge context (RAG)
 *   - Return the assembled markdown
 *
 * Saving and versioning are NOT responsibilities of this module.
 * Callers must use saveProposal() then createInitialVersion() after generation.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { searchKnowledgeChunks } from '@ai-engine/runtime';
import type { RetrievedChunk } from '@ai-engine/runtime';
import { llmGenerateFn } from '../agent-routes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProposalGeneratorInput {
  /** Template structure — ordered list of section titles. */
  template: { structure: string[] };
  /** Effective merged requirements (industry, timeline, budget, …). */
  requirements: Record<string, string>;
  /** Knowledge retrieval and outline context. */
  knowledgeContext: {
    workdir: string;
    namespace: string;
    outline: string;
  };
  /** Pre-computed artifact ID passed into section streaming events so the
   *  client can associate each block with the future saved artifact. */
  artifactId: string;
  /** Phase label callback. */
  onPhase?: (phase: string) => void;
  /**
   * Per-section callback — emitted once per section as it completes.
   * When present, the generator emits structured section blocks instead of
   * raw chunks so the frontend can render interactive editable blocks.
   */
  onSection?: (section: string, content: string) => void;
  /** Fallback token stream — used when onSection is not provided. */
  onChunk?: (chunk: string) => void;
}

export interface ProposalGeneratorResult {
  /** Full assembled markdown of all generated sections. */
  markdown: string;
  /** Final cross-section coherence state (timeline, pricing, tone, keyPoints). */
  proposalState: ProposalState;
}

// ---------------------------------------------------------------------------
// ProposalState — cross-section coherence
// ---------------------------------------------------------------------------

export interface ProposalState {
  /** Concrete facts / claims established in prior sections. */
  keyPoints: string[];
  /** Timeline value set by an earlier section (locked once set). */
  timeline: string | null;
  /** Pricing/budget value set by an earlier section (locked once set). */
  pricing: string | null;
  /** Writing tone established by the first section that set one. */
  tone: string | null;
}

function mergeSectionSummary(
  state: ProposalState,
  summary: Partial<ProposalState>,
): ProposalState {
  const existingNormalized = new Set(
    state.keyPoints.map((p) => p.toLowerCase().trim()),
  );
  const newPoints = (summary.keyPoints ?? []).filter(
    (p) => !existingNormalized.has(p.toLowerCase().trim()),
  );
  return {
    keyPoints: [...state.keyPoints, ...newPoints],
    timeline: state.timeline ?? summary.timeline ?? null,  // prefer existing
    pricing:  state.pricing  ?? summary.pricing  ?? null,  // prefer existing
    tone:     state.tone     ?? summary.tone     ?? null,  // first wins
  };
}

async function extractSectionSummary(
  sectionName: string,
  content: string,
): Promise<Partial<ProposalState>> {
  const prompt = [
    `You just read the "${sectionName}" section of a proposal.`,
    'Extract a structured summary for use in subsequent sections to maintain coherence.',
    '',
    'Return JSON with:',
    '- keyPoints: array of 1–3 key concrete facts or claims stated in this section',
    '- timeline: the timeline value if explicitly stated, or null',
    '- pricing: the pricing/budget value if explicitly stated, or null',
    '- tone: one word describing the writing tone (e.g. "confident", "consultative"), or null',
    '',
    'Rules:',
    '- Only include values explicitly stated — do NOT infer',
    '- keyPoints must be specific facts, not vague summaries',
    '- Output ONLY raw JSON — no markdown fences, no commentary',
    '',
    `Section content:\n${content.slice(0, 2000)}`,
  ].join('\n');

  try {
    const raw = await llmGenerateFn(prompt);
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      keyPoints: Array.isArray(parsed.keyPoints)
        ? (parsed.keyPoints as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
      timeline: typeof parsed.timeline === 'string' ? parsed.timeline : null,
      pricing:  typeof parsed.pricing  === 'string' ? parsed.pricing  : null,
      tone:     typeof parsed.tone     === 'string' ? parsed.tone     : null,
    };
  } catch {
    return { keyPoints: [] };
  }
}

async function compressKeyPoints(keyPoints: string[]): Promise<string[]> {
  const prompt = [
    'The following is a list of key points from a proposal being written.',
    'Summarize them into 3–5 concise, non-redundant bullets that preserve all important facts.',
    'Output ONLY the bullet items — one per line, no leading dashes or bullets.',
    '',
    keyPoints.map((p) => `- ${p}`).join('\n'),
  ].join('\n');

  try {
    const raw = await llmGenerateFn(prompt);
    const compressed = raw
      .split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter((l) => l.length > 0)
      .slice(0, 5);
    return compressed.length > 0 ? compressed : keyPoints.slice(0, 5);
  } catch {
    return keyPoints.slice(0, 5);
  }
}

async function retrieveContextChunks(
  workdir: string,
  namespace: string,
  query: string,
  topK = 4,
): Promise<RetrievedChunk[]> {
  try {
    const storageDir = path.join(workdir, 'namespaces', namespace);
    const result = await searchKnowledgeChunks({ question: query, storageDir, namespace, topK });
    return result.chunks.filter((c) => c.text.trim().length > 0) as RetrievedChunk[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Section prompt builder
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = ['industry', 'timeline', 'budget'] as const;

function buildSectionPrompt(
  section: string,
  allSections: string[],
  requirements: Record<string, string>,
  outline: string,
  proposalState: ProposalState,
  contextChunks: RetrievedChunk[] = [],
): string {
  const reqLines = REQUIRED_FIELDS
    .filter((f) => requirements[f])
    .map((f) => `- ${f}: ${requirements[f]}`)
    .join('\n');

  const parts = [
    `You are a professional proposal writer writing the **${section}** section.`,
    '',
    'Confirmed proposal inputs:',
    reqLines || '(none specified)',
    '',
    'Full section list for context:',
    ...allSections.map((s, i) =>
      `${i + 1}. ${s === section ? `**${s}** ← you are writing this` : s}`),
    '',
  ];

  if (outline) {
    parts.push(`Proposal outline:\n${outline}\n`, '');
  }

  const hasPriorContext =
    proposalState.keyPoints.length > 0 ||
    proposalState.timeline ||
    proposalState.pricing ||
    proposalState.tone;

  if (hasPriorContext) {
    parts.push('Context from previous sections:');
    if (proposalState.timeline) parts.push(`- Timeline: ${proposalState.timeline}`);
    if (proposalState.pricing)  parts.push(`- Pricing:  ${proposalState.pricing}`);
    if (proposalState.tone)     parts.push(`- Tone:     ${proposalState.tone}`);
    if (proposalState.keyPoints.length > 0) {
      parts.push('- Key points already established:');
      proposalState.keyPoints.forEach((p) => parts.push(`  • ${p}`));
    }
    parts.push(
      '',
      'Coherence rules:',
      '- Do NOT contradict the timeline, pricing, or key points above',
      '- Do NOT repeat these points verbatim — reference them only if adding new value',
      '- Maintain the established tone',
      '',
    );
  }

  if (contextChunks.length > 0) {
    parts.push('Source context (retrieved from documents):');
    contextChunks.forEach((chunk, i) => {
      const label = chunk.document ? `[${chunk.document}]` : `[Source ${i + 1}]`;
      parts.push(`${label}\n${chunk.text.trim()}`);
    });
    parts.push(
      '',
      'Citation rules:',
      '- When a statement is supported by the source context above, add an inline citation: [FileName] or [FileName, Page N]',
      '- Use ONLY the provided context to support claims — do NOT hallucinate citations',
      '- If a claim is your own reasoning or inference, do NOT add a citation',
      '- Unsupported facts should be omitted or clearly marked as (inferred)',
      '',
    );
  }

  parts.push(
    'Writing rules:',
    '- Write this section in full — no placeholders or "[TBD]"',
    '- Be specific, actionable, and persuasive',
    '- Output ONLY the section body — the heading will be added automatically',
    '- 2–4 focused paragraphs, professional tone',
  );

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// generateProposal — single authoritative generation entry point
// ---------------------------------------------------------------------------

export async function generateProposal(
  input: ProposalGeneratorInput,
): Promise<ProposalGeneratorResult> {
  const {
    template,
    requirements,
    knowledgeContext: { workdir, namespace, outline },
    onPhase,
    onSection,
    onChunk,
  } = input;

  const sections = template.structure;

  // Seed from confirmed requirements so the first section already has
  // timeline and pricing locked (coherence safety rule).
  let proposalState: ProposalState = {
    keyPoints: [],
    timeline: requirements.timeline ?? null,
    pricing:  requirements.budget   ?? null,
    tone:     null,
  };

  let proposalMarkdown = '';

  for (const section of sections) {
    onPhase?.(`Writing: ${section}`);

    const contextChunks = await retrieveContextChunks(workdir, namespace, section);

    const sectionPrompt = buildSectionPrompt(
      section, sections, requirements, outline, proposalState, contextChunks,
    );

    try {
      const content = await llmGenerateFn(sectionPrompt);
      const formatted = `## ${section}\n\n${content.trim()}\n\n`;

      // Prefer structured section events (STEP 7 — emit blocks, not raw text).
      if (onSection) {
        onSection(section, content.trim());
      } else {
        onChunk?.(formatted);
      }
      proposalMarkdown += formatted;

      const summary = await extractSectionSummary(section, content);
      let merged = mergeSectionSummary(proposalState, summary);

      if (merged.keyPoints.length > 10) {
        merged = { ...merged, keyPoints: await compressKeyPoints(merged.keyPoints) };
      }

      proposalState = merged;
    } catch {
      const placeholder = `## ${section}\n\n_(Section generation failed — please edit manually)_\n\n`;
      if (onSection) {
        onSection(section, '_(Section generation failed — please edit manually)_');
      } else {
        onChunk?.(placeholder);
      }
      proposalMarkdown += placeholder;
    }
  }

  return { markdown: proposalMarkdown, proposalState };
}

// ---------------------------------------------------------------------------
// saveProposal — mandatory persistence step after generation
// ---------------------------------------------------------------------------

/**
 * Persist proposal markdown to disk under the namespace proposals directory.
 *
 * Must be called immediately after generateProposal().
 * Returns the artifactId (fileName) that was written.
 */
export async function saveProposal(input: {
  workdir: string;
  namespace: string;
  content: string;
  /** Pre-computed file name. Must match the artifactId used during generation. */
  fileName: string;
}): Promise<string> {
  const { workdir, namespace, content, fileName } = input;
  const proposalsDir = path.join(workdir, 'namespaces', namespace, 'proposals');
  await mkdir(proposalsDir, { recursive: true });
  await writeFile(path.join(proposalsDir, fileName), content, 'utf-8');
  return fileName;
}
