/**
 * Namespace insight rule engine — deterministic, stateless.
 *
 * Takes a NamespaceInsights snapshot and returns a list of human-readable
 * suggestion strings ordered by priority.  Rules are evaluated in sequence;
 * all matching rules contribute to the output (not first-match-only).
 *
 * Rules are intentionally simple and explicit.  Add new rules here rather
 * than embedding logic in calling code.
 */

import type { NamespaceInsights } from './namespace-intelligence.service.js';

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

/**
 * Derive a prioritised list of actionable suggestions from namespace insights.
 * Returns an empty array when the namespace state looks complete.
 */
export function deriveInsightSuggestions(insights: NamespaceInsights): string[] {
  const suggestions: string[] = [];

  // ── Critical — nothing to work with yet ──────────────────────────
  if (insights.indexedDocumentCount === 0 && insights.ingestionPendingCount === 0) {
    suggestions.push('No documents indexed yet — upload files to get started.');
    return suggestions; // nothing else is actionable until we have documents
  }

  // ── In-progress ingestion ─────────────────────────────────────────
  if (insights.ingestionPendingCount > 0) {
    const plural = insights.ingestionPendingCount === 1 ? 'document is' : 'documents are';
    suggestions.push(
      `${insights.ingestionPendingCount} ${plural} still being processed — results will update shortly.`,
    );
  }

  // ── RFP presence ─────────────────────────────────────────────────
  if (!insights.hasRfp && insights.indexedDocumentCount > 0) {
    suggestions.push(
      'No RFP document detected — upload one to enable proposal generation.',
    );
  }

  // ── Pricing document ─────────────────────────────────────────────
  if (insights.hasRfp && !insights.hasPricingDoc) {
    suggestions.push(
      'Pricing document missing — consider uploading a rate card or cost estimate.',
    );
  }

  // ── Proposal drafts ───────────────────────────────────────────────
  if (insights.proposalDraftCount > 0) {
    const noun = insights.proposalDraftCount === 1 ? 'draft' : 'drafts';
    suggestions.push(
      `You have ${insights.proposalDraftCount} proposal ${noun} — say "Continue proposal" to pick up where you left off.`,
    );
  }

  // ── Ready to generate ─────────────────────────────────────────────
  if (
    insights.hasRfp &&
    insights.proposalDraftCount === 0 &&
    insights.ingestionPendingCount === 0
  ) {
    suggestions.push(
      'RFP is ready — say "Create a proposal" to begin proposal generation.',
    );
  }

  return suggestions;
}
