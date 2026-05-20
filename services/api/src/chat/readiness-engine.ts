// services/api/src/chat/readiness-engine.ts
//
// Chat Pipeline Stage 4 — Readiness Engine (pure, deterministic, no LLM).
//
// Checks whether the namespace has enough information to execute the requested
// intent. Missing required fields → ask the user. Failed custom checks →
// blocker messages. Only when both pass is the pipeline allowed to continue.

import type { NamespaceContext, RequirementKey } from './context.types.js';
import type { Intent, ChatContext } from './intents.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MissingField {
  field: RequirementKey
  question: string
  required: boolean
}

export interface ReadinessResult {
  ready: boolean
  missingFields: MissingField[]
  blockers: string[]
}

// ---------------------------------------------------------------------------
// Internal rule shapes
// ---------------------------------------------------------------------------

interface FieldSpec {
  field: RequirementKey
  question: string
}

interface CustomCheckResult {
  ready: boolean
  blockers: string[]
}

interface ReadinessCheck {
  required: FieldSpec[]
  optional: FieldSpec[]
  customCheck: ((ctx: ChatContext) => CustomCheckResult) | null
}

// ---------------------------------------------------------------------------
// Rule table (spec section 7 — every intent must be present)
// ---------------------------------------------------------------------------

const READINESS_RULES: Record<Intent, ReadinessCheck> = {
  GENERATE_PROPOSAL: {
    required: [
      { field: 'clientName', question: 'What is the client or company name?' },
      { field: 'projectType', question: 'What service are we providing? (e.g., digital marketing, web development, IT consulting, brand strategy)' },
      { field: 'clientIndustry', question: 'What industry is the client in? (e.g., real estate, healthcare, fintech, restaurant)' },
    ],
    optional: [
      { field: 'budget', question: 'Do you have a rough budget range?' },
      { field: 'timeline', question: 'What is the expected timeline?' },
    ],
    customCheck: null,
  },

  MODIFY_PROPOSAL: {
    required: [],
    optional: [],
    customCheck: (ctx) => {
      if (ctx.proposals.length === 0) {
        return { ready: false, blockers: ['No proposals exist in this namespace. Generate one first.'] }
      }
      return { ready: true, blockers: [] }
    },
  },

  GENERATE_MICROSITE: {
    required: [],
    optional: [],
    customCheck: (ctx) => {
      const eligible = ctx.proposals.filter(
        (p) => p.status === 'approved' || p.status === 'finalized',
      )
      if (eligible.length === 0) {
        const drafts = ctx.proposals.filter(
          (p) => p.status === 'draft' || p.status === 'under_review',
        )
        if (drafts.length > 0) {
          return {
            ready: false,
            blockers: [
              `No approved/finalized proposals. You have ${drafts.length} in draft/review. Approve one first, or I can change the status.`,
            ],
          }
        }
        return {
          ready: false,
          blockers: ['No proposals exist. Generate and approve a proposal first.'],
        }
      }
      return { ready: true, blockers: [] }
    },
  },

  GENERATE_TEMPLATE: { required: [], optional: [], customCheck: null },

  MODIFY_TEMPLATE: {
    required: [],
    optional: [],
    customCheck: (ctx) => {
      if (ctx.templates.length === 0) {
        return { ready: false, blockers: ['No templates exist. Create one first.'] }
      }
      return { ready: true, blockers: [] }
    },
  },

  UPDATE_REQUIREMENTS: { required: [], optional: [], customCheck: null },
  QUERY: { required: [], optional: [], customCheck: null },
  STATUS_CHECK: { required: [], optional: [], customCheck: null },
  INGEST_GUIDANCE: { required: [], optional: [], customCheck: null },
  GREETING: { required: [], optional: [], customCheck: null },
  // GENERAL_CHAT is always "ready" — the pipeline then routes it to a
  // deterministic decline response. Blocking it here would be wrong.
  GENERAL_CHAT: { required: [], optional: [], customCheck: null },
  UNKNOWN: { required: [], optional: [], customCheck: null },
  // Confirmation intents are always "ready" — the gate handles them directly
  CONFIRM_ENTITIES: { required: [], optional: [], customCheck: null },
  CONFIRM_TEMPLATE: { required: [], optional: [], customCheck: null },
  CREATE_SKILL: { required: [], optional: [], customCheck: null },
  MODIFY_SKILL: {
    required: [],
    optional: [],
    customCheck: (ctx) => {
      if (!ctx.skills?.length) {
        return { ready: false, blockers: ['No skills exist. Create one first on the Skills page or say "create a skill".'] }
      }
      return { ready: true, blockers: [] }
    },
  },
  LIST_SKILLS: { required: [], optional: [], customCheck: null },
  LIST_DESIGN_SKILLS: { required: [], optional: [], customCheck: null },
  CLIENT_DATA_COLLECTION: { required: [], optional: [], customCheck: null },
}

// ---------------------------------------------------------------------------
// checkReadiness
// ---------------------------------------------------------------------------

export function checkReadiness(
  intent: Intent,
  context: NamespaceContext | null,
  chatContext: ChatContext,
): ReadinessResult {
  const rules = READINESS_RULES[intent]
  const missingFields: MissingField[] = []
  const blockers: string[] = []

  // Required field checks — field missing or has no value → collect
  for (const spec of rules.required) {
    const field = context?.requirements?.fields[spec.field]
    if (!field?.value) {
      missingFields.push({ field: spec.field, question: spec.question, required: true })
    }
  }

  // Optional field checks — always collected so the caller can decide
  // whether to surface them as follow-up questions, but they never block.
  for (const spec of rules.optional) {
    const field = context?.requirements?.fields[spec.field]
    if (!field?.value) {
      missingFields.push({ field: spec.field, question: spec.question, required: false })
    }
  }

  // Custom check (e.g. "does a proposal exist?")
  if (rules.customCheck) {
    const result = rules.customCheck(chatContext)
    if (!result.ready) {
      blockers.push(...result.blockers)
    }
  }

  const requiredMissing = missingFields.filter((f) => f.required)
  return {
    ready: requiredMissing.length === 0 && blockers.length === 0,
    missingFields,
    blockers,
  }
}
