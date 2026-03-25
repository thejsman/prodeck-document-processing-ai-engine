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

import type { HandlerResult, HandlerContext } from './proposal-generation.handlers.js';
import {
  listVersions,
  rollbackToVersion,
  findLatestArtifact,
  type ProposalVersion,
} from '../../../proposals/proposal-version.service.js';

// ---------------------------------------------------------------------------
// Sub-intent detection
// ---------------------------------------------------------------------------

type VersionAction = 'show_history' | 'rollback';

const HISTORY_KEYWORDS = ['history', 'versions', 'list version', 'show version', 'timeline'];
const ROLLBACK_KEYWORDS = ['rollback', 'roll back', 'revert', 'restore', 'undo', 'go back'];

function detectAction(message: string): VersionAction {
  const lower = message.toLowerCase();

  // Rollback is higher priority — user wants to act
  for (const kw of ROLLBACK_KEYWORDS) {
    if (lower.includes(kw)) return 'rollback';
  }

  // Default to history display
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
