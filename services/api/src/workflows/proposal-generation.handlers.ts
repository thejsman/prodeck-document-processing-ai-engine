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
 *   The generating_outline and generating_sections handlers now use
 *   AgentExecutor to enable the LLM to autonomously call tools (e.g.
 *   search-documents) during generation.  Tool execution traces are emitted
 *   via onToolEvent for SSE streaming to the client.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ToolOutput } from '@ai-engine/core';
import { toolRegistry } from '@ai-engine/core';
import type { WorkflowInstance } from './workflow-instance.service.js';
import type { LLMContext } from '../chat/context-builder.js';
import { formatConversationForContext } from '../chat/context-builder.js';
import {
  extractRequirementsFromKnowledge,
  type ExtractedField,
  type ExtractedProposalInputs,
} from '../ingestion/extract-proposal-inputs.js';
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

function isReadyForGeneration(context: WorkflowInstance['context']): boolean {
  const reqs = context.proposalRequirements as Record<string, string> | undefined;
  return REQUIRED_FIELDS.every((field) => Boolean(reqs?.[field]));
}

function getMissingFields(context: WorkflowInstance['context']): RequiredField[] {
  const reqs = context.proposalRequirements as Record<string, string> | undefined;
  return REQUIRED_FIELDS.filter((field) => !reqs?.[field]);
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

  // ── Run extraction once on first entry ───────────────────────
  if (!instance.context.extractionDone) {
    try {
      instance.context.extractedRequirements = await extractRequirementsFromKnowledge(
        workdir,
        namespace,
      );
    } catch {
      instance.context.extractedRequirements = {};
    }
    instance.context.extractionDone = true;
  }

  const extracted = (instance.context.extractedRequirements ?? {}) as ExtractedProposalInputs;
  const declined = (instance.context.declinedFields ?? []) as string[];

  // ── Process pending confirmation response ────────────────────
  const pending = instance.context.awaitingConfirmation as
    | { field: string; value: string }
    | undefined;

  if (pending) {
    instance.context.awaitingConfirmation = undefined;
    const lower = incomingMessage.toLowerCase().trim();
    const isYes = lower === 'yes' || lower === 'y' || lower.startsWith('yes,') || lower.startsWith('yes ');
    const isNo = lower === 'no' || lower === 'n' || lower.startsWith('no,') || lower.startsWith('no ');

    if (isYes) {
      if (!instance.context.proposalRequirements) instance.context.proposalRequirements = {};
      (instance.context.proposalRequirements as Record<string, string>)[pending.field] = pending.value;
    } else if (isNo) {
      instance.context.declinedFields = [...declined, pending.field];
    } else {
      // Custom override — treat the full message as the value
      if (!instance.context.proposalRequirements) instance.context.proposalRequirements = {};
      (instance.context.proposalRequirements as Record<string, string>)[pending.field] =
        incomingMessage.trim();
    }
  }

  // ── Auto-fill all high-confidence fields (≥ 0.85) ────────────
  const autoFilled: string[] = [];
  const updatedDeclined = (instance.context.declinedFields ?? []) as string[];

  for (const field of getMissingFields(instance.context)) {
    const entry = extracted[field];
    if (!entry || updatedDeclined.includes(field)) continue;
    if (resolveField(entry) === 'auto_fill') {
      if (!instance.context.proposalRequirements) instance.context.proposalRequirements = {};
      (instance.context.proposalRequirements as Record<string, string>)[field] = entry.value;
      autoFilled.push(`**${field}**: ${entry.value}`);
    }
  }

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

  // ── Next missing field: confirm or ask ────────────────────────
  const missing = getMissingFields(instance.context);
  const nextField = missing[0];
  const nextEntry = extracted[nextField];
  const autoFillPrefix = autoFilled.length > 0
    ? `I've filled in the following from your documents:\n${autoFilled.map((l) => `• ${l}`).join('\n')}\n\n`
    : '';

  const confirmed = (instance.context.proposalRequirements ?? {}) as Record<string, string>;

  if (nextEntry && !updatedDeclined.includes(nextField) && resolveField(nextEntry) === 'confirm') {
    instance.context.awaitingConfirmation = { field: nextField, value: nextEntry.value };
    return {
      message: autoFillPrefix + buildConfirmationPrompt(nextField, nextEntry, missing, confirmed),
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
// generating_sections handler — cross-section coherence
// ---------------------------------------------------------------------------

/**
 * Accumulated state built up as each section is generated.
 * Passed into the next section's prompt so the LLM stays coherent.
 */
interface ProposalState {
  /** Concrete facts / claims established in prior sections. */
  keyPoints: string[];
  /** Timeline value set by an earlier section (locked — STEP 5 safety rule). */
  timeline: string | null;
  /** Pricing/budget value set by an earlier section (locked). */
  pricing: string | null;
  /** Writing tone established by the first section that set one. */
  tone: string | null;
}

/**
 * Merge a newly extracted section summary into the running ProposalState.
 * STEP 5 safety rule: existing timeline/pricing are never overridden.
 */
function mergeSectionSummary(
  state: ProposalState,
  summary: Partial<ProposalState>,
): ProposalState {
  const existingNormalized = new Set(
    state.keyPoints.map((p) => p.toLowerCase().trim()),
  );
  const newPoints = (summary.keyPoints ?? []).filter(
    (p) => !existingNormalized.has(p.toLowerCase().trim()),
  );
  return {
    keyPoints: [...state.keyPoints, ...newPoints],
    timeline: state.timeline ?? summary.timeline ?? null,   // prefer existing
    pricing:  state.pricing  ?? summary.pricing  ?? null,   // prefer existing
    tone:     state.tone     ?? summary.tone     ?? null,   // first wins
  };
}

/**
 * Call the LLM to extract a structured summary from a completed section.
 * Non-fatal — returns empty summary on any failure.
 */
async function extractSectionSummary(
  sectionName: string,
  content: string,
): Promise<Partial<ProposalState>> {
  const prompt = [
    `You just read the "${sectionName}" section of a proposal.`,
    'Extract a structured summary for use in subsequent sections to maintain coherence.',
    '',
    'Return JSON with:',
    '- keyPoints: array of 1–3 key concrete facts or claims stated in this section',
    '- timeline: the timeline value if explicitly stated, or null',
    '- pricing: the pricing/budget value if explicitly stated, or null',
    '- tone: one word describing the writing tone (e.g. "confident", "consultative"), or null',
    '',
    'Rules:',
    '- Only include values explicitly stated — do NOT infer',
    '- keyPoints must be specific facts, not vague summaries',
    '- Output ONLY raw JSON — no markdown fences, no commentary',
    '',
    `Section content:\n${content.slice(0, 2000)}`,
  ].join('\n');

  try {
    const raw = await llmGenerateFn(prompt);
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      keyPoints: Array.isArray(parsed.keyPoints)
        ? (parsed.keyPoints as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
      timeline: typeof parsed.timeline === 'string' ? parsed.timeline : null,
      pricing:  typeof parsed.pricing  === 'string' ? parsed.pricing  : null,
      tone:     typeof parsed.tone     === 'string' ? parsed.tone     : null,
    };
  } catch {
    return { keyPoints: [] };
  }
}

/**
 * When keyPoints exceeds 10 entries, ask the LLM to compress them into 3–5
 * bullets so the coherence context block stays concise (STEP 6).
 */
async function compressKeyPoints(keyPoints: string[]): Promise<string[]> {
  const prompt = [
    'The following is a list of key points from a proposal being written.',
    'Summarize them into 3–5 concise, non-redundant bullets that preserve all important facts.',
    'Output ONLY the bullet items — one per line, no leading dashes or bullets.',
    '',
    keyPoints.map((p) => `- ${p}`).join('\n'),
  ].join('\n');

  try {
    const raw = await llmGenerateFn(prompt);
    const compressed = raw
      .split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter((l) => l.length > 0)
      .slice(0, 5);
    return compressed.length > 0 ? compressed : keyPoints.slice(0, 5);
  } catch {
    return keyPoints.slice(0, 5);
  }
}

/**
 * Build a focused prompt for a single proposal section.
 * Injects coherence context from previously generated sections (STEP 4).
 */
function buildSectionPrompt(
  section: string,
  allSections: string[],
  requirements: Record<string, string>,
  outline: string,
  proposalState: ProposalState,
): string {
  const reqLines = REQUIRED_FIELDS
    .filter((f) => requirements[f])
    .map((f) => `- ${f}: ${requirements[f]}`)
    .join('\n');

  const parts = [
    `You are a professional proposal writer writing the **${section}** section.`,
    '',
    'Confirmed proposal inputs:',
    reqLines || '(none specified)',
    '',
    'Full section list for context:',
    ...allSections.map((s, i) =>
      `${i + 1}. ${s === section ? `**${s}** ← you are writing this` : s}`),
    '',
  ];

  if (outline) {
    parts.push(`Proposal outline:\n${outline}\n`, '');
  }

  // Coherence block — only injected once there are prior sections
  const hasPriorContext = proposalState.keyPoints.length > 0
    || proposalState.timeline
    || proposalState.pricing
    || proposalState.tone;

  if (hasPriorContext) {
    parts.push('Context from previous sections:');
    if (proposalState.timeline) parts.push(`- Timeline: ${proposalState.timeline}`);
    if (proposalState.pricing)  parts.push(`- Pricing:  ${proposalState.pricing}`);
    if (proposalState.tone)     parts.push(`- Tone:     ${proposalState.tone}`);
    if (proposalState.keyPoints.length > 0) {
      parts.push('- Key points already established:');
      proposalState.keyPoints.forEach((p) => parts.push(`  • ${p}`));
    }
    parts.push(
      '',
      'Coherence rules:',
      '- Do NOT contradict the timeline, pricing, or key points above',
      '- Do NOT repeat these points verbatim — reference them only if adding new value',
      '- Maintain the established tone',
      '',
    );
  }

  parts.push(
    'Writing rules:',
    '- Write this section in full — no placeholders or "[TBD]"',
    '- Be specific, actionable, and persuasive',
    '- Output ONLY the section body — the heading will be added automatically',
    '- 2–4 focused paragraphs, professional tone',
  );

  return parts.join('\n');
}

/**
 * Expand the outline into a full proposal draft, generating one section at a
 * time so the client receives progressive phase events and structured output.
 *
 * Flow:
 *   1. Resolve section list from selectedTemplate (or default).
 *   2. For each section:
 *        a. Emit phase "Writing: <section name>".
 *        b. Call LLM with a focused per-section prompt.
 *        c. Emit the formatted section content via onChunk.
 *   3. Save the assembled draft.
 *   4. Signal DONE.
 */
export async function handleGeneratingSections(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, onPhase, onChunk } = ctx;

  const selectedTemplate = instance.context.selectedTemplate as { structure?: string[] } | undefined;
  const sections = selectedTemplate?.structure ?? [
    'Executive Summary',
    'Problem Statement',
    'Proposed Solution',
    'Technical Approach',
    'Timeline & Milestones',
    'Team & Credentials',
    'Budget Estimate',
    'Next Steps',
  ];

  const requirements = (instance.context.proposalRequirements ?? {}) as Record<string, string>;
  const outline = (instance.context.outline as string | undefined) ?? '';

  // Seed proposalState from confirmed requirements so the first section
  // already has timeline and pricing locked (STEP 5 safety rule).
  let proposalState: ProposalState = {
    keyPoints: [],
    timeline: requirements.timeline ?? null,
    pricing:  requirements.budget   ?? null,
    tone:     null,
  };

  let proposalMarkdown = '';

  for (const section of sections) {
    onPhase(`Writing: ${section}`);

    const sectionPrompt = buildSectionPrompt(
      section, sections, requirements, outline, proposalState,
    );

    try {
      const content = await llmGenerateFn(sectionPrompt);
      const formatted = `## ${section}\n\n${content.trim()}\n\n`;
      onChunk(formatted);
      proposalMarkdown += formatted;

      // Extract summary from the completed section and update proposalState
      const summary = await extractSectionSummary(section, content);
      let merged = mergeSectionSummary(proposalState, summary);

      // STEP 6: Compress keyPoints when they exceed 10 entries
      if (merged.keyPoints.length > 10) {
        merged = { ...merged, keyPoints: await compressKeyPoints(merged.keyPoints) };
      }

      proposalState = merged;
    } catch {
      // Non-fatal — include a placeholder and continue with remaining sections
      const placeholder = `## ${section}\n\n_(Section generation failed — please edit manually)_\n\n`;
      onChunk(placeholder);
      proposalMarkdown += placeholder;
    }
  }

  // Persist final proposalState so it's available for inspection / future edits
  instance.context.proposalState = proposalState;

  // Persist the artifact
  const timestamp = Date.now();
  const fileName = `chat-draft-${timestamp}.md`;
  const proposalsDir = path.join(workdir, 'namespaces', namespace, 'proposals');
  await mkdir(proposalsDir, { recursive: true });
  await writeFile(path.join(proposalsDir, fileName), proposalMarkdown, 'utf-8');

  instance.context.proposalArtifactId = fileName;

  // Auto-snapshot: create initial version (v1.0) for the new proposal
  try {
    const version = await createInitialVersion(workdir, namespace, fileName, 'system');
    onPhase(`Saved as version ${version.versionLabel}`);
  } catch {
    // Non-fatal — version tracking failure should not block proposal delivery
  }

  return {
    message: proposalMarkdown,
    stateSignal: 'DONE',
    actions: {
      openProposalUrl: `/proposals/${namespace}/${fileName}`,
    },
  };
}
