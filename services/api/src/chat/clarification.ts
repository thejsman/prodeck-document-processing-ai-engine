// services/api/src/chat/clarification.ts
//
// Chat Pipeline Stage 1.5 — Clarification Gate (pure, deterministic, no LLM).
//
// Runs after Intent Classification (Stage 1) and before Requirement Extraction
// (Stage 2). When a user names a generation artifact but gives no actionable
// specifics — e.g. just "microsite", "landing page", "one pager site" — we do
// not guess a shape and generate. Instead we ask a short, domain-scoped
// questionnaire and let the answers resume the flow via `awaitingInput`.
//
// This is the deterministic embodiment of Golden Rules #4 (deterministic layers
// override LLM decisions) and #6 (missing input → ask, never guess).
//
// Scope: microsite generation. Bare proposal requests are handled upstream —
// they classify deterministically (kw_proposal_bare) and the readiness engine
// already asks for the missing required fields. This gate covers the gap the
// readiness engine cannot: intents whose "shape" (source, audience, style) is
// underspecified rather than whose required fields are missing.

import type { ChatContext, Intent } from './intents.js';
import { MICROSITE_ARTIFACT, isBareArtifactRequest } from './vocabulary.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClarificationQuestion {
  /** Stable key for the question (used by the frontend QuestionsBlock). */
  field: string;
  /** Human-readable contextual question. */
  question: string;
}

export interface ClarificationResult {
  /** Intent the user's answers should resume as (persisted via awaitingInput). */
  resumeIntent: Intent;
  /** Intro line shown above the questions. */
  intro: string;
  /** Contextual questions to ask before generating. */
  questions: ClarificationQuestion[];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Decide whether the current turn needs clarification before generation.
 * Returns a ClarificationResult when the pipeline should halt and ask, or
 * null when it should proceed normally.
 */
export function detectClarification(
  intent: Intent,
  message: string,
  chatContext: ChatContext,
): ClarificationResult | null {
  // Never interrupt an in-progress confirmation, or a resume of this same
  // intent (the answer turn re-enters here — clarifying again would loop).
  if (chatContext.awaitingConfirmation) return null;
  if (chatContext.awaitingInput?.intent === intent) return null;

  if (intent === 'GENERATE_MICROSITE') {
    return clarifyMicrosite(message, chatContext);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Microsite clarification
// ---------------------------------------------------------------------------

function clarifyMicrosite(
  message: string,
  ctx: ChatContext,
): ClarificationResult | null {
  // Only clarify a bare request. "generate a microsite from the acme proposal
  // with a dark theme" carries its own specifics — let it proceed.
  if (!isBareArtifactRequest(message, MICROSITE_ARTIFACT)) return null;

  const ready = ctx.proposals.filter(
    (p) => p.status === 'approved' || p.status === 'finalized',
  );

  // With no approved/finalized proposal there is nothing to build from. The
  // readiness engine's blocker ("approve a proposal first") is the right guide
  // here — a "which proposal?" questionnaire would be misleading. Skip.
  if (ready.length === 0) return null;

  const names = ready.map((p) => shortProposalName(p.fileName));
  const sourceQuestion =
    ready.length === 1
      ? `I'll build it from **${names[0]}** — use that, or point me at a different proposal?`
      : `Which proposal should the microsite be built from? (${names.join(', ')})`;

  return {
    resumeIntent: 'GENERATE_MICROSITE',
    intro:
      'Happy to build a microsite — a one-page presentation site made from a proposal. ' +
      'A couple of quick questions so it comes out right:',
    questions: [
      { field: 'micrositeSource', question: sourceQuestion },
      {
        field: 'micrositeAudience',
        question:
          "Who is it for, and what's the goal? (e.g. client pitch, investor overview, internal review)",
      },
      {
        field: 'micrositeStyle',
        question:
          'Any style or theme preference? (e.g. dark & premium, clean & minimal, bold & colorful — or say "you pick")',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Turns "acme::acme_proposal_v1.md" into "acme_proposal_v1". */
function shortProposalName(fileName: string): string {
  const base = fileName.includes('::') ? fileName.split('::')[1]! : fileName;
  return base.replace(/\.md$/i, '');
}
