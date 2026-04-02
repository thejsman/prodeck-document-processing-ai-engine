/**
 * Proposal generation workflow — state handlers.
 *
 * Each handler corresponds to one workflow state and is responsible for:
 *   - executing the business logic for that state
 *   - emitting streaming phase and content events via callbacks
 *   - returning a stateSignal to drive the transition in the orchestrator
 *   - updating instance.context in place (orchestrator checkpoints afterwards)
 *
 * Handlers are pure async functions that receive all dependencies via
 * HandlerContext — no global state, no direct filesystem access outside
 * the injected workdir path.
 *
 * Tool-Request Loop v2:
 *   The generating_outline handler uses AgentExecutor to enable the LLM to
 *   autonomously call tools (e.g. search-documents) during outline generation.
 *   Tool execution traces are emitted via onToolEvent for SSE streaming.
 *   Section content generation is delegated to @ai-engine/plugin-proposal-generator.
 */

import { readFile, mkdir } from 'node:fs/promises';
import {
  buildFactMap,
  detectContradictions,
  buildQAMessage,
  parseSectionsFromMarkdown,
  type Contradiction,
} from '../proposals/proposal-qa.js';
import path from 'node:path';
import type { ToolOutput } from '@ai-engine/core';
import { toolRegistry } from '@ai-engine/core';
import { spawnProposalGenerator } from '@ai-engine/plugin-proposal-generator';
import { ensureTemplateYaml } from '../templates/template-yaml-bridge.js';
import type { WorkflowInstance } from './workflow-instance.service.js';
import type { LLMContext } from '../chat/context-builder.js';
import { formatConversationForContext } from '../chat/context-builder.js';
import {
  extractRequirementsFromKnowledge,
  type ExtractedField,
  type ExtractedProposalInputs,
} from '../ingestion/extract-proposal-inputs.js';
import {
  chatExtractionsToStore,
  buildMergedStore,
  detectConflicts,
  flattenRequirements,
  buildConflictPrompt,
  resolveConflictResponse,
  type RequirementKey,
  type RequirementStore,
} from '../ingestion/requirement-merger.js';
import { loadFilesIndex } from '../ingestion/ingestion-service.js';
import { llmGenerateFn } from '../agent-routes.js';
import { AgentExecutor, TOOL_TIMEOUT_MS } from '../chat/agent-executor.js';
import type { ToolDescriptor } from '../chat/agent-executor.js';
import { recommendTemplate } from '../templates/template-recommendation.service.js';
import { extractRfpRequirements } from '../ingestion/extract-rfp-requirements.js';
import type { RecommendationContext } from '../templates/template-types.js';
import { createInitialVersion } from '../proposals/proposal-version.service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HandlerResult {
  /** Human-readable chat message to return to the user. */
  message: string;
  /** Workflow signal that drives the next state transition (e.g. READY, DONE). */
  stateSignal?: string;
  /** Optional action metadata to surface in the final response (links, etc.). */
  actions?: Record<string, string>;
}

export interface ToolTraceEvent {
  type: 'tool_started' | 'tool_completed' | 'tool_failed';
  tool: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface HandlerContext {
  workdir: string;
  namespace: string;
  /** The live instance object — handlers may mutate instance.context directly. */
  instance: WorkflowInstance;
  /** The user's incoming message text. */
  incomingMessage: string;
  /** Emit a phase label (e.g. "Analyzing RFP") to the client. */
  onPhase: (phase: string) => void;
  /** Emit a token chunk to the client for streaming display. */
  onChunk: (chunk: string) => void;
  /**
   * Emit a fully-generated proposal section as a structured block.
   * When provided, handleGeneratingSections uses this instead of onChunk
   * so the frontend can render interactive editable section blocks.
   * Falls back to onChunk when absent (e.g. non-streaming or resume paths).
   */
  onSection?: (section: string, content: string, artifactId: string) => void;
  /**
   * Emit a tool execution trace event to the client (STEP 5).
   * Optional — no-op if not provided (e.g. non-streaming paths).
   */
  onToolEvent?: (event: ToolTraceEvent) => void;
  /**
   * Full LLM context built by the context builder for this turn.
   * Includes conversation window, system prompt, requirement status, and task instruction.
   * Injected by the orchestrator before handler dispatch.
   */
  conversationContext?: LLMContext;
}

// ---------------------------------------------------------------------------
// Generation guard — STEPS 1–5
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = ['industry', 'timeline', 'budget'] as const;
type RequiredField = typeof REQUIRED_FIELDS[number];

function getEffectiveRequirements(context: WorkflowInstance['context']): Record<string, string> {
  // Priority: confirmedRequirements > proposalRequirements (merged flat map)
  return {
    ...(context.proposalRequirements as Record<string, string> | undefined ?? {}),
    ...(context.confirmedRequirements as Record<string, string> | undefined ?? {}),
  };
}

function isReadyForGeneration(context: WorkflowInstance['context']): boolean {
  const reqs = getEffectiveRequirements(context);
  return REQUIRED_FIELDS.every((field) => Boolean(reqs[field]));
}

function getMissingFields(context: WorkflowInstance['context']): RequiredField[] {
  const reqs = getEffectiveRequirements(context);
  return REQUIRED_FIELDS.filter((field) => !reqs[field]);
}

const REQUIREMENT_QUESTIONS: Record<RequiredField, string> = {
  industry: 'What industry is this proposal for?',
  timeline: 'What timeline are you targeting?',
  budget: 'Do you have a budget range in mind?',
};

/**
 * Build the requirement-asking message.
 * Acknowledges already-confirmed fields so the user feels heard and the
 * conversation feels continuous rather than starting from scratch each turn.
 */
function buildRequirementPrompt(
  missing: RequiredField[],
  confirmed: Record<string, string>,
): string {
  const confirmedEntries = REQUIRED_FIELDS
    .filter((f) => confirmed[f])
    .map((f) => `• **${f}**: ${confirmed[f]}`);

  const parts: string[] = [];

  if (confirmedEntries.length > 0) {
    parts.push('I already have:');
    parts.push(...confirmedEntries);
    parts.push('');
  }

  parts.push('I still need:');
  parts.push(...missing.map((m) => `• ${m}`));
  parts.push('');
  parts.push(REQUIREMENT_QUESTIONS[missing[0]]);

  return parts.join('\n');
}

/**
 * Decide how to handle an extracted field based on its confidence score.
 *
 *   ≥ 0.85  →  auto_fill  (silently populate, briefly inform user)
 *   ≥ 0.60  →  confirm    (ask user to confirm before accepting)
 *   < 0.60  →  ask        (discard extraction, ask manually — already filtered at extraction time)
 */
type FieldDecision = 'auto_fill' | 'confirm' | 'ask';

function resolveField(field: ExtractedField): FieldDecision {
  if (field.confidence >= 0.85) return 'auto_fill';
  if (field.confidence >= 0.6) return 'confirm';
  return 'ask';
}

/**
 * Ask the user to confirm a medium-confidence extracted value.
 * Acknowledges already-confirmed fields and shows the supporting evidence.
 */
function buildConfirmationPrompt(
  field: RequiredField,
  extracted: ExtractedField,
  allMissing: RequiredField[],
  confirmed: Record<string, string>,
): string {
  const { value, evidence } = extracted;
  const confirmedEntries = REQUIRED_FIELDS
    .filter((f) => confirmed[f])
    .map((f) => `• **${f}**: ${confirmed[f]}`);

  const parts: string[] = [];

  if (confirmedEntries.length > 0) {
    parts.push('I already have:');
    parts.push(...confirmedEntries);
    parts.push('');
  }

  const evidenceLine = evidence ? `\n\n> "${evidence}"` : '';
  const otherMissing = allMissing.filter((f) => f !== field);
  const suffix = otherMissing.length > 0
    ? `\n\nI'll also need: ${otherMissing.join(', ')}.`
    : '';

  parts.push(
    `I found that the **${field}** is **${value}** based on your documents.${evidenceLine}`,
    '',
    `Should I use this?${suffix}`,
    '',
    'Reply **yes** to confirm, **no** to skip, or type a different value.',
  );

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Tool descriptors available to proposal generation handlers
// ---------------------------------------------------------------------------

const PROPOSAL_TOOLS: ToolDescriptor[] = [
  {
    name: 'search-documents',
    description: 'Search indexed documents in the namespace for relevant information.',
    inputSchema: '{ "query": "string" }',
  },
  {
    name: 'extract-section',
    description: 'Extract a named section from markdown content.',
    inputSchema: '{ "content": "string", "query": "string" }',
  },
];

// ---------------------------------------------------------------------------
// Tool runner helper
// ---------------------------------------------------------------------------

/**
 * Execute a named tool from the registry within the per-tool timeout.
 * Emits tool trace events via onToolEvent when provided.
 */
async function runTool(
  toolName: string,
  input: unknown,
  namespace: string,
  onToolEvent?: HandlerContext['onToolEvent'],
): Promise<ToolOutput> {
  const toolInput = {
    namespace,
    ...(typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}),
  };

  onToolEvent?.({ type: 'tool_started', tool: toolName, input: toolInput });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Tool "${toolName}" timed out after ${TOOL_TIMEOUT_MS}ms`)), TOOL_TIMEOUT_MS),
  );

  try {
    const tool = toolRegistry.get(toolName);
    const output = await Promise.race([tool.run(toolInput), timeoutPromise]);
    onToolEvent?.({ type: 'tool_completed', tool: toolName, input: toolInput, output });
    return output;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    onToolEvent?.({ type: 'tool_failed', tool: toolName, input: toolInput, error });
    return { text: `Tool failed: ${error}` };
  }
}

// ---------------------------------------------------------------------------
// collecting_rfp handler
// ---------------------------------------------------------------------------

/**
 * Wait for a usable RFP document to be present in the namespace uploads.
 *
 * Flow:
 *   1. If rfpUri already in context → signal READY immediately.
 *   2. Check the namespace files index for uploaded/indexed files.
 *   3. If none found → ask user to upload the RFP and return without signalling.
 *   4. If found → set context.rfpUri to the most recently uploaded file → signal READY.
 *
 * This handler is called on every user message while state = collecting_rfp,
 * so a second message after the user has uploaded will automatically proceed.
 */
export async function handleCollectingRfp(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, incomingMessage } = ctx;

  if (instance.context.rfpUri) {
    // Already have an RFP — transition immediately
    return { message: '', stateSignal: 'READY' };
  }

  const files = await loadFilesIndex(workdir, namespace);
  const available = files
    .filter((f) => f.status === 'indexed' || f.status === 'uploaded')
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  if (available.length === 0) {
    return {
      message: 'Please upload the RFP document to begin proposal generation.',
    };
  }

  // If user is confirming a previously listed file selection, pick the file
  if (instance.context.awaitingRfpConfirmation) {
    const lower = incomingMessage.toLowerCase();

    // Try to match by filename fragment in the user's message
    const matched = available.find((f) => lower.includes(f.fileName.toLowerCase()));
    const rfpFile = matched ?? available[0];

    instance.context.rfpUri = `uploads/${rfpFile.fileName}`;
    instance.context.awaitingRfpConfirmation = undefined;

    return {
      message: `Using "${rfpFile.fileName}" as the RFP document. Analysing and recommending a template…`,
      stateSignal: 'READY',
    };
  }

  // First time: list available files and ask the user to confirm
  instance.context.awaitingRfpConfirmation = true;

  const fileList = available.map((f, i) => `${i + 1}. **${f.fileName}**`).join('\n');

  if (available.length === 1) {
    return {
      message: [
        'I found the following document in your namespace:',
        '',
        fileList,
        '',
        'Reply **yes** to use this as the RFP document, or upload a different file.',
      ].join('\n'),
    };
  }

  return {
    message: [
      'I found the following documents in your namespace:',
      '',
      fileList,
      '',
      'Which document is the RFP? Reply with the number or file name, or upload a new file.',
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// collecting_inputs handler
// ---------------------------------------------------------------------------

/**
 * Gate proposal generation until all required fields are collected.
 *
 * Confidence-aware flow:
 *   1. On first entry, run extractRequirementsFromKnowledge and cache results.
 *   2. Process any pending confirmation response (yes / no / custom value).
 *   3. Auto-fill all high-confidence fields (≥ 0.85) not yet processed,
 *      collecting their names for a brief summary message.
 *   4. If all REQUIRED_FIELDS are satisfied → signal READY.
 *   5. For the next missing field:
 *        - Medium confidence (0.60–0.84) → ask for confirmation with evidence.
 *        - No extraction or declined     → ask manually (fallback).
 */
export async function handleCollectingInputs(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, incomingMessage } = ctx;

  // ── Initialise context stores ─────────────────────────────────
  if (!instance.context.confirmedRequirements) instance.context.confirmedRequirements = {};
  if (!instance.context.declinedFields) instance.context.declinedFields = [];

  const confirmed = instance.context.confirmedRequirements as Record<string, string>;
  const declined = instance.context.declinedFields as string[];

  // ── Run RFP extraction once on first entry ────────────────────
  if (!instance.context.rfpExtractionDone) {
    try {
      instance.context.rfpExtractedRequirements = await extractRequirementsFromKnowledge(
        workdir,
        namespace,
      );
    } catch {
      instance.context.rfpExtractedRequirements = {};
    }
    instance.context.rfpExtractionDone = true;
  }

  const rfpStore = (instance.context.rfpExtractedRequirements ?? {}) as ExtractedProposalInputs;
  const chatFlat = (instance.context.chatExtractedRequirements ?? {}) as Record<string, string>;
  const chatStore: RequirementStore = chatExtractionsToStore(chatFlat);

  // ── Process pending conflict resolution ──────────────────────
  const pendingConflict = instance.context.awaitingConflict as
    | { field: RequirementKey; rfpValue: string; chatValue: string }
    | undefined;

  if (pendingConflict) {
    instance.context.awaitingConflict = undefined;
    const chosen = resolveConflictResponse(incomingMessage, pendingConflict);
    if (chosen) {
      confirmed[pendingConflict.field] = chosen;
    }
    // If unrecognisable, fall through and re-surface conflicts next pass
  }

  // ── Process pending rfp/manual confirmation response ─────────
  const pending = instance.context.awaitingConfirmation as
    | { field: string; value: string }
    | undefined;

  if (pending) {
    instance.context.awaitingConfirmation = undefined;
    const lower = incomingMessage.toLowerCase().trim();
    const isYes = lower === 'yes' || lower === 'y' || lower.startsWith('yes,') || lower.startsWith('yes ');
    const isNo = lower === 'no' || lower === 'n' || lower.startsWith('no,') || lower.startsWith('no ');

    if (isYes) {
      confirmed[pending.field] = pending.value;
    } else if (isNo) {
      instance.context.declinedFields = [...declined, pending.field];
    } else {
      // Custom override — treat the full message as the value
      confirmed[pending.field] = incomingMessage.trim();
    }
  }

  // ── Detect conflicts between rfp and chat ────────────────────
  const conflicts = detectConflicts(rfpStore as RequirementStore, chatStore, confirmed);
  if (conflicts.length > 0) {
    const conflict = conflicts[0];
    instance.context.awaitingConflict = {
      field: conflict.field,
      rfpValue: conflict.rfpValue,
      chatValue: conflict.chatValue,
    };
    return { message: buildConflictPrompt(conflict) };
  }

  // ── Merge all sources → effective flat map ────────────────────
  const mergedStore = buildMergedStore(rfpStore as RequirementStore, chatStore, confirmed);
  const mergedFlat = flattenRequirements(mergedStore);

  // ── Auto-fill high-confidence fields not yet confirmed ────────
  const autoFilled: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (confirmed[field] || declined.includes(field)) continue;
    const entry = mergedStore[field];
    if (!entry) continue;
    if (entry.source === 'chat' || resolveField(entry as ExtractedField) === 'auto_fill') {
      confirmed[field] = entry.value;
      autoFilled.push(`**${field}**: ${entry.value}`);
    }
  }

  // ── Sync proposalRequirements (flat map used by generation) ──
  instance.context.proposalRequirements = { ...mergedFlat, ...confirmed };

  // ── Ready check ───────────────────────────────────────────────
  if (isReadyForGeneration(instance.context)) {
    const autoFillNote = autoFilled.length > 0
      ? `I've filled in the following from your documents:\n${autoFilled.map((l) => `• ${l}`).join('\n')}\n\n`
      : '';
    return {
      message: `${autoFillNote}Great — I have everything I need. I'll now recommend a template for your proposal.`,
      stateSignal: 'READY',
    };
  }

  // ── Next missing field: confirm (medium rfp) or ask manually ─
  const missing = getMissingFields(instance.context);
  const nextField = missing[0];
  const nextEntry = mergedStore[nextField];
  const autoFillPrefix = autoFilled.length > 0
    ? `I've filled in the following from your documents:\n${autoFilled.map((l) => `• ${l}`).join('\n')}\n\n`
    : '';

  if (
    nextEntry &&
    nextEntry.source === 'rfp' &&
    !declined.includes(nextField) &&
    resolveField(nextEntry as ExtractedField) === 'confirm'
  ) {
    instance.context.awaitingConfirmation = { field: nextField, value: nextEntry.value };
    return {
      message: autoFillPrefix + buildConfirmationPrompt(nextField, nextEntry as ExtractedField, missing, confirmed),
    };
  }

  // No usable extraction — ask manually
  return {
    message: autoFillPrefix + buildRequirementPrompt(missing, confirmed),
  };
}

// ---------------------------------------------------------------------------
// recommend_template handler
// ---------------------------------------------------------------------------

/**
 * Analyse the RFP context and recommend the best proposal template.
 *
 * Flow:
 *   1. Emit phase "Analyzing proposal patterns".
 *   2. Extract or reuse the requirement matrix from context.
 *   3. Emit phase "Matching product capabilities".
 *   4. Call the template recommendation engine.
 *   5. Emit phase "Selecting optimal template".
 *   6. If a template is recommended → store in context, stream reasoning.
 *   7. If fallbackGenerate → use AgentExecutor to generate a custom structure.
 *   8. Signal DONE to proceed to outline generation.
 */
export async function handleRecommendTemplate(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, incomingMessage, onPhase, onChunk, onToolEvent } = ctx;

  // If a template recommendation was already shown, the user is now confirming
  if (instance.context.awaitingTemplateConfirmation) {
    const lower = incomingMessage.toLowerCase();
    const isRejection = lower.includes('no') || lower.includes('change') || lower.includes('different') || lower.includes('another');

    if (isRejection) {
      // Let the user pick again — reset and re-run analysis
      instance.context.awaitingTemplateConfirmation = undefined;
      instance.context.templateRecommendation = undefined;
      instance.context.selectedTemplate = undefined;
      // Fall through to re-run the analysis below
    } else {
      // User confirmed — proceed to outline generation
      instance.context.awaitingTemplateConfirmation = undefined;
      return { message: 'Great! Proceeding to outline generation.', stateSignal: 'DONE' };
    }
  }

  // ── Phase 1: Analyze proposal patterns ──────────────────────
  onPhase('Analyzing proposal patterns');

  // Build or reuse requirement matrix
  let requirementMatrix = instance.context.requirementMatrix as RecommendationContext['requirementMatrix'] | undefined;

  if (!requirementMatrix) {
    try {
      requirementMatrix = await extractRfpRequirements(workdir, namespace);
      instance.context.requirementMatrix = requirementMatrix;
    } catch {
      // Fallback: empty matrix — engine will rely on vector store search
      requirementMatrix = { functional: [], compliance: [], timeline: [], pricing: [] };
      instance.context.requirementMatrix = requirementMatrix;
    }
  }

  // ── Phase 2: Match product capabilities ─────────────────────
  onPhase('Matching product capabilities');

  const recommendationContext: RecommendationContext = {
    requirementMatrix,
    detectedIndustry: instance.context.detectedIndustry as string | undefined,
    keyCapabilities: instance.context.keyCapabilities as string[] | undefined,
    namespace,
  };

  const recommendation = await recommendTemplate(recommendationContext, workdir);

  // ── Phase 3: Selecting optimal template ─────────────────────
  onPhase('Selecting optimal template');

  // Store the recommendation in workflow context
  instance.context.templateRecommendation = recommendation;

  if (!recommendation.fallbackGenerate && recommendation.template) {
    // ── Recommended an existing template ────────────────────────
    instance.context.selectedTemplate = recommendation.template;

    const message = [
      recommendation.reasoning,
      '',
      `**Template:** ${recommendation.template.name}`,
      `**Confidence:** ${(recommendation.confidence * 100).toFixed(0)}%`,
      '',
      '**Sections:**',
      ...recommendation.template.structure.map((s, i) => `${i + 1}. ${s}`),
      '',
      'Reply **yes** to use this template, or **no** to generate a custom structure from the RFP.',
    ].join('\n');

    // Stream the recommendation to the client
    onChunk(message);

    // Pause — wait for user to confirm the template before proceeding
    instance.context.awaitingTemplateConfirmation = true;

    return { message };
  }

  // ── Fallback: generate a custom template structure ──────────
  onPhase('Generating custom proposal structure');

  const prompt = [
    'You are a professional proposal strategist.',
    'Based on the RFP requirements below, generate a proposal section structure.',
    '',
    'Requirements:',
    '- Create an ordered list of section titles (8-12 sections)',
    '- Each section must be specific to the RFP context, not generic',
    '- Include an Executive Summary as the first section',
    '- Include Budget/Pricing and Next Steps as final sections',
    '- Output ONLY the numbered list of section titles, nothing else',
    '',
    `RFP Functional Requirements: ${requirementMatrix.functional.join('; ') || '(none extracted)'}`,
    `RFP Compliance Requirements: ${requirementMatrix.compliance.join('; ') || '(none extracted)'}`,
    `RFP Timeline Constraints: ${requirementMatrix.timeline.join('; ') || '(none extracted)'}`,
    recommendation.reasoning ? `\nContext: ${recommendation.reasoning}` : '',
  ].join('\n');

  const executor = new AgentExecutor(llmGenerateFn);
  let generatedStructureText = '';

  for await (const event of executor.runStreaming({
    prompt,
    namespace,
    tools: PROPOSAL_TOOLS,
    systemPrompt: ctx.conversationContext?.systemPrompt,
    priorContext: ctx.conversationContext
      ? formatConversationForContext(ctx.conversationContext.conversationWindow)
      : undefined,
  })) {
    if (event.type === 'token') {
      onChunk(event.text);
      generatedStructureText += event.text;
    } else if (event.type === 'phase') {
      onPhase(event.name);
    } else if (event.type === 'tool_request') {
      onPhase(`Using tool: ${event.tool}`);
      const toolOutput = await runTool(event.tool, event.input, namespace, onToolEvent);
      executor.resumeWithToolResult(toolOutput);
    } else if (event.type === 'final') {
      if (!generatedStructureText) generatedStructureText = event.result.text;
    }
  }

  // Parse the generated structure into section titles
  const generatedStructure = generatedStructureText
    .split('\n')
    .map((line) => line.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter((line) => line.length > 0);

  // Store as a synthetic template in context
  instance.context.selectedTemplate = {
    id: 'generated-custom',
    name: 'Custom (Generated from RFP)',
    tags: [],
    structure: generatedStructure.length > 0 ? generatedStructure : [
      'Executive Summary',
      'Problem Statement',
      'Proposed Solution',
      'Technical Approach',
      'Timeline & Milestones',
      'Team & Credentials',
      'Budget Estimate',
      'Next Steps',
    ],
  };

  const message = [
    recommendation.reasoning,
    '',
    'I\'ve generated a custom proposal structure tailored to the RFP:',
    '',
    ...((instance.context.selectedTemplate as { structure: string[] }).structure).map(
      (s: string, i: number) => `${i + 1}. ${s}`,
    ),
    '',
    'Reply **yes** to proceed with this structure, or **no** to try again.',
  ].join('\n');

  // Pause — wait for user to confirm the custom structure before proceeding
  instance.context.awaitingTemplateConfirmation = true;

  return { message };
}

// ---------------------------------------------------------------------------
// generating_outline handler
// ---------------------------------------------------------------------------

/**
 * Generate a structured proposal outline from the RFP document.
 *
 * Uses AgentExecutor so the LLM can call search-documents / extract-section
 * to gather additional context before producing the outline.
 *
 * Flow:
 *   1. Emit phase "Analyzing RFP".
 *   2. Read RFP content from the namespace uploads directory.
 *   3. Emit phase "Generating proposal structure".
 *   4. Run AgentExecutor tool-request loop:
 *        - LLM may call tools to enrich context
 *        - Token chunks forwarded to onChunk
 *        - Tool events forwarded to onToolEvent
 *   5. Store outline in instance.context.outline.
 *   6. Signal DONE.
 */
export async function handleGeneratingOutline(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, onPhase, onChunk, onToolEvent } = ctx;

  onPhase('Analyzing RFP');

  // Read RFP document content
  let rfpContent = '';
  if (instance.context.rfpUri) {
    const rfpPath = path.join(workdir, 'namespaces', namespace, instance.context.rfpUri as string);
    rfpContent = await readFile(rfpPath, 'utf-8').catch(() => '');
  }

  onPhase('Generating proposal structure');

  // Use selected template structure from recommendation step (if available)
  const selectedTemplate = instance.context.selectedTemplate as { structure?: string[] } | undefined;
  const sectionList = selectedTemplate?.structure ?? [
    'Executive Summary',
    'Problem Statement',
    'Proposed Solution',
    'Technical Approach',
    'Timeline & Milestones',
    'Team & Credentials',
    'Budget Estimate',
    'Next Steps',
  ];

  const prompt = [
    'You are a professional proposal writer. Create a concise, structured proposal outline based on the RFP below.',
    '',
    'The outline must follow this section structure:',
    ...sectionList.map((s, i) => `${i + 1}. ${s}`),
    '',
    rfpContent
      ? `RFP Document:\n${rfpContent}`
      : '(No RFP content available — produce a generic cloud migration proposal outline)',
    '',
    'You may use the search-documents tool to find additional context from the namespace knowledge base.',
    'Respond with a clean markdown outline only. Be concise and professional.',
  ].join('\n');

  const executor = new AgentExecutor(llmGenerateFn);

  let outline = '';

  for await (const event of executor.runStreaming({
    prompt,
    namespace,
    tools: PROPOSAL_TOOLS,
    systemPrompt: ctx.conversationContext?.systemPrompt,
    priorContext: ctx.conversationContext
      ? formatConversationForContext(ctx.conversationContext.conversationWindow)
      : undefined,
  })) {
    if (event.type === 'token') {
      onChunk(event.text);
      outline += event.text;
    } else if (event.type === 'phase') {
      onPhase(event.name);
    } else if (event.type === 'tool_request') {
      onPhase(`Using tool: ${event.tool}`);
      const toolOutput = await runTool(event.tool, event.input, namespace, onToolEvent);
      executor.resumeWithToolResult(toolOutput);
    } else if (event.type === 'final') {
      if (!outline) outline = event.result.text;
      if (event.result.maxIterationsReached) {
        onPhase('Tool iteration limit reached — proceeding with available information.');
      }
    }
  }

  instance.context.outline = outline;
  instance.context.toolResults = (instance.context.toolResults as unknown[] | undefined) ?? [];

  return {
    message: outline,
    stateSignal: 'DONE',
  };
}

// ---------------------------------------------------------------------------
// generating_sections handler
// ---------------------------------------------------------------------------

/**
 * Expand the outline into a full proposal draft using the canonical
 * @ai-engine/plugin-proposal-generator Python plugin.
 *
 * Flow:
 *   1. Resolve the selected template → ensure a YAML file exists for it
 *   2. Call spawnProposalGenerator — writes the file to the namespace
 *      proposals directory and returns the full markdown
 *   3. Validation guard — throw if no artifact was saved
 *   4. Create initial version snapshot
 *   5. Update context.proposalArtifactId
 *   6. Parse sections from markdown and emit as structured blocks (STEP 7)
 *   7. QA pass — detect cross-section contradictions
 */
export async function handleGeneratingSections(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, onPhase, onChunk, onSection } = ctx;

  const requirements = getEffectiveRequirements(instance.context);

  // ── Resolve template ────────────────────────────────────────────
  const selectedTemplate = instance.context.selectedTemplate as
    | { id?: string; name?: string; structure?: string[] }
    | undefined;

  // Ensure a YAML file exists for the selected template so the plugin can
  // use it. Falls back to 'default' if no template was selected.
  let templateSlug = 'default';
  if (selectedTemplate?.id && selectedTemplate.structure) {
    onPhase('Preparing template');
    templateSlug = await ensureTemplateYaml(workdir, {
      id: selectedTemplate.id,
      name: selectedTemplate.name ?? selectedTemplate.id,
      tags: [],
      structure: selectedTemplate.structure,
    });
  }

  // ── Run the Python proposal generator plugin ────────────────────
  const proposalsDir = path.join(workdir, 'namespaces', namespace, 'proposals');
  await mkdir(proposalsDir, { recursive: true });

  onPhase('Generating proposal');

  const document = await spawnProposalGenerator({
    workdir,
    outputDir: proposalsDir,
    client: requirements.client ?? namespace,
    industry: requirements.industry ?? 'General',
    namespace,
    template: templateSlug,
    templateDir: path.join(workdir, 'data', 'templates'),
    overwrite: false,
    pricing: null,
    tone: null,
    memory: null,
  });

  // ── Validation guard ────────────────────────────────────────────
  const meta = document.metadata as Record<string, unknown>;
  const outputFile = meta.output_file as string | undefined;
  if (!outputFile) throw new Error('Proposal not saved — plugin returned no output_file');

  const artifactId = path.basename(outputFile);
  const proposalMarkdown = document.content;

  // ── Version creation ────────────────────────────────────────────
  try {
    const version = await createInitialVersion(workdir, namespace, artifactId, 'system');
    onPhase(`Saved as version ${version.versionLabel}`);
  } catch {
    // Non-fatal — version tracking must not block proposal delivery
  }

  // ── Context update ──────────────────────────────────────────────
  instance.context.proposalArtifactId = artifactId;

  // ── Emit structured section blocks (STEP 7) ─────────────────────
  // The Python plugin returns the full markdown at once. Parse it into
  // sections and emit each one so the frontend renders interactive blocks.
  const parsedSections = parseSectionsFromMarkdown(proposalMarkdown);
  if (onSection && parsedSections.length > 0) {
    for (const sec of parsedSections) {
      onSection(sec.name, sec.content, artifactId);
    }
  } else {
    onChunk(proposalMarkdown);
  }

  // ── QA pass ─────────────────────────────────────────────────────
  onPhase('Checking proposal consistency');
  try {
    const factMap = await buildFactMap(parsedSections);
    const contradictions = detectContradictions(factMap, requirements);
    instance.context.qaContradictions = contradictions;
    instance.context.qaArtifactPath = outputFile;
  } catch {
    instance.context.qaContradictions = [];
  }

  return {
    message: proposalMarkdown,
    stateSignal: 'DONE',
    actions: {
      openProposalUrl: `/proposals/${namespace}/${artifactId}`,
    },
  };
}

// ---------------------------------------------------------------------------
// qa_review handler
// ---------------------------------------------------------------------------

/**
 * Surface cross-section contradictions and optionally auto-fix them.
 *
 * Flow:
 *   1. On entry: if contradictions exist, ask the user whether to fix them.
 *      If no contradictions → signal DONE immediately (clean proposal).
 *   2. On user reply:
 *      - yes / y / fix    → apply canonical values to the artifact on disk,
 *                           create a new version snapshot, signal DONE.
 *      - no  / skip       → signal DONE without changes.
 *      - anything else    → re-ask (one retry).
 */
export async function handleQaReview(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, incomingMessage } = ctx;

  const contradictions = (instance.context.qaContradictions ?? []) as Contradiction[];
  const artifactPath = instance.context.qaArtifactPath as string | undefined;
  const artifactId   = instance.context.proposalArtifactId as string | undefined;

  // ── No contradictions → proceed immediately ───────────────────
  if (contradictions.length === 0) {
    return {
      message: 'Proposal looks consistent — no contradictions found.',
      stateSignal: 'DONE',
      actions: artifactId ? { openProposalUrl: `/proposals/${namespace}/${artifactId}` } : {},
    };
  }

  // ── First entry: surface the QA findings ─────────────────────
  if (!instance.context.awaitingQaConfirmation) {
    instance.context.awaitingQaConfirmation = true;
    return { message: buildQAMessage(contradictions) };
  }

  // ── Process user response ─────────────────────────────────────
  instance.context.awaitingQaConfirmation = undefined;

  const lower = incomingMessage.toLowerCase().trim();
  const isYes = lower === 'yes' || lower === 'y'
    || lower.startsWith('yes')
    || lower.includes('fix')
    || lower.includes('sure')
    || lower.includes('go ahead');

  if (isYes && artifactPath) {
    try {
      const { applyQAFixes } = await import('../proposals/proposal-qa.js');
      await applyQAFixes(artifactPath, contradictions);

      // Create a new version snapshot for the QA-fixed proposal
      if (artifactId) {
        try {
          await createInitialVersion(workdir, namespace, artifactId, 'qa-fix');
        } catch {
          // Non-fatal
        }
      }

      instance.context.qaContradictions = [];

      return {
        message: 'Done — I\'ve aligned the inconsistent values across all sections.',
        stateSignal: 'DONE',
        actions: artifactId ? { openProposalUrl: `/proposals/${namespace}/${artifactId}` } : {},
      };
    } catch {
      return {
        message: 'I wasn\'t able to apply the fixes automatically. You can edit sections manually.',
        stateSignal: 'DONE',
        actions: artifactId ? { openProposalUrl: `/proposals/${namespace}/${artifactId}` } : {},
      };
    }
  }

  // User declined
  return {
    message: 'No problem — the proposal is ready as-is.',
    stateSignal: 'DONE',
    actions: artifactId ? { openProposalUrl: `/proposals/${namespace}/${artifactId}` } : {},
  };
}
