// services/api/src/chat/response-builder.ts
//
// Chat Pipeline Stage 8 — Response Builder.
//
// Produces the final ChatResponse from tool results, readiness state, and
// extraction data. Deterministic templates cover every common case.
// The LLM is invoked only when it adds genuine value:
//   - Synthesising multiple tool results into a coherent reply
//   - Summarising QUERY / RAG search results into natural language
//
// All other paths (greetings, not-ready, single-tool, requirement updates,
// ingest guidance, plan failures) are fully deterministic — zero LLM tokens.

import type { GenerateFn } from '@ai-engine/planner';
import type { Intent, ChatContext } from './intents.js';
import type { ExtractionResult, NamespaceContext } from './context.types.js';
import type { ReadinessResult, MissingField } from './readiness-engine.js';
import type { ToolExecutionResult, ActionCard } from './tool-handlers.js';
import type { ToolName } from './planner.js';
import type { ConfirmationRequest } from './confirmation-gate.js';
import { buildClientDataResponse } from './client-data-handler.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChatResponse {
  text: string;
  actionCards: ActionCard[];
  requirementsUpdated: boolean;
  /** Names of tools that were called this turn. */
  toolsCalled: ToolName[];
  /** Set when the pipeline halted at Stage 4.5 waiting for user confirmation. */
  confirmationRequest?: ConfirmationRequest;
  /** Structured questions for QuestionsBlock rendering. When present, `text` contains
   *  only the intro sentence — the numbered list is omitted. */
  questions?: Array<{ field: string; question: string }>;
}

// ---------------------------------------------------------------------------
// buildResponse — Stage 8 main entry
// ---------------------------------------------------------------------------

/**
 * Build the chat response for a completed pipeline turn.
 *
 * Called after tool execution (Stage 7). Receives the classified intent,
 * all tool results, the readiness snapshot, the extracted fields from the
 * current message, and the live chat context.
 *
 * `generateFn` is optional: when provided, multi-tool and QUERY results are
 * synthesised via the LLM. When absent (e.g. in tests), a deterministic
 * fallback is used instead.
 */
export async function buildResponse(
  intent: Intent,
  toolResults: ToolExecutionResult[],
  readiness: ReadinessResult,
  extraction: ExtractionResult,
  chatContext: ChatContext,
  generateFn?: GenerateFn,
  nsContext?: NamespaceContext | null,
): Promise<ChatResponse> {
  const requirementsUpdated = Object.keys(extraction.fields).length > 0;
  const toolsCalled = toolResults.map((r) => r.tool);

  // --- GREETING ---
  if (intent === 'GREETING') {
    return buildGreetingResponse(extraction, chatContext, requirementsUpdated);
  }

  // --- CLIENT_DATA_COLLECTION ---
  if (intent === 'CLIENT_DATA_COLLECTION') {
    return buildClientDataResponse(nsContext ?? null, extraction, chatContext.lastAssistantMessage ?? '');
  }

  // --- UPDATE_REQUIREMENTS (confirm what was captured) ---
  if (intent === 'UPDATE_REQUIREMENTS') {
    return buildUpdateRequirementsResponse(extraction, toolsCalled);
  }

  // --- INGEST_GUIDANCE (upload instructions + action card) ---
  if (intent === 'INGEST_GUIDANCE') {
    return {
      text:
        'To upload documents, use the file attachment button below. ' +
        'I support RFPs, meeting transcripts, technical specs, emails, and proposal drafts. ' +
        'Once uploaded, I\'ll extract requirements and knowledge from them automatically.',
      actionCards: [{ type: 'upload', label: 'Upload Document', href: '/upload' }],
      requirementsUpdated,
      toolsCalled,
    };
  }

  // --- No tools executed (edge case — plan had no CALL_TOOL actions) ---
  if (toolResults.length === 0) {
    return {
      text: "Done. Let me know what you'd like to do next.",
      actionCards: [],
      requirementsUpdated,
      toolsCalled: [],
    };
  }

  // --- Single tool result ---
  if (toolResults.length === 1) {
    return buildSingleToolResponse(toolResults[0]!, requirementsUpdated);
  }

  // --- Multi-tool or QUERY with RAG results — LLM synthesis preferred ---
  if (generateFn) {
    return buildLLMSynthesisResponse(toolResults, requirementsUpdated, generateFn);
  }

  // Deterministic fallback when generateFn is unavailable
  return buildMultiToolFallbackResponse(toolResults, requirementsUpdated);
}

// ---------------------------------------------------------------------------
// buildNotReadyResponse — called at Stage 4 when readiness fails
// ---------------------------------------------------------------------------

/**
 * Formats missing required fields as a numbered question list.
 * Blockers (e.g. "no proposals exist") appear above the question list.
 */
export function buildNotReadyResponse(
  _intent: Intent,
  readiness: ReadinessResult,
  extraction: ExtractionResult,
): ChatResponse {
  const requirementsUpdated = Object.keys(extraction.fields).length > 0;
  const requiredMissing = readiness.missingFields.filter((f: MissingField) => f.required);
  const lines: string[] = [];

  if (readiness.blockers.length > 0) {
    lines.push(...readiness.blockers);
    if (requiredMissing.length > 0) {
      lines.push('');
    }
  }

  return {
    text: requiredMissing.length > 0 ? '' : lines.join('\n'),
    actionCards: [],
    requirementsUpdated,
    toolsCalled: [],
    questions: requiredMissing.map((f: MissingField) => ({ field: f.field, question: f.question })),
  };
}

// ---------------------------------------------------------------------------
// buildConfirmationResponse — called at Stage 4.5 when the confirmation gate
// halts the pipeline
// ---------------------------------------------------------------------------

export function buildConfirmationResponse(
  request: ConfirmationRequest,
  extraction: ExtractionResult,
): ChatResponse {
  const requirementsUpdated = Object.keys(extraction.fields).length > 0;
  const lines: string[] = [];
  const actionCards: ActionCard[] = [];

  if (request.kind === 'confirm_entities') {
    lines.push(
      "Before I generate the proposal, I want to confirm a few details I extracted from your documents:",
      '',
    );
    for (const entity of request.entities) {
      const sourceLabel = entity.source === 'inferred' ? 'inferred' : 'from documents';
      const fieldLabel =
        entity.field === 'clientName' ? 'Client' :
        entity.field === 'clientIndustry' ? 'Client Industry' :
        entity.field === 'projectType' ? 'Service Type' :
        entity.field;
      lines.push(`- **${fieldLabel}:** ${entity.value} *(${sourceLabel})*`);
    }

    if (request.optionalFields.length > 0) {
      lines.push('');
      lines.push('I also noticed these details are missing — feel free to fill them in or skip:');
      for (const opt of request.optionalFields) {
        lines.push(`- ${opt.question}`);
      }
    }

    lines.push('');
    lines.push('Reply **"yes"** to confirm and continue, or correct anything above.');

  } else if (request.kind === 'confirm_template') {
    // Text intentionally empty — rendered by the composer template card on the frontend
  } else if (request.kind === 'approve_generated_template') {
    // Text intentionally empty — rendered by the composer template card on the frontend

    actionCards.push({
      type: 'view_template',
      label: 'View Full Draft',
      href: request.viewLink,
    });
  }

  return {
    text: lines.join('\n'),
    actionCards,
    requirementsUpdated,
    toolsCalled: [],
    confirmationRequest: request,
  };
}

// ---------------------------------------------------------------------------
// buildPlanFailureResponse — called at Stage 6 when plan validation fails
// ---------------------------------------------------------------------------

export function buildPlanFailureResponse(extraction: ExtractionResult): ChatResponse {
  return {
    text:
      "I wasn't able to create a plan for that request. " +
      "Try rephrasing, or let me know what you'd like to do with your proposal.",
    actionCards: [],
    requirementsUpdated: Object.keys(extraction.fields).length > 0,
    toolsCalled: [],
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildGreetingResponse(
  extraction: ExtractionResult,
  chatContext: ChatContext,
  requirementsUpdated: boolean,
): ChatResponse {
  // Prefer a client name extracted from the current message, then fall back to
  // the namespace identifier (if it isn't the generic "default").
  const clientName = extraction.fields.clientName?.value as string | undefined;
  const projectName =
    clientName ?? (chatContext.namespace !== 'default' ? chatContext.namespace : null);
  const projectHint = projectName ? ` Ready to help with ${projectName}.` : '';

  return {
    text:
      `Hello!${projectHint} I can help you create proposals, templates, and ` +
      'presentation microsites. What are you working on?',
    actionCards: [],
    requirementsUpdated,
    toolsCalled: [],
  };
}

function buildUpdateRequirementsResponse(
  extraction: ExtractionResult,
  toolsCalled: ToolName[],
): ChatResponse {
  const updates = Object.entries(extraction.fields)
    .map(([key, field]) => `- ${key}: ${field?.value}`)
    .join('\n');

  const text = updates
    ? `Requirements updated:\n${updates}`
    : "Got it — I've noted that for your project.";

  return {
    text,
    actionCards: [],
    requirementsUpdated: true,
    toolsCalled,
  };
}

function buildSingleToolResponse(
  result: ToolExecutionResult,
  requirementsUpdated: boolean,
): ChatResponse {
  if (result.success) {
    return {
      text: result.message,
      actionCards: result.actionCards ?? [],
      requirementsUpdated,
      toolsCalled: [result.tool],
    };
  }

  const suggestion = getFailureSuggestion(result.tool);
  return {
    text: suggestion ? `${result.message}\n\n${suggestion}` : result.message,
    actionCards: [],
    requirementsUpdated,
    toolsCalled: [result.tool],
  };
}

async function buildLLMSynthesisResponse(
  toolResults: ToolExecutionResult[],
  requirementsUpdated: boolean,
  generateFn: GenerateFn,
): Promise<ChatResponse> {
  const resultSummaries = toolResults
    .map((r) => `${r.tool}: ${r.success ? r.message : `FAILED — ${r.message}`}`)
    .join('\n');

  const prompt =
    'Summarize the following tool execution results into a concise, helpful response ' +
    'for the user. Be direct and specific. Do not repeat tool names verbatim.\n\n' +
    `Results:\n${resultSummaries}\n\nSummary:`;

  try {
    const text = await generateFn(prompt);
    const allActionCards = toolResults.flatMap((r) => r.actionCards ?? []);
    return {
      text: text.trim(),
      actionCards: allActionCards,
      requirementsUpdated,
      toolsCalled: toolResults.map((r) => r.tool),
    };
  } catch {
    return buildMultiToolFallbackResponse(toolResults, requirementsUpdated);
  }
}

function buildMultiToolFallbackResponse(
  toolResults: ToolExecutionResult[],
  requirementsUpdated: boolean,
): ChatResponse {
  const parts = toolResults.map((r) =>
    r.success ? r.message : `${r.tool} failed: ${r.message}`,
  );
  const allActionCards = toolResults.flatMap((r) => r.actionCards ?? []);
  return {
    text: parts.join('\n\n'),
    actionCards: allActionCards,
    requirementsUpdated,
    toolsCalled: toolResults.map((r) => r.tool),
  };
}

function getFailureSuggestion(tool: ToolName): string {
  switch (tool) {
    case 'generate_proposal':
      return 'Try providing more context about the client or project requirements.';
    case 'generate_microsite':
      return 'Make sure the proposal is approved or finalized before generating a microsite.';
    case 'generate_template':
      return 'Check that you have the necessary template details.';
    case 'edit_proposal_section':
      return 'Check that the proposal file exists and the section name is correct.';
    case 'search_documents':
      return 'Try a different search query, or upload relevant documents first.';
    default:
      return '';
  }
}
