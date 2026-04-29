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
} from './response-builder.js';
import type { ChatResponse } from './response-builder.js';
import { buildBoundaryResponse, buildUnknownResponse } from './boundary-response.js';
import { appendChatTurn, loadHistory } from './chat-history.service.js';
import { readMeta } from '../proposal-meta.js';
import { CostTracker, DEFAULT_COST_CONFIG } from './cost-control.js';

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
  'industry',
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

Extractable fields (omit any not mentioned):
- clientName (string)
- industry (string)
- projectType (string)
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
  workdir: string,
): Promise<ChatContext> {
  const [proposals, templates, ingestedDocuments, lastAssistantMeta] = await Promise.all([
    loadProposals(workdir, namespace),
    loadTemplates(workdir),
    loadIngestedDocuments(workdir, namespace),
    loadLastAssistantMeta(workdir, namespace, chatSessionId),
  ]);

  return {
    namespace,
    proposals,
    templates,
    ingestedDocuments,
    recentTopic: (lastAssistantMeta.meta?.recentTopic as string | undefined) ?? undefined,
    awaitingInput: lastAssistantMeta.meta?.awaitingInput as { intent: string } | undefined,
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

async function loadLastAssistantMeta(
  workdir: string,
  namespace: string,
  chatSessionId: string,
): Promise<{ meta: Record<string, unknown> | null; content: string | null }> {
  try {
    const history = await loadHistory(workdir, namespace, chatSessionId);
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
  chatSessionId: string,
  message: string,
  response: ChatResponse,
  classification: ClassificationResult,
  awaitingInput?: { intent: string },
): Promise<void> {
  const metadata: Record<string, unknown> = {};

  if (awaitingInput) {
    metadata.awaitingInput = awaitingInput;
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

  const chatContext = await buildChatContext(namespace, chatSessionId, workdir);
  const classification = await classifier.classify(message, chatContext);

  // --- Early exit: UNKNOWN ---
  if (classification.intent === 'UNKNOWN') {
    const response = buildUnknownResponse();
    await persistState(workdir, namespace, chatSessionId, message, response, classification);
    onDone(response);
    return response;
  }

  // --- Early exit: GENERAL_CHAT ---
  if (classification.intent === 'GENERAL_CHAT') {
    const response = buildBoundaryResponse(message);
    await persistState(workdir, namespace, chatSessionId, message, response, classification);
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
      await persistState(workdir, namespace, chatSessionId, message, response, classification);
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

  // Execute CALL_TOOL actions
  let toolResults: Awaited<ReturnType<typeof executeToolActions>> = [];

  if (toolActions.length > 0) {
    onPhase('Executing...');
    tracker.incrementTool(); // Track that tools were called this turn

    toolResults = await executeToolActions(toolActions, {
      namespace,
      workdir,
      generateFn: rawGenerateFn, // tools get the un-wrapped fn (they manage their own calls)
      policyConfig,
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
  );

  // Apply RESPOND actions — the LLM's planned reply is used when present.
  // When no tools ran, it's the sole source. When tools ran but the tool message
  // is generic (list/count-style), the RESPOND enriches it. For tools that
  // produce content in their own message (search_documents, generate_proposal),
  // skip the override so the actual content isn't lost.
  const contentTools: ToolName[] = ['search_documents', 'generate_proposal', 'generate_template', 'generate_microsite'];
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
  await persistState(workdir, namespace, chatSessionId, message, response, classification, pendingAsk);

  // Stream the response text in chunks, then signal done
  for (const chunk of chunkText(response.text)) {
    onChunk(chunk);
  }
  onDone(response);

  tracker.log('turn complete');

  return response;
}
