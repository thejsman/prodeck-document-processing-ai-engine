// services/api/src/chat/chat-agent.ts
//
// Chat Pipeline — Main Entry Point (spec section 11).
//
// Wires all 9 stages together in the exact order mandated by the spec.
// This function is pure orchestration: every stage is handled by a purpose-
// built module. The agent itself contains no business logic.
//
// PIPELINE ORDER (inviolable):
//   1. Intent Classification
//   2. Requirement Extraction
//   3. Context Merge
//   4. Readiness Check
//   5. Planner
//   6. Plan Validation
//   7. Tool Execution
//   8. Response Builder
//   9. Persist State
//
// DO NOT add HTTP endpoints here. Wire via chat-routes.ts (next prompt).

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { GenerateFn } from '@ai-engine/planner';
import type { ProviderPolicyConfig } from '../provider-policy.js';
import {
  IntentClassifier,
} from './intent-classifier.js';
import type { ChatContext, ClassificationResult, Intent } from './intents.js';
import { ContextService } from './context.service.js';
import type {
  ExtractionResult,
  NamespaceContext,
  RequirementField,
  RequirementKey,
} from './context.types.js';
import { checkReadiness } from './readiness-engine.js';
import { Planner, buildFallbackPlan } from './planner.js';
import type { AgentAction, AgentPlan, ToolName } from './planner.js';
import { validatePlan } from './plan-validator.js';
import {
  executeToolActions,
} from './tool-router.js';
import type { CallToolAction, ToolEvent } from './tool-router.js';
import {
  buildResponse,
  buildNotReadyResponse,
  buildPlanFailureResponse,
  buildConfirmationResponse,
} from './response-builder.js';
import type { ChatResponse } from './response-builder.js';
import {
  runConfirmationGate,
  buildGenerationConfirmation,
} from './confirmation-gate.js';
import type { ConfirmationRequest } from './confirmation-gate.js';
import { detectClarification } from './clarification.js';
import { buildBoundaryResponse, buildUnknownResponse, buildClarificationChoiceResponse } from './boundary-response.js';
import { appendChatTurn, loadHistory } from './chat-history.service.js';
import { readMeta } from '../proposal-meta.js';
import { CostTracker, DEFAULT_COST_CONFIG } from './cost-control.js';
import { resolveVectorStoreConfig } from '../ingestion/branch-runner.js';
import { scrapeUrl } from './url-scraper.service.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChatAgentInput {
  /** The user's message for this turn. */
  message: string;
  /** Namespace identifier (e.g. "lc-grounds", "default"). */
  namespace: string;
  /** Stable session ID for history persistence and SSE routing. */
  chatSessionId: string;
  /** 16-char hex SHA-256 prefix of the API key — scopes history per user. */
  apiKeyHash: string;
  /** Absolute path to the workspace root (namespaces/, data/ live here). */
  workdir: string;
  /** LLM call function — injected so the agent never imports a concrete LLM. */
  generateFn: GenerateFn;
  /** Optional provider policy for multi-model routing. */
  policyConfig?: ProviderPolicyConfig | null;
  /** Called at each pipeline stage transition (for SSE phase events). */
  onPhase?: (phase: string) => void;
  /** Called for each text chunk of the final response (for SSE streaming). */
  onChunk?: (chunk: string) => void;
  /** Called once when the response is fully built. */
  onDone?: (response: ChatResponse) => void;
  /** Called for each tool lifecycle event (start / complete / error). */
  onToolEvent?: (event: ToolEvent) => void;
}

// ---------------------------------------------------------------------------
// VALID_REQUIREMENT_KEYS (duplicated locally to avoid cross-package dep)
// ---------------------------------------------------------------------------

const VALID_REQUIREMENT_KEYS: RequirementKey[] = [
  'clientName',
  'clientIndustry',
  'projectType',
  'budget',
  'timeline',
  'teamSize',
  'technicalStack',
  'keyObjectives',
  'constraints',
  'deliverables',
  'stakeholders',
  'contactName',
];

// ---------------------------------------------------------------------------
// Safe JSON parse helper
// ---------------------------------------------------------------------------

function safeParseJSON<T>(raw: string): T | null {
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    // Try extracting the first {...} block as a fallback
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Text chunker (Stage 9 streaming)
// ---------------------------------------------------------------------------

/**
 * Splits text into sentence-aligned chunks for progressive SSE delivery.
 * Falls back to a single chunk if no sentence boundary is found.
 */
function* chunkText(text: string, maxChunkSize = 80): Generator<string> {
  let remaining = text;
  while (remaining.length > maxChunkSize) {
    // Find last sentence boundary within the window
    const window = remaining.slice(0, maxChunkSize);
    const lastBoundary = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('! '),
      window.lastIndexOf('? '),
      window.lastIndexOf('\n'),
    );
    const splitAt = lastBoundary > 20 ? lastBoundary + 1 : maxChunkSize;
    yield remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt);
  }
  if (remaining.length > 0) yield remaining;
}

// ---------------------------------------------------------------------------
// Stage 2: extractFromMessage
// ---------------------------------------------------------------------------

/**
 * Extracts structured requirement fields from a single user message.
 *
 * Skipped when:
 *   - intent is GREETING (nothing to extract)
 *   - message is very short (< 10 chars) — too little signal
 *
 * Returns an ExtractionResult with:
 *   - fields: extracted RequirementFields at confidence 0.9 (user-stated)
 *   - knowledge: always [] (knowledge is extracted from documents, not chat)
 *   - raw: raw LLM response
 */
async function extractFromMessage(
  message: string,
  intent: Intent,
  nsContext: NamespaceContext | null,
  generateFn: GenerateFn,
  lastAssistantMessage?: string,
): Promise<ExtractionResult> {
  const empty: ExtractionResult = { fields: {}, knowledge: [], raw: '' };

  if (intent === 'GREETING' || message.length < 4) return empty;

  const existingKeys = nsContext
    ? Object.keys(nsContext.requirements.fields).join(', ') || 'none'
    : 'none';

  // Truncate the last assistant message to avoid bloating the prompt
  const questionContext = lastAssistantMessage
    ? `\nContext — the assistant's previous message (i.e. the question the user is answering):\n"${lastAssistantMessage.slice(0, 300)}"\n`
    : '';

  const prompt = `Extract project requirement fields from this short user message.
Only extract values that are explicitly stated. Do NOT infer or guess.
Return {} if nothing is extractable.

Already known fields (do NOT re-extract unless the user is correcting them): ${existingKeys}

IMPORTANT: Distinguish between these two fields:
- clientIndustry: What business the CLIENT is in (their market/domain, e.g. "real estate", "healthcare")
- projectType: What SERVICE we are delivering (the work/project type, e.g. "digital marketing", "web development")
If the user says "proposal for a real estate company for their marketing", extract clientIndustry = "real estate" AND projectType = "digital marketing".

Extractable fields (omit any not mentioned):
- clientName (string)
- clientIndustry (string) — the client's business domain
- projectType (string) — the service being delivered
- budget (string, include currency and qualifiers)
- timeline (string)
- teamSize (number)
- technicalStack (string[])
- keyObjectives (string[])
- constraints (string[])
- deliverables (string[])
- stakeholders (string[])
- contactName (string)
${questionContext}
User message: "${message.replace(/"/g, '\\"')}"

JSON output only (no explanation):`;

  let raw = '';
  try {
    raw = await generateFn(prompt);
  } catch {
    return empty;
  }

  const parsed = safeParseJSON<Record<string, unknown>>(raw);
  if (!parsed || typeof parsed !== 'object') return { ...empty, raw };

  const fields: ExtractionResult['fields'] = {};
  const now = new Date().toISOString();

  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined) continue;
    if (!VALID_REQUIREMENT_KEYS.includes(key as RequirementKey)) continue;
    fields[key as RequirementKey] = {
      value,
      confidence: 0.9,
      source: 'user',
      updatedAt: now,
    } as RequirementField<unknown>;
  }

  // Extract industry-specific custom fields if industry is detected
  if (nsContext?.industryContext?.industryId) {
    try {
      const { getActiveSchema } = await import('./industry-schema.js');
      const schema = getActiveSchema(
        nsContext.industryContext.industryId,
        nsContext.engagementType ?? null,
      );
      const missingCustom = schema.allFields.filter(f => {
        const existing = nsContext.requirements?.customFields?.[f.key];
        return !existing?.value;
      });

      if (missingCustom.length > 0 && message.length > 20) {
        const customPrompt = `From this user message, extract values for these fields if explicitly mentioned. Return {} if nothing matches.

Fields:
${missingCustom.slice(0, 8).map(f => `- ${f.key}: ${f.label}`).join('\n')}

Message: "${message.replace(/"/g, '\\"')}"

JSON only:`;

        try {
          const customRaw = await generateFn(customPrompt);
          const customParsed = safeParseJSON<Record<string, unknown>>(customRaw);
          if (customParsed && typeof customParsed === 'object') {
            for (const [key, value] of Object.entries(customParsed)) {
              if (value === null || value === undefined) continue;
              if (!missingCustom.find(f => f.key === key)) continue;
              // Store with custom_ prefix so Stage 3 can route to mergeCustomFields
              (fields as Record<string, unknown>)[`custom_${key}`] = {
                value: Array.isArray(value) ? value.join(', ') : String(value),
                confidence: 0.85,
                source: 'user',
                updatedAt: now,
              };
            }
          }
        } catch {
          // Non-fatal — custom extraction from chat is best-effort
        }
      }
    } catch {
      // Non-fatal — industry schema may not be loaded
    }
  }

  return { fields, knowledge: [], raw };
}

// ---------------------------------------------------------------------------
// Stage 1 helper: buildChatContext
// ---------------------------------------------------------------------------

/**
 * Assembles the ChatContext for Stage 1 by reading the live filesystem state.
 *
 * Sources of truth:
 *   - Proposals: namespaces/{ns}/proposals/*.md + their .meta.json sidecars
 *   - Templates:  data/templates/*.yaml
 *   - Ingested documents: context.json sources[]
 *   - awaitingInput: last assistant message metadata (from chat history)
 *   - recentTopic: last assistant message metadata
 */
async function buildChatContext(
  namespace: string,
  chatSessionId: string,
  apiKeyHash: string,
  workdir: string,
): Promise<ChatContext> {
  const [proposals, templates, ingestedDocuments, lastAssistantMeta, pendingTemplateApproval, skillsList, designSkillsList] = await Promise.all([
    loadProposals(workdir, namespace),
    loadTemplates(workdir),
    loadIngestedDocuments(workdir, namespace),
    loadLastAssistantMeta(workdir, namespace, apiKeyHash, chatSessionId),
    loadPendingTemplateApproval(workdir, namespace),
    import('../skills/skill.service.js').then(({ listSkills }) => listSkills(workdir)).catch(() => [] as { slug: string; displayName: string }[]),
    import('../skills/design-skill.service.js').then(({ listDesignSkills }) => listDesignSkills(workdir)).catch(() => [] as { slug: string; displayName: string; aestheticTone: string; themeClass: string }[]),
  ]);

  // Chat history is the primary source for awaitingConfirmation.
  // context.json pendingTemplateApproval is a persistent fallback — it survives
  // page navigations that lose the in-memory confirmationRequest state.
  const awaitingConfirmation =
    (lastAssistantMeta.meta?.awaitingConfirmation as ChatContext['awaitingConfirmation'] | undefined)
    ?? pendingTemplateApproval;

  return {
    namespace,
    proposals,
    templates,
    ingestedDocuments,
    skills: skillsList.map((s) => ({ slug: s.slug, displayName: s.displayName })),
    designSkills: designSkillsList.map((s) => ({ slug: s.slug, displayName: s.displayName, aestheticTone: (s as { aestheticTone?: string }).aestheticTone ?? '', themeClass: (s as { themeClass?: string }).themeClass ?? '' })),
    recentTopic: (lastAssistantMeta.meta?.recentTopic as string | undefined) ?? undefined,
    awaitingInput: lastAssistantMeta.meta?.awaitingInput as { intent: string } | undefined,
    awaitingConfirmation,
    lastAssistantMessage: lastAssistantMeta.content ?? undefined,
  };
}

async function loadProposals(
  workdir: string,
  namespace: string,
): Promise<ChatContext['proposals']> {
  const dir = path.join(workdir, 'namespaces', namespace, 'proposals');
  try {
    const entries = await readdir(dir);
    const mdFiles = entries.filter((f) => f.endsWith('.md') && !f.startsWith('.'));
    const proposals = await Promise.all(
      mdFiles.map(async (file) => {
        const filePath = path.join(dir, file);
        const meta = await readMeta(filePath).catch(() => null);
        return { fileName: `${namespace}::${file}`, status: meta?.status ?? 'draft' };
      }),
    );
    return proposals;
  } catch {
    return [];
  }
}

async function loadTemplates(workdir: string): Promise<ChatContext['templates']> {
  const tplDir = path.join(workdir, 'data', 'templates');
  try {
    const entries = await readdir(tplDir);
    return entries
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map((f) => ({ fileName: f }));
  } catch {
    return [];
  }
}

async function loadIngestedDocuments(
  workdir: string,
  namespace: string,
): Promise<ChatContext['ingestedDocuments']> {
  // Source of truth: context.json's sources[] array (populated by ingestion pipeline)
  const contextPath = path.join(workdir, 'namespaces', namespace, 'context.json');
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(contextPath, 'utf-8');
    const ctx = JSON.parse(raw) as NamespaceContext;
    return (ctx.sources ?? []).map((s) => ({ fileName: s.fileName }));
  } catch {
    return [];
  }
}

async function loadPendingTemplateApproval(
  workdir: string,
  namespace: string,
): Promise<ChatContext['awaitingConfirmation'] | undefined> {
  const contextPath = path.join(workdir, 'namespaces', namespace, 'context.json');
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(contextPath, 'utf-8');
    const ctx = JSON.parse(raw) as NamespaceContext;
    return ctx.pendingTemplateApproval ?? undefined;
  } catch {
    return undefined;
  }
}

async function loadLastAssistantMeta(
  workdir: string,
  namespace: string,
  apiKeyHash: string,
  chatSessionId: string,
): Promise<{ meta: Record<string, unknown> | null; content: string | null }> {
  try {
    const history = await loadHistory(workdir, namespace, apiKeyHash, chatSessionId);
    if (!history || history.messages.length === 0) return { meta: null, content: null };
    const messages = [...history.messages].reverse();
    const lastAssistant = messages.find((m) => m.role === 'assistant');
    return {
      meta: lastAssistant?.metadata ?? null,
      content: lastAssistant?.content ?? null,
    };
  } catch {
    return { meta: null, content: null };
  }
}

// ---------------------------------------------------------------------------
// Stage 7 helper: dataToFields
// ---------------------------------------------------------------------------

/**
 * Converts a raw UPDATE_REQUIREMENTS data bag (from the planner) into the
 * RequirementField format expected by ContextService.mergeRequirements().
 */
function dataToFields(
  data: Record<string, unknown>,
): ExtractionResult['fields'] {
  const fields: ExtractionResult['fields'] = {};
  const now = new Date().toISOString();

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (!VALID_REQUIREMENT_KEYS.includes(key as RequirementKey)) continue;
    fields[key as RequirementKey] = {
      value,
      confidence: 0.95,
      source: 'user',
      updatedAt: now,
    } as RequirementField<unknown>;
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Stage 9: persistState
// ---------------------------------------------------------------------------

/**
 * Persists the chat turn to disk (Stage 9).
 *
 * Responsibilities:
 *   1. Append user message + assistant reply to chat history
 *   2. Store awaitingInput in assistant message metadata when readiness failed
 *   3. Store recentTopic so the next turn's buildChatContext can load it
 */
async function persistState(
  workdir: string,
  namespace: string,
  apiKeyHash: string,
  chatSessionId: string,
  message: string,
  response: ChatResponse,
  classification: ClassificationResult,
  awaitingInput?: { intent: string },
  awaitingConfirmation?: ChatContext['awaitingConfirmation'],
): Promise<void> {
  const metadata: Record<string, unknown> = {};

  if (awaitingInput) {
    metadata.awaitingInput = awaitingInput;
  }

  if (awaitingConfirmation) {
    metadata.awaitingConfirmation = awaitingConfirmation;
  }

  // Derive a recentTopic from the classified intent for the next turn
  metadata.recentTopic = intentToTopic(classification.intent);

  // Persist the proposal artifact ID so the chat history card can rehydrate
  const proposalCard = response.actionCards?.find((c) => c.type === 'view_proposal');
  if (proposalCard?.href) {
    try {
      const u = new URL(proposalCard.href, 'http://x');
      const artifact = u.searchParams.get('artifact');
      if (artifact) metadata.proposalArtifactId = artifact;
      const ns = u.searchParams.get('namespace');
      if (ns) metadata.proposalNamespace = ns;
    } catch { /* ignore malformed href */ }
  }

  // Non-fatal: history persistence failures must not crash the pipeline
  await appendChatTurn(
    workdir,
    namespace,
    apiKeyHash,
    chatSessionId,
    message,
    response.text,
    metadata,
  ).catch((err: unknown) => {
    console.warn('[ChatAgent] Failed to persist chat history:', err);
  });
}

function intentToTopic(intent: Intent): string {
  const topics: Partial<Record<Intent, string>> = {
    GENERATE_PROPOSAL: 'proposal generation',
    MODIFY_PROPOSAL: 'proposal editing',
    GENERATE_TEMPLATE: 'template creation',
    MODIFY_TEMPLATE: 'template editing',
    GENERATE_MICROSITE: 'microsite generation',
    UPDATE_REQUIREMENTS: 'requirements update',
    QUERY: 'document query',
    STATUS_CHECK: 'status check',
    INGEST_GUIDANCE: 'document ingestion',
  };
  return topics[intent] ?? intent.toLowerCase().replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// runChatAgent — main entry point
// ---------------------------------------------------------------------------

/**
 * Executes the full 9-stage chat pipeline for one user turn.
 *
 * Returns a ChatResponse. Streaming chunks are delivered progressively via
 * onChunk before the final onDone callback fires.
 */
export async function runChatAgent(input: ChatAgentInput): Promise<ChatResponse> {
  const {
    message,
    namespace,
    chatSessionId,
    apiKeyHash,
    workdir,
    generateFn: rawGenerateFn,
    policyConfig,
    onPhase = () => { /* no-op */ },
    onChunk = () => { /* no-op */ },
    onDone = () => { /* no-op */ },
    onToolEvent,
  } = input;

  // -------------------------------------------------------------------------
  // Budget tracker — wraps generateFn so every LLM call is counted
  // -------------------------------------------------------------------------
  const tracker = new CostTracker(DEFAULT_COST_CONFIG);
  const generateFn = tracker.wrap(rawGenerateFn);

  // Singletons wired per-turn
  const contextService = new ContextService(workdir);
  const classifier = new IntentClassifier(generateFn);
  const planner = new Planner(generateFn);

  // =========================================================================
  // STAGE 1 — Intent Classification
  // =========================================================================
  onPhase('Classifying intent...');

  const chatContext = await buildChatContext(namespace, chatSessionId, apiKeyHash, workdir);
  let classification = await classifier.classify(message, chatContext);

  // =========================================================================
  // STAGE 1.5 — Confirm-Generation Gate (only when unsure)
  // =========================================================================
  // Big generations (proposal / microsite) must never fire on a guess. When
  // the intent is recognised with low confidence — or the user is replying to
  // a pending confirmation — resolve it here, before any extraction work.
  const BIG_GENERATION_INTENTS: Intent[] = ['GENERATE_PROPOSAL', 'GENERATE_MICROSITE'];
  const GEN_CONFIRM_THRESHOLD = 0.85;
  const trimmed = message.trim();
  const isAffirmative =
    /^(yes|yep|yup|sure|ok(ay)?|correct|confirmed?|proceed|go\s+ahead|do\s+it|please\s+do|that'?s\s+right|looks?\s+good)\b/i.test(trimmed);
  const isNegative =
    /^(no|nope|nah|not\s+(now|yet)|don'?t|do\s+not|cancel|stop|never\s*mind|later|maybe\s+later)\b/i.test(trimmed);

  // Resume: user is answering a pending "want me to go ahead?" confirmation.
  if (chatContext.awaitingConfirmation?.kind === 'confirm_generation') {
    const targetIntent = chatContext.awaitingConfirmation.targetIntent;
    if (isAffirmative && targetIntent) {
      // Confirmed — proceed with the target intent at high confidence.
      classification = {
        intent: targetIntent,
        confidence: 0.97,
        source: 'rule',
        matchedRule: 'ctx_confirm_generation_yes',
      };
    } else if (isNegative) {
      // Declined — acknowledge and clear the pending confirmation.
      const response: ChatResponse = {
        text: "No problem — just let me know when you'd like to go ahead.",
        actionCards: [],
        requirementsUpdated: false,
        toolsCalled: [],
      };
      await persistState(workdir, namespace, apiKeyHash, chatSessionId, message, response, classification);
      onDone(response);
      return response;
    }
    // Otherwise: not a clear yes/no — fall through and use the fresh classification.
  }

  // --- Early exit: UNKNOWN ---
  if (classification.intent === 'UNKNOWN') {
    const response = buildUnknownResponse();
    await persistState(workdir, namespace, apiKeyHash, chatSessionId, message, response, classification);
    onDone(response);
    return response;
  }

  // --- Early exit: GENERAL_CHAT ---
  if (classification.intent === 'GENERAL_CHAT') {
    const response = buildBoundaryResponse(message);
    await persistState(workdir, namespace, apiKeyHash, chatSessionId, message, response, classification);
    onDone(response);
    return response;
  }

  // --- Early exit: NEEDS CLARIFICATION ---
  // The LLM fallback matched a generative intent but wasn't confident which
  // artifact the user wants (gray-band confidence, or it named alternatives).
  // Ask before generating — never guess an artifact into existence (Golden
  // Rule #6). Rule-based classifications are trusted and never reach here.
  if (classification.needsClarification) {
    onPhase('Clarifying your request...');
    const response = buildClarificationChoiceResponse(classification.candidates ?? []);
    await persistState(workdir, namespace, apiKeyHash, chatSessionId, message, response, classification);
    onDone(response);
    return response;
  }

  // =========================================================================
  // STAGE 1.5 — Clarification Gate (deterministic, no LLM)
  // =========================================================================
  // When the user names a generation artifact with no actionable specifics
  // (e.g. bare "microsite" / "landing page"), ask a short contextual
  // questionnaire before generating instead of guessing (Golden Rules #4, #6).
  const clarification = detectClarification(classification.intent, message, chatContext);
  if (clarification) {
    onPhase('Getting a few details...');
    const response: ChatResponse = {
      text: clarification.intro,
      actionCards: [],
      requirementsUpdated: false,
      toolsCalled: [],
      questions: clarification.questions,
    };
    await persistState(
      workdir,
      namespace,
      apiKeyHash,
      chatSessionId,
      message,
      response,
      classification,
      { intent: clarification.resumeIntent },
    );
    onDone(response);
    return response;
  }

  // =========================================================================
  // STAGE 2 — Requirement Extraction
  // =========================================================================
  onPhase('Extracting requirements...');

  const nsContext = await contextService.get(namespace);
  const extraction = await extractFromMessage(
    message,
    classification.intent,
    nsContext,
    generateFn,
    chatContext.lastAssistantMessage,
  );

  // =========================================================================
  // STAGE 3 — Context Merge
  // =========================================================================
  let currentContext = nsContext;

  if (Object.keys(extraction.fields).length > 0) {
    onPhase('Updating context...');
    currentContext = await contextService.mergeRequirements(namespace, extraction.fields);
    // Trigger industry detection after merge — activates adaptive schema
    await contextService.detectAndSetIndustry(namespace).catch((err: unknown) => {
      console.warn('[ChatAgent] Industry detection failed (non-fatal):', err);
    });

    // Route any custom_ prefixed fields extracted from the message to customFields
    const customEntries: Record<string, RequirementField<string>> = {};
    for (const [key, field] of Object.entries(extraction.fields)) {
      if (key.startsWith('custom_') && field) {
        const realKey = key.slice(7); // Remove 'custom_' prefix
        customEntries[realKey] = field as RequirementField<string>;
      }
    }
    if (Object.keys(customEntries).length > 0) {
      await contextService.mergeCustomFields(namespace, customEntries).catch((err: unknown) => {
        console.warn('[ChatAgent] Custom field merge failed (non-fatal):', err);
      });
    }
  }

  // =========================================================================
  // STAGE 4 — Readiness Check
  // =========================================================================
  const readiness = checkReadiness(classification.intent, currentContext, chatContext);

  if (!readiness.ready) {
    const response = buildNotReadyResponse(classification.intent, readiness, extraction);
    await persistState(
      workdir,
      namespace,
      apiKeyHash,
      chatSessionId,
      message,
      response,
      classification,
      { intent: classification.intent },
    );
    onDone(response);
    return response;
  }

  // =========================================================================
  // STAGE 4.5 — Confirmation Gate
  // =========================================================================

  // Handle CONFIRM_ENTITIES intent — user is responding to an entity confirmation ask
  if (classification.intent === 'CONFIRM_ENTITIES') {
    onPhase('Confirming details...');

    // If user is correcting something, their extracted fields have already been merged
    // in Stage 3. Now mark confirmed entity fields as user-blessed.
    if (currentContext) {
      currentContext = await contextService.confirmEntities(namespace);
    }

    // Re-run the gate with the now-confirmed entities
    const gateResultAfterConfirm = await runConfirmationGate(
      'GENERATE_PROPOSAL',
      currentContext,
      workdir,
      generateFn,
    );

    if (!gateResultAfterConfirm.confirmed) {
      const response = buildConfirmationResponse(gateResultAfterConfirm.request, extraction);
      const pendingKind = gateResultAfterConfirm.request.kind;
      const pendingSlug = (gateResultAfterConfirm.request as { templateSlug?: string }).templateSlug;
      if (pendingKind === 'approve_generated_template' && pendingSlug) {
        await contextService.setPendingTemplateApproval(namespace, { kind: 'approve_generated_template', templateSlug: pendingSlug }).catch(() => { /* non-fatal */ });
      }
      await persistState(
        workdir, namespace, apiKeyHash, chatSessionId, message, response, classification,
        undefined,
        { kind: pendingKind, templateSlug: pendingSlug },
      );
      onDone(response);
      return response;
    }

    // Everything confirmed — proceed to proposal generation by re-classifying as GENERATE_PROPOSAL
    classification = { ...classification, intent: 'GENERATE_PROPOSAL' };
  }

  // Handle CONFIRM_TEMPLATE intent — user is approving the recommended/generated template
  if (classification.intent === 'CONFIRM_TEMPLATE') {
    onPhase('Confirming template...');

    const pendingConfirmation = chatContext.awaitingConfirmation;

    // For edit requests ("change section 3"), route to MODIFY_TEMPLATE instead
    const isEditRequest = /\b(change|modify|edit|update|add|remove|adjust|rename|replace)\b/i.test(message);

    if (isEditRequest && pendingConfirmation?.kind === 'approve_generated_template' && pendingConfirmation.templateSlug) {
      // Re-route to MODIFY_TEMPLATE with the draft template
      classification = { ...classification, intent: 'MODIFY_TEMPLATE' };
      // Fall through to planner which will call modify_template
    } else if (pendingConfirmation?.kind === 'confirm_template' || pendingConfirmation?.kind === 'approve_generated_template') {
      // User approved — determine which template was confirmed and save it
      let selectedTemplateId = pendingConfirmation.templateSlug ?? '';
      let selectedTemplateName = '';
      let generatedFromScratch = pendingConfirmation.kind === 'approve_generated_template';

      if (pendingConfirmation.kind === 'confirm_template') {
        // Re-run recommendation to get the template details (already cached effectively)
        try {
          const { recommendTemplate: rec } = await import('../templates/template-recommendation.service.js');
          const fields = currentContext?.requirements?.fields ?? {};
          const knowledge = currentContext?.knowledge ?? [];
          const recContext = {
            requirementMatrix: {
              functional: knowledge.filter((k) => !k.supersededBy && ['requirement', 'priority'].includes(k.category)).map((k) => k.content).slice(0, 10),
              compliance: knowledge.filter((k) => !k.supersededBy && k.category === 'constraint').map((k) => k.content).slice(0, 5),
              timeline: fields.timeline?.value ? [String(fields.timeline.value)] : [],
              pricing: fields.budget?.value ? [String(fields.budget.value)] : [],
            },
            detectedIndustry: fields.clientIndustry?.value ? String(fields.clientIndustry.value) : undefined,
            keyCapabilities: [],
            namespace,
          };
          const recommendation = await rec(recContext, workdir);
          if (recommendation.template) {
            selectedTemplateId = recommendation.template.id;
            selectedTemplateName = recommendation.template.name;
          }
        } catch { /* non-fatal */ }
      } else if (pendingConfirmation.templateSlug) {
        selectedTemplateId = pendingConfirmation.templateSlug;
        selectedTemplateName = pendingConfirmation.templateSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      }

      if (selectedTemplateId && currentContext) {
        currentContext = await contextService.setSelectedTemplate(namespace, {
          templateId: selectedTemplateId,
          name: selectedTemplateName,
          confirmedAt: new Date().toISOString(),
          generatedFromScratch,
        });
      }

      // Clear the persistent pending approval now that the user has confirmed
      await contextService.clearPendingTemplateApproval(namespace).catch(() => { /* non-fatal */ });

      // All confirmations done — now run as GENERATE_PROPOSAL
      classification = { ...classification, intent: 'GENERATE_PROPOSAL' };
    } else {
      // No pending confirmation context — treat as a normal proposal generation attempt
      classification = { ...classification, intent: 'GENERATE_PROPOSAL' };
    }
  }

  // Run the confirmation gate for GENERATE_PROPOSAL (catches fresh requests
  // and resume paths where CONFIRM_ENTITIES re-routed to GENERATE_PROPOSAL)
  if (classification.intent === 'GENERATE_PROPOSAL') {
    // Bypass: "just generate it / use defaults / skip confirmation" auto-accepts all pending gates
    const isBypass =
      classification.matchedRule === 'kw_bypass_confirmation' ||
      /\b(just\s+(generate|do|make|create|proceed|use)\b|use\s+defaults?|skip\s+(confirmation|this|all)?\b|proceed\s+anyway|generate\s+(it\s+)?(now|anyway|without\s+confirm)|use\s+what\s+you\s+have)\b/i.test(message);

    if (isBypass && currentContext) {
      // Auto-confirm entities so the gate won't re-ask next time
      currentContext = await contextService.confirmEntities(namespace);
      // Auto-select template if none confirmed yet
      if (!currentContext.selectedTemplate) {
        try {
          const { recommendTemplate: rec } = await import('../templates/template-recommendation.service.js');
          const fields = currentContext.requirements?.fields ?? {};
          const knowledge = currentContext.knowledge ?? [];
          const recCtx = {
            requirementMatrix: {
              functional: knowledge.filter((k) => !k.supersededBy && ['requirement', 'priority'].includes(k.category)).map((k) => k.content).slice(0, 10),
              compliance: knowledge.filter((k) => !k.supersededBy && k.category === 'constraint').map((k) => k.content).slice(0, 5),
              timeline: fields.timeline?.value ? [String(fields.timeline.value)] : [],
              pricing: fields.budget?.value ? [String(fields.budget.value)] : [],
            },
            detectedIndustry: fields.clientIndustry?.value ? String(fields.clientIndustry.value) : undefined,
            keyCapabilities: [],
            namespace,
          };
          const recommendation = await rec(recCtx, workdir);
          if (recommendation.template) {
            currentContext = await contextService.setSelectedTemplate(namespace, {
              templateId: recommendation.template.id,
              name: recommendation.template.name,
              confirmedAt: new Date().toISOString(),
              generatedFromScratch: false,
            });
          }
        } catch { /* non-fatal — gate will handle fallback */ }
      }
    }

    const gateResult = await runConfirmationGate(
      'GENERATE_PROPOSAL',
      currentContext,
      workdir,
      generateFn,
    );

    if (!gateResult.confirmed) {
      onPhase('Confirming details...');
      const response = buildConfirmationResponse(gateResult.request, extraction);
      const pendingKind = gateResult.request.kind;
      const pendingSlug = (gateResult.request as { templateSlug?: string }).templateSlug;
      if (pendingKind === 'approve_generated_template' && pendingSlug) {
        await contextService.setPendingTemplateApproval(namespace, { kind: 'approve_generated_template', templateSlug: pendingSlug }).catch(() => { /* non-fatal */ });
      }
      await persistState(
        workdir, namespace, apiKeyHash, chatSessionId, message, response, classification,
        undefined,
        { kind: pendingKind, templateSlug: pendingSlug },
      );
      onDone(response);
      return response;
    }
  }

  // =========================================================================
  // STAGE 5 — Planner
  // =========================================================================
  onPhase('Planning actions...');

  const rawPlan = await planner.buildPlan(
    classification.intent,
    message,
    chatContext,
    currentContext ?? {
      namespace,
      requirements: { fields: {}, customFields: {} },
      knowledge: [],
      sources: [],
      version: 0,
      updatedAt: new Date().toISOString(),
    },
  );

  // =========================================================================
  // STAGE 6 — Plan Validation
  // =========================================================================
  const validation = validatePlan(rawPlan);

  if (!validation.valid) {
    console.warn('[ChatAgent] Plan validation failed:', validation.errors);
    console.warn('[ChatAgent] Raw plan from LLM:', JSON.stringify(rawPlan, null, 2));
    const fallback = buildFallbackPlan(classification.intent, message, currentContext ?? {
      namespace,
      requirements: { fields: {}, customFields: {} },
      knowledge: [],
      sources: [],
      version: 0,
      updatedAt: new Date().toISOString(),
    }, chatContext);

    if (!fallback) {
      const response = buildPlanFailureResponse(extraction);
      await persistState(workdir, namespace, apiKeyHash, chatSessionId, message, response, classification);
      onDone(response);
      return response;
    }

    // Validated fallback is used in place of the rejected plan
    validation.plan = fallback;
  }

  const plan = validation.plan as AgentPlan;

  // =========================================================================
  // STAGE 7 — Tool Execution
  // =========================================================================

  // Separate action types from the plan
  const toolActions = plan.actions.filter(
    (a): a is CallToolAction => a.type === 'CALL_TOOL',
  );
  const updateActions = plan.actions.filter(
    (a): a is Extract<AgentAction, { type: 'UPDATE_REQUIREMENTS' }> =>
      a.type === 'UPDATE_REQUIREMENTS',
  );
  const askActions = plan.actions.filter(
    (a): a is Extract<AgentAction, { type: 'ASK' }> => a.type === 'ASK',
  );
  const respondActions = plan.actions.filter(
    (a): a is Extract<AgentAction, { type: 'RESPOND' }> => a.type === 'RESPOND',
  );

  // Apply UPDATE_REQUIREMENTS actions first (deterministic, no LLM)
  for (const update of updateActions) {
    await contextService.mergeRequirements(namespace, dataToFields(update.data));
  }

  // Handle URL scraping for CLIENT_DATA_COLLECTION intent
  if (classification.intent === 'CLIENT_DATA_COLLECTION') {
    const urlMatch = message.match(/https?:\/\/[^\s,)>"']+/i);
    if (urlMatch) {
      try {
        onPhase('Scraping website...');
        const scrapeResult = await scrapeUrl(urlMatch[0], rawGenerateFn);

        // Merge scraped fields into context
        if (Object.keys(scrapeResult.fields).length > 0) {
          currentContext = await contextService.mergeRequirements(namespace, scrapeResult.fields);
        }

        // Merge scraped custom fields
        if (Object.keys(scrapeResult.customFields).length > 0) {
          currentContext = await contextService.mergeCustomFields(namespace, scrapeResult.customFields);
        }

        // Store branding kit
        if (scrapeResult.brandingKit && (scrapeResult.brandingKit.colors.length > 0 || scrapeResult.brandingKit.typography.length > 0)) {
          currentContext = await contextService.setBrandingKit(namespace, scrapeResult.brandingKit);
        }

        // Re-run industry detection with new data
        await contextService.detectAndSetIndustry(namespace).catch(() => { /* non-fatal */ });
        currentContext = await contextService.get(namespace) ?? currentContext;

        // Mark the scrape as an extraction in the response
        if (Object.keys(scrapeResult.fields).length > 0) {
          Object.assign(extraction.fields, scrapeResult.fields);
        }
      } catch (err) {
        console.warn('[ChatAgent] URL scraping failed (non-fatal):', err);
      }
    }
  }

  // Execute CALL_TOOL actions
  let toolResults: Awaited<ReturnType<typeof executeToolActions>> = [];

  if (toolActions.length > 0) {
    onPhase('Executing...');
    tracker.incrementTool(); // Track that tools were called this turn

    const vectorStoreConfig = await resolveVectorStoreConfig(workdir, namespace).catch(() => undefined);

    toolResults = await executeToolActions(toolActions, {
      namespace,
      workdir,
      generateFn: rawGenerateFn, // tools get the un-wrapped fn (they manage their own calls)
      policyConfig,
      vectorStoreConfig,
      onPhase,
      onToolEvent,
    });
  }

  // =========================================================================
  // STAGE 8 — Response Builder
  // =========================================================================
  onPhase('Building response...');

  const response = await buildResponse(
    classification.intent,
    toolResults,
    readiness,
    extraction,
    chatContext,
    generateFn,
    currentContext,
  );

  // Apply RESPOND actions — the LLM's planned reply is used when present.
  // When no tools ran, it's the sole source. When tools ran but the tool message
  // is generic (list/count-style), the RESPOND enriches it. For tools that
  // produce content in their own message (search_documents, generate_proposal),
  // skip the override so the actual content isn't lost.
  const contentTools: ToolName[] = ['search_documents', 'generate_proposal', 'generate_template', 'generate_microsite', 'recommend_template', 'generate_document'];
  const hasContentTool = toolActions.some((a) => contentTools.includes(a.tool));

  if (respondActions.length > 0 && !hasContentTool) {
    response.text = respondActions.map((a) => a.message).join('\n\n');
  }

  // Append ASK actions as follow-up questions
  if (askActions.length > 0) {
    const questions = askActions.map((a) => a.question).join('\n');
    response.text = response.text + '\n\n' + questions;
  }

  // =========================================================================
  // STAGE 9 — Persist State
  // =========================================================================
  // Preserve awaitingInput when the plan included ASK actions — the next turn
  // needs to know we're mid-flow (e.g. "what status?" → user answers "approved")
  const pendingAsk = askActions.length > 0 ? { intent: classification.intent } : undefined;
  await persistState(workdir, namespace, apiKeyHash, chatSessionId, message, response, classification, pendingAsk);

  // Stream the response text in chunks, then signal done
  for (const chunk of chunkText(response.text)) {
    onChunk(chunk);
  }
  onDone(response);

  tracker.log('turn complete');

  return response;
}
