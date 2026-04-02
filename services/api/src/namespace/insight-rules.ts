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
// Types
// ---------------------------------------------------------------------------

export interface TemplateInsight {
  /** Matched template name (human-readable). */
  templateName?: string;
  /** Confidence score 0–1. */
  confidence: number;
  /** When true, no template matched — will generate a custom structure. */
  fallbackGenerate: boolean;
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

/**
 * Derive a prioritised list of actionable suggestions from namespace insights.
 * Returns an empty array when the namespace state looks complete.
 *
 * @param insights       - Filesystem scan result for the namespace.
 * @param templateInsight - Optional template recommendation result. When
 *                         omitted the "ready to generate" rule falls back to
 *                         the generic message without template detail.
 */
export function deriveInsightSuggestions(
  insights: NamespaceInsights,
  templateInsight?: TemplateInsight | null,
): string[] {
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

  if (insights.hasRfp) {
    // ── Pricing document ───────────────────────────────────────────
    if (!insights.hasPricingDoc) {
      suggestions.push(
        'Pricing document missing — consider uploading a rate card or cost estimate.',
      );
    }

    // ── Template recommendation ────────────────────────────────────
    // Only shown when no draft exists yet (avoids redundant suggestions).
    if (insights.proposalDraftCount === 0 && insights.ingestionPendingCount === 0) {
      if (!templateInsight) {
        // Recommendation not yet available — nudge but don't block
        suggestions.push(
          'Select a proposal template on the Proposal page before generating.',
        );
      } else if (templateInsight.fallbackGenerate) {
        suggestions.push(
          'No template matches your RFP — say "Create a template" to build one from your RFP, or "Create a proposal" to generate with a custom structure.',
        );
      } else {
        const pct = Math.round(templateInsight.confidence * 100);
        const name = templateInsight.templateName ?? 'a template';
        suggestions.push(
          `★ "${name}" template recommended (${pct}% match) — say "Create a proposal" to begin.`,
        );
      }
    }
  }

  // ── Proposal drafts ───────────────────────────────────────────────
  if (insights.proposalDraftCount > 0) {
    const noun = insights.proposalDraftCount === 1 ? 'draft' : 'drafts';
    suggestions.push(
      `You have ${insights.proposalDraftCount} proposal ${noun} — say "Continue proposal" to pick up where you left off.`,
    );
  }

  return suggestions;
}
