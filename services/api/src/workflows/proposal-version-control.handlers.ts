/**
 * Proposal Version Control — state handlers.
 *
 * Handles two sub-intents within a single state:
 *   - "show history" / "show versions" → list all version snapshots
 *   - "rollback" / "revert" → roll back to a specified version
 *
 * The handler inspects the incoming message to determine which action
 * to take, then streams the result to the client.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HandlerResult, HandlerContext } from './proposal-generation.handlers.js';
import {
  listVersions,
  rollbackToVersion,
  findLatestArtifact,
  createVersionFromEdit,
  type ProposalVersion,
} from '../proposals/proposal-version.service.js';
import { llmGenerateFn } from '../agent-routes.js';

// ---------------------------------------------------------------------------
// Sub-intent detection
// ---------------------------------------------------------------------------

type VersionAction = 'show_history' | 'rollback' | 'edit_section';

const HISTORY_KEYWORDS = ['history', 'versions', 'list version', 'show version'];
const ROLLBACK_KEYWORDS = ['rollback', 'roll back', 'revert', 'restore', 'undo', 'go back'];
const EDIT_KEYWORDS = [
  'update', 'edit', 'change', 'rewrite', 'revise', 'modify',
  'make it', 'make the', 'make more', 'improve',
];

function detectAction(message: string): VersionAction {
  const lower = message.toLowerCase();

  // Rollback is highest priority
  for (const kw of ROLLBACK_KEYWORDS) {
    if (lower.includes(kw)) return 'rollback';
  }

  // History display
  for (const kw of HISTORY_KEYWORDS) {
    if (lower.includes(kw)) return 'show_history';
  }

  // Inline edit — catches "update the summary", "make the tone more aggressive", etc.
  for (const kw of EDIT_KEYWORDS) {
    if (lower.includes(kw)) return 'edit_section';
  }

  return 'show_history';
}

/**
 * Attempt to extract a version label (e.g. "v1.0", "v1.2") from the message.
 */
function extractVersionLabel(message: string): string | null {
  const match = message.match(/v(\d+\.\d+)/i);
  return match ? `v${match[1]}` : null;
}

// ---------------------------------------------------------------------------
// resolve_action handler
// ---------------------------------------------------------------------------

export async function handleResolveAction(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, incomingMessage, onPhase, onChunk } = ctx;

  // Resolve artifact — prefer one from workflow context, else find latest
  let artifactId = instance.context.proposalArtifactId as string | undefined;
  if (!artifactId) {
    artifactId = (await findLatestArtifact(workdir, namespace)) ?? undefined;
  }

  if (!artifactId) {
    return {
      message: 'No proposal found in this namespace. Generate a proposal first before managing versions.',
      stateSignal: 'DONE',
    };
  }

  // Store for future reference within this workflow instance
  instance.context.proposalArtifactId = artifactId;

  const action = detectAction(incomingMessage);

  if (action === 'show_history') {
    return handleShowHistory(workdir, namespace, artifactId, onPhase, onChunk);
  }

  if (action === 'edit_section') {
    const proposalState = instance.context.proposalState as Record<string, unknown> | undefined;
    return handleEditSection(
      workdir, namespace, artifactId, incomingMessage, proposalState, onPhase, onChunk,
    );
  }

  return handleRollback(workdir, namespace, artifactId, incomingMessage, onPhase, onChunk);
}

// ---------------------------------------------------------------------------
// Show history
// ---------------------------------------------------------------------------

async function handleShowHistory(
  workdir: string,
  namespace: string,
  artifactId: string,
  onPhase: (phase: string) => void,
  onChunk: (chunk: string) => void,
): Promise<HandlerResult> {
  onPhase('Loading version history');

  const { versions, currentVersionId } = await listVersions(workdir, namespace, artifactId);

  if (versions.length === 0) {
    const message = `No version history found for **${artifactId}**. Versions are created automatically when the proposal is generated or edited.`;
    onChunk(message);
    return { message, stateSignal: 'DONE' };
  }

  onPhase('Rendering timeline');

  const lines: string[] = [
    `## Version History — ${artifactId}`,
    '',
    `| Version | Date | Author | Summary | Current |`,
    `|---------|------|--------|---------|---------|`,
  ];

  for (const v of versions) {
    const date = new Date(v.createdAt).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const isCurrent = v.id === currentVersionId ? '**current**' : '';
    const summary = v.summary ?? '—';
    lines.push(`| ${v.versionLabel} | ${date} | ${v.createdBy} | ${summary} | ${isCurrent} |`);
  }

  lines.push('');
  lines.push(`${versions.length} version(s) tracked. To rollback, say: **"Revert to v1.0"**`);

  const message = lines.join('\n');
  onChunk(message);

  return { message, stateSignal: 'DONE' };
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Section editing helpers
// ---------------------------------------------------------------------------

interface ParsedSection {
  heading: string;
  /** Body text only — no heading line. */
  content: string;
}

/**
 * Split markdown into sections delimited by `## ` headings.
 * Preamble text before the first heading is returned as { heading: '', content }.
 */
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

/**
 * Reassemble sections into a full markdown string.
 */
function assembleSections(sections: ParsedSection[]): string {
  return sections
    .map((s) => (s.heading ? `## ${s.heading}\n\n${s.content}` : s.content))
    .join('\n\n')
    .trim() + '\n';
}

/**
 * Find the best-matching section heading for a user message.
 * Normalises both sides (lowercase, strip punctuation) and scores by
 * substring overlap.  Returns null if no heading scores above zero.
 */
function findTargetSection(sections: ParsedSection[], message: string): ParsedSection | null {
  const lower = message.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

  let bestSection: ParsedSection | null = null;
  let bestScore = 0;

  for (const section of sections) {
    if (!section.heading) continue;
    const normHeading = section.heading.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const headingWords = normHeading.split(/\s+/).filter(Boolean);

    const score = headingWords.filter((word) => word.length > 2 && lower.includes(word)).length;
    if (score > bestScore) {
      bestScore = score;
      bestSection = section;
    }
  }

  return bestSection;
}

// ---------------------------------------------------------------------------
// Edit section handler
// ---------------------------------------------------------------------------

async function handleEditSection(
  workdir: string,
  namespace: string,
  artifactId: string,
  incomingMessage: string,
  proposalState: Record<string, unknown> | undefined,
  onPhase: (phase: string) => void,
  onChunk: (chunk: string) => void,
): Promise<HandlerResult> {
  onPhase('Loading proposal');

  const filePath = path.join(workdir, 'namespaces', namespace, 'proposals', artifactId);
  let markdown: string;
  try {
    markdown = await readFile(filePath, 'utf-8');
  } catch {
    const message = `Could not read proposal **${artifactId}**. Make sure the proposal exists before editing.`;
    onChunk(message);
    return { message, stateSignal: 'DONE' };
  }

  const sections = parseMarkdownSections(markdown);
  const target = findTargetSection(sections, incomingMessage);

  if (!target) {
    const headings = sections.filter((s) => s.heading).map((s) => `- ${s.heading}`).join('\n');
    const message = [
      "I couldn't identify which section to edit. The proposal contains:",
      '',
      headings,
      '',
      'Try: "Update the Executive Summary to emphasise ROI"',
    ].join('\n');
    onChunk(message);
    return { message, stateSignal: 'DONE' };
  }

  onPhase(`Rewriting: ${target.heading}`);

  // Build coherence context from proposalState if available
  const keyPoints = Array.isArray(proposalState?.keyPoints)
    ? (proposalState.keyPoints as string[])
    : [];
  const timeline = typeof proposalState?.timeline === 'string' ? proposalState.timeline : null;
  const pricing  = typeof proposalState?.pricing  === 'string' ? proposalState.pricing  : null;
  const tone     = typeof proposalState?.tone     === 'string' ? proposalState.tone     : null;

  const coherenceBlock = (timeline || pricing || tone || keyPoints.length > 0) ? [
    'Proposal context (maintain consistency with these):',
    ...(timeline ? [`- Timeline: ${timeline}`] : []),
    ...(pricing  ? [`- Pricing:  ${pricing}`]  : []),
    ...(tone     ? [`- Tone:     ${tone}`]     : []),
    ...(keyPoints.length > 0 ? ['- Key points:', ...keyPoints.map((p) => `  • ${p}`)] : []),
  ].join('\n') : '';

  const editPrompt = [
    `You are rewriting the **${target.heading}** section of a proposal.`,
    '',
    'Original section content:',
    target.content,
    '',
    'User instruction:',
    incomingMessage,
    '',
    ...(coherenceBlock ? [coherenceBlock, ''] : []),
    'Rules:',
    '- Apply the instruction precisely to this section only',
    '- Do NOT contradict timeline, pricing, or key points from the context above',
    '- Do NOT change any other section',
    '- Output ONLY the new section body — no heading, no commentary',
    '- Maintain professional, persuasive tone',
  ].join('\n');

  let newContent: string;
  try {
    newContent = await llmGenerateFn(editPrompt);
  } catch (err) {
    const message = `Failed to rewrite section: ${err instanceof Error ? err.message : String(err)}`;
    onChunk(message);
    return { message, stateSignal: 'DONE' };
  }

  // Replace the section and reassemble
  const updatedSections = sections.map((s) =>
    s.heading === target.heading ? { ...s, content: newContent.trim() } : s,
  );
  const updatedMarkdown = assembleSections(updatedSections);

  // Persist updated proposal to disk
  await writeFile(filePath, updatedMarkdown, 'utf-8');

  // Create a new version snapshot
  onPhase('Saving version');
  const version = await createVersionFromEdit(
    workdir,
    namespace,
    artifactId,
    updatedMarkdown,
    null,
    'agent',
    `Edited: ${target.heading}`,
  );

  const message = [
    `Updated **${target.heading}** — saved as **${version.versionLabel}**.`,
    '',
    `## ${target.heading}`,
    '',
    newContent.trim(),
  ].join('\n');

  onChunk(message);

  return {
    message,
    stateSignal: 'DONE',
    actions: {
      openProposalUrl: `/proposals/${namespace}/${artifactId}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

async function handleRollback(
  workdir: string,
  namespace: string,
  artifactId: string,
  incomingMessage: string,
  onPhase: (phase: string) => void,
  onChunk: (chunk: string) => void,
): Promise<HandlerResult> {
  onPhase('Processing rollback request');

  const { versions } = await listVersions(workdir, namespace, artifactId);

  if (versions.length === 0) {
    const message = 'No version history available. Cannot rollback.';
    onChunk(message);
    return { message, stateSignal: 'DONE' };
  }

  // Try to find the target version from the message
  const targetLabel = extractVersionLabel(incomingMessage);
  let target: ProposalVersion | undefined;

  if (targetLabel) {
    target = versions.find((v) => v.versionLabel === targetLabel);
  }

  if (!target) {
    // If no specific version mentioned, rollback to previous version
    if (versions.length < 2) {
      const message = 'Only one version exists — nothing to rollback to. Make an edit first.';
      onChunk(message);
      return { message, stateSignal: 'DONE' };
    }
    target = versions[versions.length - 2]; // Second-to-last
  }

  onPhase(`Rolling back to ${target.versionLabel}`);

  const rollbackVersion = await rollbackToVersion(
    workdir,
    namespace,
    artifactId,
    target.id,
    'user',
  );

  const message = [
    `Rolled back to **${target.versionLabel}**.`,
    '',
    `Saved as **${rollbackVersion.versionLabel}** — your version history is preserved.`,
    '',
    `Say **"show history"** to view the full timeline.`,
  ].join('\n');

  onChunk(message);

  return {
    message,
    stateSignal: 'DONE',
    actions: {
      openProposalUrl: `/proposals/${namespace}/${artifactId}`,
    },
  };
}
