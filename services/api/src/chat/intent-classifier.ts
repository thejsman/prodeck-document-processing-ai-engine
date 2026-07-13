// services/api/src/chat/intent-classifier.ts
//
// Hybrid intent classifier for the Chat V2 pipeline (Stage 1).
//
// Deterministic rules fire first — ordered from most-specific to least-specific.
// LLM fallback is called only when no rule matches, and its output is always
// validated before use. This keeps the common case zero-cost.

import type { GenerateFn } from '@ai-engine/planner';
import {
  VALID_INTENTS,
  type ChatContext,
  type ClassificationResult,
  type Intent,
} from './intents.js';
import {
  PROPOSAL_ARTIFACT,
  isBareArtifactRequest,
  isMicrositeRequest,
} from './vocabulary.js';

// ---------------------------------------------------------------------------
// Generative-intent disambiguation policy
// ---------------------------------------------------------------------------
//
// Generative intents produce a durable, hard-to-undo artifact. When the intent
// comes from a deterministic rule we trust it. But when it comes from the LLM
// fallback — i.e. no rule matched, the request was inherently vague — we must
// NOT let a merely-plausible guess trigger generation. If the LLM is not
// confident (gray band) or itself reports other plausible generative actions,
// we ask the user which one they meant rather than silently generating the
// wrong thing (Golden Rule #6 — ask, never guess).

const GENERATIVE_INTENTS: ReadonlySet<Intent> = new Set<Intent>([
  'GENERATE_PROPOSAL',
  'GENERATE_DOCUMENT',
  'GENERATE_MICROSITE',
  'GENERATE_TEMPLATE',
]);

/**
 * LLM self-confidence at or above this bar is trusted to auto-generate.
 * Below it (but at/above the 0.6 UNKNOWN floor) a generative intent is treated
 * as ambiguous and routed to disambiguation.
 */
const GENERATIVE_COMMIT_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Rule table (spec section 4.2 — order is load-bearing, first match wins)
// ---------------------------------------------------------------------------

const INTENT_RULES: Array<{
  id: string
  test: (message: string, context: ChatContext) => boolean
  intent: Intent
  confidence: number
}> = [
  // --- KEYWORD (most-specific to least-specific) ---
  // Keyword rules come first so an explicit intent always interrupts any
  // awaiting-input state. Contextual rules are fallbacks for short answers
  // that have no keyword signal (e.g. "yes", "acme corp").
  {
    // Flexible microsite vocabulary lives in vocabulary.ts — users can say
    // "microsite", "landing page", "one pager site", "mini-site", "splash
    // page", "single page site", "presentation", etc. Add a synonym there.
    id: 'kw_microsite',
    test: (msg) => isMicrositeRequest(msg),
    intent: 'GENERATE_MICROSITE',
    confidence: 0.90,
  },
  {
    id: 'kw_template_create',
    test: (msg) => /\b(create|generate|build|new)\b.*\btemplate\b/i.test(msg),
    intent: 'GENERATE_TEMPLATE',
    confidence: 0.90,
  },
  {
    id: 'kw_template_modify',
    test: (msg) => /\b(modify|edit|change|update|add|remove)\b.*\btemplate\b/i.test(msg),
    intent: 'MODIFY_TEMPLATE',
    confidence: 0.90,
  },
  {
    id: 'kw_proposal_edit',
    test: (msg) => /\b(make|rewrite|shorten|expand|improve|edit|change)\b.*\b(section|summary|pricing|exec)/i.test(msg),
    intent: 'MODIFY_PROPOSAL',
    confidence: 0.85,
  },
  {
    id: 'kw_proposal_create',
    test: (msg) => /\b(create|generate|write|draft|build|need)\b.*\bproposal\b/i.test(msg),
    intent: 'GENERATE_PROPOSAL',
    confidence: 0.90,
  },
  {
    // Bare "proposal" (no verb, no context) previously fell through to the LLM,
    // which could not tell what to do. Classify it deterministically so the
    // readiness engine can ask for the missing required fields (client, service,
    // industry). Guarded against bare-detection false positives ("list proposals"
    // → kw_status; plural "proposals" is not matched) and never hijacks an
    // in-progress confirmation flow.
    id: 'kw_proposal_bare',
    test: (msg, ctx) => !ctx.awaitingConfirmation && isBareArtifactRequest(msg, PROPOSAL_ARTIFACT),
    intent: 'GENERATE_PROPOSAL',
    confidence: 0.80,
  },
  {
    id: 'kw_requirement_update',
    test: (msg) => /(\$[\d,]+|budget\s*(is|changed|updated|=)|timeline\s*(is|changed)|they\s+(want|prefer|need|require))/i.test(msg),
    intent: 'UPDATE_REQUIREMENTS',
    confidence: 0.85,
  },
  {
    id: 'kw_approve_proposal',
    test: (msg, ctx) =>
      ctx.awaitingConfirmation?.kind !== 'confirm_template' &&
      ctx.awaitingConfirmation?.kind !== 'approve_generated_template' &&
      /\b(approve|finalize|reject|mark\s+as\s+(approved|finalized|rejected))\b/i.test(msg),
    intent: 'STATUS_CHECK',
    confidence: 0.88,
  },
  {
    id: 'kw_skill_create',
    test: (msg) => /\b(create|build|make|new)\b.*\bskill\b/i.test(msg),
    intent: 'CREATE_SKILL',
    confidence: 0.90,
  },
  {
    id: 'kw_skill_modify',
    test: (msg) => /\b(edit|modify|change|update)\b.*\bskill\b/i.test(msg),
    intent: 'MODIFY_SKILL',
    confidence: 0.90,
  },
  {
    id: 'kw_skill_list',
    test: (msg) => /\b(list|show|which)\b.*\bskills?\b/i.test(msg),
    intent: 'LIST_SKILLS',
    confidence: 0.85,
  },
  {
    id: 'kw_status',
    test: (msg) => /\b(status|version|history|list\s+proposals?|show\s+me)\b/i.test(msg),
    intent: 'STATUS_CHECK',
    confidence: 0.80,
  },
  {
    id: 'kw_query',
    test: (msg) => /\b(what|how|when|who|tell\s+me|requirements?|summarize|search)\b/i.test(msg),
    intent: 'QUERY',
    confidence: 0.70,
  },
  {
    id: 'kw_upload',
    test: (msg) => /\b(upload|ingest|add\s+documents?|import)\b/i.test(msg),
    intent: 'INGEST_GUIDANCE',
    confidence: 0.85,
  },
  // --- CLIENT DATA COLLECTION ---
  // --- DOCUMENT GENERATION ---
  {
    id: 'kw_document_download',
    test: (msg) =>
      /\b(download|export|send)\b.*\b(as|in)\s+(a\s+)?(word\s+doc(ument)?|\.docx|pdf|powerpoint|\.pptx|notion|txt|text\s+file|markdown)\b/i.test(msg) ||
      /\b(as\s+a\s+(pdf|word|docx|pptx|powerpoint|notion|txt))\b/i.test(msg),
    intent: 'DOWNLOAD_ARTIFACT' as Intent,
    confidence: 0.92,
  },
  {
    id: 'kw_document_generate',
    test: (msg) =>
      // Explicit document type nouns
      /\b(strategy\s+doc(ument)?|strategic\s+(plan|document)|go[\s-]to[\s-]market|gtm\s+(strategy|plan|doc)|roadmap\s+(doc|plan)?|growth\s+strategy|market\s+(entry|strategy)|competitive\s+analysis)\b/i.test(msg) ||
      /\b(blog\s+post|blog\s+article|thought\s+leadership|write\s+(a\s+)?blog|content\s+piece|newsletter\s+(draft|content))\b/i.test(msg) ||
      /\b(marketing\s+brief|campaign\s+brief|one[\s-]pager|brand\s+brief|launch\s+brief|marketing\s+plan)\b/i.test(msg) ||
      /\b(executive\s+report|stakeholder\s+report|findings\s+report|quarterly\s+report|data\s+report|progress\s+report|status\s+report)\b/i.test(msg) ||
      /\b(presentation\s+deck|slide\s+deck|pitch\s+deck|investor\s+deck|stakeholder\s+deck|create\s+(a\s+)?slides?|build\s+(a\s+)?deck|write\s+(a\s+)?deck)\b/i.test(msg) ||
      // Generic "write/create/draft/generate a/an <document>" patterns
      /\b(write|create|draft|generate|produce|build)\b.{0,30}\b(document|doc|report|brief|article|post|deck|playbook|guide|summary|overview|plan)\b/i.test(msg),
    intent: 'GENERATE_DOCUMENT' as Intent,
    confidence: 0.88,
  },
  {
    id: 'kw_client_data',
    test: (msg) => /\b(client\s+(data|info|details|profile|brief)|collect\s+(data|info|details|requirements)|build\s+(client|brief|profile)|scrape\s+(website|url|site)|client\s+website)\b/i.test(msg),
    intent: 'CLIENT_DATA_COLLECTION' as Intent,
    confidence: 0.88,
  },
  {
    id: 'ctx_awaiting_client_data',
    test: (_msg, ctx) => ctx.awaitingInput?.intent === 'CLIENT_DATA_COLLECTION',
    intent: 'CLIENT_DATA_COLLECTION' as Intent,
    confidence: 0.95,
  },
  {
    id: 'kw_greeting',
    test: (msg) => /^(hi|hello|hey|good\s+(morning|afternoon|evening)|what'?s\s+up)\b/i.test(msg) && msg.length < 30,
    intent: 'GREETING',
    confidence: 0.95,
  },

  // --- BYPASS (fires before confirmation rules so "just generate it" always escapes) ---
  {
    id: 'kw_bypass_confirmation',
    test: (msg, ctx) =>
      ctx.awaitingConfirmation != null &&
      /\b(just\s+(generate|do|make|create|proceed|use)\b|use\s+defaults?|skip\s+(confirmation|this|all)?\b|proceed\s+anyway|generate\s+(it\s+)?(now|anyway|without\s+confirm)|use\s+what\s+you\s+have)\b/i.test(msg),
    intent: 'GENERATE_PROPOSAL',
    confidence: 0.95,
  },

  // --- CONFIRMATION (awaiting confirmation from Stage 4.5 gate) ---
  // These fire before the generic awaiting-input fallbacks so that "yes/no/approve"
  // replies to a pending confirmation request are routed correctly.
  {
    id: 'ctx_confirm_entities_yes',
    test: (msg, ctx) =>
      ctx.awaitingConfirmation?.kind === 'confirm_entities' &&
      /^(yes|correct|confirmed?|that'?s right|looks? good|proceed|ok|yep|yup|sure)\b/i.test(msg.trim()),
    intent: 'CONFIRM_ENTITIES',
    confidence: 0.97,
  },
  {
    id: 'ctx_confirm_entities_input',
    test: (_msg, ctx) => ctx.awaitingConfirmation?.kind === 'confirm_entities',
    intent: 'CONFIRM_ENTITIES',
    confidence: 0.90,
  },
  {
    id: 'ctx_confirm_template_yes',
    test: (msg, ctx) =>
      (ctx.awaitingConfirmation?.kind === 'confirm_template' ||
       ctx.awaitingConfirmation?.kind === 'approve_generated_template') &&
      /^(yes|approve[d]?|use it|use this|proceed|ok|yep|sure|looks? good|that'?s fine)\b/i.test(msg.trim()),
    intent: 'CONFIRM_TEMPLATE',
    confidence: 0.97,
  },
  {
    id: 'ctx_confirm_template_input',
    test: (_msg, ctx) =>
      ctx.awaitingConfirmation?.kind === 'confirm_template' ||
      ctx.awaitingConfirmation?.kind === 'approve_generated_template',
    intent: 'CONFIRM_TEMPLATE',
    confidence: 0.90,
  },

  // --- CONTEXTUAL (fallback — fires only when no keyword rule matched) ---
  // Handles short answers like "yes", "acme corp", "technology" that carry
  // no keyword signal on their own but make sense as replies to a pending ask.
  {
    id: 'ctx_awaiting_proposal_input',
    test: (_msg, ctx) => ctx.awaitingInput?.intent === 'GENERATE_PROPOSAL',
    intent: 'GENERATE_PROPOSAL',
    confidence: 0.95,
  },
  {
    id: 'ctx_awaiting_microsite_input',
    test: (_msg, ctx) => ctx.awaitingInput?.intent === 'GENERATE_MICROSITE',
    intent: 'GENERATE_MICROSITE',
    confidence: 0.95,
  },
  {
    id: 'ctx_awaiting_status_input',
    test: (_msg, ctx) => ctx.awaitingInput?.intent === 'STATUS_CHECK',
    intent: 'STATUS_CHECK',
    confidence: 0.95,
  },
]

// ---------------------------------------------------------------------------
// LLM fallback prompt (spec section 4.3)
// ---------------------------------------------------------------------------

function buildLLMPrompt(message: string, context: ChatContext): string {
  const activeProposals = context.proposals.map((p) => p.fileName).join(', ') || 'none'
  const recentTopic = context.recentTopic ?? 'none'

  return `Classify the user's intent into exactly one category:

PROJECT-RELATED (about proposals, templates, microsites, documents, client work, skills):
  GENERATE_PROPOSAL, MODIFY_PROPOSAL, GENERATE_TEMPLATE, MODIFY_TEMPLATE,
  GENERATE_MICROSITE, UPDATE_REQUIREMENTS, QUERY, STATUS_CHECK, INGEST_GUIDANCE,
  CREATE_SKILL, MODIFY_SKILL, LIST_SKILLS, CLIENT_DATA_COLLECTION
  CLIENT_DATA_COLLECTION — user wants to provide, collect, or review client data for proposal preparation (uploading files, sharing URLs, answering questions about the client)

NON-PROJECT:
  GREETING — hello, hi, good morning (short social opener)
  GENERAL_CHAT — any message NOT related to proposals, templates, microsites,
    documents, or project work. Includes: general knowledge questions, personal
    requests, jokes, weather, math, coding help, writing emails, off-topic chat.
  UNKNOWN — gibberish, empty, completely unparseable

MICROSITE SYNONYMS: A microsite is a small web presentation built from a proposal.
Treat ALL of these as GENERATE_MICROSITE, even without the word "microsite":
landing page, one-pager / 1-pager, single-page site, single page website, mini-site,
slide deck / slides, "a web page for the proposal", "turn/convert this into a site/page/presentation".

IMPORTANT: If the message is ambiguous but COULD relate to project work
(e.g., "help me with pricing", "summarize this", "analyze the competition"),
classify it as the most relevant project intent (QUERY, UPDATE_REQUIREMENTS, etc.),
NOT as GENERAL_CHAT. Only use GENERAL_CHAT when the message is clearly unrelated
to proposals, templates, microsites, or client project work.

When the message clearly maps to ONE action, return it with high confidence (>= 0.85).
When it could reasonably mean more than one GENERATIVE action — for example a
standalone document vs a full client proposal vs a one-page presentation
microsite — do NOT pick one. Set confidence below 0.85 and list every plausible
action in "alternatives". Asking the user is better than generating the wrong artifact.

Context:
- Namespace: ${context.namespace}
- Active proposals: ${activeProposals}
- Recent conversation topic: ${recentTopic}

User message: "${message}"

Respond with ONLY this JSON:
{"intent": "...", "confidence": 0.XX, "alternatives": ["..."]}
"alternatives" is optional — omit it or use [] when you are confident.`
}

// ---------------------------------------------------------------------------
// Safe JSON parsing (strips markdown code fences if present)
// ---------------------------------------------------------------------------

function safeParseJSON<T>(raw: string): T | null {
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim()
    return JSON.parse(cleaned) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// IntentClassifier
// ---------------------------------------------------------------------------

export class IntentClassifier {
  constructor(private readonly generateFn: GenerateFn) {}

  async classify(message: string, context: ChatContext): Promise<ClassificationResult> {
    for (const rule of INTENT_RULES) {
      if (rule.test(message, context)) {
        return {
          intent: rule.intent,
          confidence: rule.confidence,
          source: 'rule',
          matchedRule: rule.id,
        }
      }
    }
    return this.llmClassify(message, context)
  }

  private async llmClassify(message: string, context: ChatContext): Promise<ClassificationResult> {
    try {
      const prompt = buildLLMPrompt(message, context)
      const raw = await this.generateFn(prompt)
      const parsed = safeParseJSON<{ intent: string; confidence: number; alternatives?: unknown }>(raw)

      if (!parsed) {
        return { intent: 'UNKNOWN', confidence: 0, source: 'llm' }
      }

      if (!VALID_INTENTS.includes(parsed.intent as Intent)) {
        return { intent: 'UNKNOWN', confidence: 0, source: 'llm' }
      }

      if (typeof parsed.confidence !== 'number' || parsed.confidence < 0.6) {
        return { intent: 'UNKNOWN', confidence: parsed.confidence ?? 0, source: 'llm' }
      }

      const intent = parsed.intent as Intent

      // Generative disambiguation gate — a vague request that reached the LLM
      // fallback must clear a higher bar before we generate an artifact. Below
      // it, or when the LLM offered other plausible generative actions, we ask.
      if (GENERATIVE_INTENTS.has(intent)) {
        const alternatives = Array.isArray(parsed.alternatives)
          ? (parsed.alternatives as unknown[])
              .filter((a): a is Intent => VALID_INTENTS.includes(a as Intent) && GENERATIVE_INTENTS.has(a as Intent))
          : []
        const candidates = Array.from(new Set<Intent>([intent, ...alternatives]))
        const ambiguous = parsed.confidence < GENERATIVE_COMMIT_THRESHOLD || candidates.length > 1

        if (ambiguous) {
          return {
            intent,
            confidence: parsed.confidence,
            source: 'llm',
            needsClarification: true,
            candidates,
          }
        }
      }

      return {
        intent,
        confidence: parsed.confidence,
        source: 'llm',
      }
    } catch {
      return { intent: 'UNKNOWN', confidence: 0, source: 'llm' }
    }
  }
}
