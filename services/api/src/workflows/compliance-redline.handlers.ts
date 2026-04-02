/**
 * Compliance Redline — workflow handlers.
 *
 * Analyses a proposal for legal risks, compliance gaps, weak language, and
 * contradictions.  Presents issues grouped by severity and offers:
 *   - "Apply fix"  — rewrites the affected span and creates a version snapshot
 *   - "Ignore"     — marks the issue dismissed and moves on
 *   - "Explain"    — elaborates on why the issue is flagged
 *
 * States:
 *   analyzing     — LLM analyses the full proposal (agent)
 *   reviewing     — present issues and wait for user action (input)
 *   applying_fix  — apply a chosen fix and re-present remaining issues (agent)
 *   completed     — terminal state (system)
 *
 * Trigger: "check compliance", "compliance review", "review for legal", etc.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { HandlerResult, HandlerContext } from './proposal-generation.handlers.js';
import { findLatestArtifact, createVersionFromEdit } from '../proposals/proposal-version.service.js';
import { llmGenerateFn } from '../agent-routes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IssueSeverity = 'high' | 'medium' | 'low';

export interface RedlineIssue {
  id: string;
  issue: string;
  section: string;
  severity: IssueSeverity;
  original: string;
  suggestion: string;
}

// ---------------------------------------------------------------------------
// LLM analysis
// ---------------------------------------------------------------------------

async function analyseProposal(
  proposalContent: string,
  rfpRequirements?: string,
): Promise<RedlineIssue[]> {
  const rfpBlock = rfpRequirements
    ? `\n\nRFP Requirements for compliance reference:\n${rfpRequirements.slice(0, 3000)}`
    : '';

  const prompt = [
    'You are a legal and compliance reviewer for business proposals.',
    'Analyse the proposal below for the following issues:',
    '1. Legal risks — over-promising, guarantees, unqualified absolutes (e.g. "100% uptime", "guaranteed results")',
    '2. Compliance gaps — elements required by the RFP that are missing or insufficiently addressed',
    '3. Weak or vague language — "we will try", "approximately", "as soon as possible"',
    '4. Internal contradictions — conflicting claims within the proposal',
    '',
    'For each issue found, return a JSON object with:',
    '  - id: unique string (e.g. "issue-1")',
    '  - issue: short description of the problem',
    '  - section: the ## section heading where the issue appears',
    '  - severity: "high" | "medium" | "low"',
    '  - original: the exact problematic phrase or sentence (verbatim)',
    '  - suggestion: a safe replacement that addresses the issue',
    '',
    'Return a JSON array. Return [] if no issues found.',
    'Output ONLY the raw JSON array — no markdown fences, no commentary.',
    rfpBlock,
    '',
    'Proposal:',
    proposalContent.slice(0, 8000),
  ].join('\n');

  try {
    const raw = await llmGenerateFn(prompt);
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    const parsed = JSON.parse(cleaned) as unknown[];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item, i) => ({
        id:         typeof item.id         === 'string' ? item.id         : `issue-${i + 1}`,
        issue:      typeof item.issue      === 'string' ? item.issue      : 'Unknown issue',
        section:    typeof item.section    === 'string' ? item.section    : 'Unknown section',
        severity:   (['high', 'medium', 'low'].includes(item.severity as string)
          ? item.severity : 'medium') as IssueSeverity,
        original:   typeof item.original   === 'string' ? item.original   : '',
        suggestion: typeof item.suggestion === 'string' ? item.suggestion : '',
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  high:   '🔴 High',
  medium: '🟡 Medium',
  low:    '🟢 Low',
};

function buildRedlineMessage(issues: RedlineIssue[], dismissed: string[]): string {
  const active = issues.filter((i) => !dismissed.includes(i.id));

  if (active.length === 0) {
    return 'No compliance issues remain. The proposal looks clean.';
  }

  const byGroup = { high: [] as RedlineIssue[], medium: [] as RedlineIssue[], low: [] as RedlineIssue[] };
  for (const issue of active) byGroup[issue.severity].push(issue);

  const lines = [
    `I found **${active.length}** compliance issue${active.length !== 1 ? 's' : ''}:`,
    '',
  ];

  for (const severity of ['high', 'medium', 'low'] as IssueSeverity[]) {
    const group = byGroup[severity];
    if (group.length === 0) continue;

    lines.push(`**${SEVERITY_LABEL[severity]}**`);
    for (const issue of group) {
      lines.push('');
      lines.push(`**[${issue.id}] ${issue.issue}** — *${issue.section}*`);
      lines.push(`> ~~${issue.original}~~`);
      lines.push(`> → ${issue.suggestion}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('Reply with:');
  lines.push('• **apply [id]** — apply the suggested fix (e.g. "apply issue-1")');
  lines.push('• **apply all** — apply all fixes at once');
  lines.push('• **ignore [id]** — dismiss an issue');
  lines.push('• **explain [id]** — get more detail on an issue');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Intent detection for user replies
// ---------------------------------------------------------------------------

type UserAction =
  | { type: 'apply'; id: string }
  | { type: 'apply_all' }
  | { type: 'ignore'; id: string }
  | { type: 'explain'; id: string }
  | { type: 'unknown' };

function parseUserAction(message: string): UserAction {
  const lower = message.toLowerCase().trim();

  if (lower === 'apply all' || lower === 'fix all' || lower === 'apply all fixes') {
    return { type: 'apply_all' };
  }

  const applyMatch = lower.match(/^(?:apply|fix)\s+(issue-\d+|\w+-\d+)/);
  if (applyMatch) return { type: 'apply', id: applyMatch[1] };

  const ignoreMatch = lower.match(/^ignore\s+(issue-\d+|\w+-\d+)/);
  if (ignoreMatch) return { type: 'ignore', id: ignoreMatch[1] };

  const explainMatch = lower.match(/^explain\s+(issue-\d+|\w+-\d+)/);
  if (explainMatch) return { type: 'explain', id: explainMatch[1] };

  return { type: 'unknown' };
}

// ---------------------------------------------------------------------------
// Fix application — replace original span in proposal markdown
// ---------------------------------------------------------------------------

async function applyFix(
  filePath: string,
  issue: RedlineIssue,
): Promise<string> {
  const content = await readFile(filePath, 'utf-8');

  if (!issue.original || !content.includes(issue.original)) {
    // Original span not found verbatim — return content unchanged
    return content;
  }

  return content.replace(issue.original, issue.suggestion);
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

/**
 * Load the proposal, run LLM compliance analysis, store issues in context.
 */
export async function handleAnalyzing(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, onPhase } = ctx;

  onPhase('Loading proposal');

  let artifactId = instance.context.proposalArtifactId as string | undefined;
  if (!artifactId) {
    artifactId = (await findLatestArtifact(workdir, namespace)) ?? undefined;
  }

  if (!artifactId) {
    return {
      message: 'No proposal found in this namespace. Generate a proposal first.',
      stateSignal: 'DONE',
    };
  }

  instance.context.proposalArtifactId = artifactId;
  instance.context.dismissedIssues = [];

  const filePath = path.join(workdir, 'namespaces', namespace, 'proposals', artifactId);
  let proposalContent: string;
  try {
    proposalContent = await readFile(filePath, 'utf-8');
  } catch {
    return {
      message: `Could not read proposal **${artifactId}**.`,
      stateSignal: 'DONE',
    };
  }

  onPhase('Analysing compliance');

  const rfpRequirements = instance.context.rfpRequirements as string | undefined;
  const issues = await analyseProposal(proposalContent, rfpRequirements);

  instance.context.redlineIssues = issues;
  instance.context.redlineArtifactPath = filePath;

  if (issues.length === 0) {
    return {
      message: 'The proposal looks clean — no compliance issues detected.',
      stateSignal: 'DONE',
    };
  }

  return { message: '', stateSignal: 'READY' };
}

/**
 * Present issues grouped by severity and await user action.
 */
export async function handleReviewing(ctx: HandlerContext): Promise<HandlerResult> {
  const { instance, incomingMessage } = ctx;

  const issues = (instance.context.redlineIssues ?? []) as RedlineIssue[];
  const dismissed = (instance.context.dismissedIssues ?? []) as string[];
  const active = issues.filter((i) => !dismissed.includes(i.id));

  // First entry — present issues without processing user action
  if (!instance.context.redlinePresented) {
    instance.context.redlinePresented = true;
    return { message: buildRedlineMessage(issues, dismissed) };
  }

  // Process user reply
  const action = parseUserAction(incomingMessage);

  if (action.type === 'apply') {
    const issue = active.find((i) => i.id === action.id);
    if (!issue) {
      return { message: `Issue **${action.id}** not found. ${buildRedlineMessage(issues, dismissed)}` };
    }
    instance.context.pendingFixId = action.id;
    return { message: '', stateSignal: 'APPLY' };
  }

  if (action.type === 'apply_all') {
    instance.context.pendingFixId = 'all';
    return { message: '', stateSignal: 'APPLY' };
  }

  if (action.type === 'ignore') {
    const issue = active.find((i) => i.id === action.id);
    if (issue) {
      instance.context.dismissedIssues = [...dismissed, action.id];
    }
    const newDismissed = (instance.context.dismissedIssues ?? []) as string[];
    const remaining = issues.filter((i) => !newDismissed.includes(i.id));
    if (remaining.length === 0) {
      return { message: 'All issues dismissed. The proposal is ready.', stateSignal: 'DONE' };
    }
    return { message: buildRedlineMessage(issues, newDismissed) };
  }

  if (action.type === 'explain') {
    const issue = issues.find((i) => i.id === action.id);
    if (!issue) {
      return { message: `Issue **${action.id}** not found.` };
    }
    const explanation = await llmGenerateFn([
      `Explain in 2–3 sentences why the following proposal language is a compliance or legal risk:`,
      `Issue type: ${issue.issue}`,
      `Problematic text: "${issue.original}"`,
      `Section: ${issue.section}`,
      'Be specific about the risk and why the suggested fix is safer.',
    ].join('\n'));
    return { message: `**[${issue.id}] Explanation:**\n\n${explanation}\n\n---\n\n${buildRedlineMessage(issues, dismissed)}` };
  }

  // Unknown reply — re-present the issues
  return { message: `I didn't understand that. ${buildRedlineMessage(issues, dismissed)}` };
}

/**
 * Apply one or all pending fixes to the proposal file and create a version snapshot.
 */
export async function handleApplyingFix(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, onPhase } = ctx;

  const issues        = (instance.context.redlineIssues        ?? []) as RedlineIssue[];
  const dismissed     = (instance.context.dismissedIssues      ?? []) as string[];
  const filePath      = instance.context.redlineArtifactPath   as string | undefined;
  const artifactId    = instance.context.proposalArtifactId    as string | undefined;
  const pendingFixId  = instance.context.pendingFixId          as string | undefined;

  if (!filePath || !artifactId) {
    return { message: 'Proposal not found.', stateSignal: 'REVIEW' };
  }

  const toFix = pendingFixId === 'all'
    ? issues.filter((i) => !dismissed.includes(i.id))
    : issues.filter((i) => i.id === pendingFixId);

  if (toFix.length === 0) {
    return { message: 'No issues to apply.', stateSignal: 'REVIEW' };
  }

  onPhase(`Applying ${toFix.length > 1 ? 'all fixes' : `fix for ${toFix[0].id}`}`);

  let updatedContent: string;
  try {
    updatedContent = await readFile(filePath, 'utf-8');
    for (const issue of toFix) {
      if (issue.original && updatedContent.includes(issue.original)) {
        updatedContent = updatedContent.replace(issue.original, issue.suggestion);
      }
    }
    await writeFile(filePath, updatedContent, 'utf-8');
  } catch {
    return { message: 'Failed to apply fixes to the proposal file.', stateSignal: 'REVIEW' };
  }

  // Version snapshot
  onPhase('Saving version');
  try {
    const summary = toFix.length === 1
      ? `Compliance fix: ${toFix[0].issue}`
      : `Applied ${toFix.length} compliance fixes`;
    await createVersionFromEdit(workdir, namespace, artifactId, updatedContent, null, 'compliance', summary);
  } catch {
    // Non-fatal
  }

  // Mark fixed issues as dismissed so they don't re-appear
  const nowDismissed = [...dismissed, ...toFix.map((i) => i.id)];
  instance.context.dismissedIssues = nowDismissed;
  instance.context.pendingFixId = undefined;

  const remaining = issues.filter((i) => !nowDismissed.includes(i.id));

  if (remaining.length === 0) {
    return {
      message: `All fixes applied. The proposal has been updated and saved as a new version.`,
      stateSignal: 'DONE',
      actions: { openProposalUrl: `/proposals/${namespace}/${artifactId}` },
    };
  }

  const summary = toFix.length === 1
    ? `Fix applied for **${toFix[0].id}**. ${remaining.length} issue${remaining.length !== 1 ? 's' : ''} remaining.`
    : `All ${toFix.length} fixes applied. ${remaining.length} issue${remaining.length !== 1 ? 's' : ''} remaining.`;

  return {
    message: `${summary}\n\n${buildRedlineMessage(issues, nowDismissed)}`,
    stateSignal: 'REVIEW',
  };
}
