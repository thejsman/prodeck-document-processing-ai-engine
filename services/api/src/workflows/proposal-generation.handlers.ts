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
import { extractRequirementsFromKnowledge } from '../ingestion/extract-proposal-inputs.js';
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
 * Collect proposal requirements through a fully LLM-driven conversation.
 *
 * The LLM receives the conversation history and current requirements state
 * and decides how to respond — extracting values, answering questions,
 * applying corrections — returning structured JSON with updates and a reply.
 * No regex, no keyword lists, no sticky state machines.
 */
export async function handleCollectingInputs(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, incomingMessage, conversationContext } = ctx;

  // ── Run RFP extraction once as seed context ───────────────────
  if (!instance.context.rfpExtractionDone) {
    try {
      instance.context.rfpExtractedRequirements = await extractRequirementsFromKnowledge(workdir, namespace);
    } catch {
      instance.context.rfpExtractedRequirements = {};
    }
    instance.context.rfpExtractionDone = true;
  }

  if (!instance.context.proposalRequirements) instance.context.proposalRequirements = {};
  const requirements = instance.context.proposalRequirements as Record<string, string>;

  // ── Already complete — skip LLM call ─────────────────────────
  if (isReadyForGeneration(instance.context)) {
    return {
      message: "Great — I have everything I need. I'll now recommend a template for your proposal.",
      stateSignal: 'READY',
    };
  }

  // ── Format conversation history (include current message) ────
  const historyLines = (conversationContext?.conversationWindow ?? [])
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`);
  historyLines.push(`User: ${incomingMessage}`);
  const history = historyLines.join('\n');

  const currentValues = Object.entries(requirements)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n') || '  (none yet)';

  // RFP hints are NOT given to the LLM — they are applied separately below
  // with explicit user-visible confirmation. Giving them to the LLM caused it
  // to silently set READY:true after only one user message.
  const prompt = [
    'You are collecting proposal requirements through a natural conversation.',
    'Required fields: industry, timeline, budget.',
    '',
    'Currently collected:',
    currentValues,
    '',
    'Conversation so far (most recent message is last):',
    history,
    '',
    'Instructions:',
    '- Respond to the LAST user message only.',
    '- Extract values the user explicitly stated in THIS message.',
    '- If correcting a previously given value, use the correction.',
    '- If asking a question or for examples, answer helpfully then re-ask the same field.',
    '- Ask for one missing field at a time. Be natural and conversational.',
    '- Do NOT infer or assume values not stated by the user.',
    '',
    'Reply in EXACTLY this two-line format, nothing else:',
    'UPDATES: {"industry":"Software","budget":"$50,000"}  ← example only; use actual field names: industry, timeline, budget',
    'RESPONSE: your conversational reply to the user',
    '',
    'Use {} for UPDATES if the user provided no new field values.',
    'Set a field in UPDATES only if the user said it explicitly in this message.',
    'READY: true  (add this third line ONLY when industry, timeline, AND budget are all in "Currently collected")',
  ].filter(Boolean).join('\n');

  const raw = await llmGenerateFn(prompt);

  // ── Parse the two-part response ───────────────────────────────
  const updatesMatch = raw.match(/UPDATES:\s*(\{[^}]*\})/);
  const responseMatch = raw.match(/RESPONSE:\s*([\s\S]+?)(?:\nREADY:|$)/);
  const readyMatch = /READY:\s*true/i.test(raw);

  // ── Apply explicit user-provided updates ──────────────────────
  // Only accept keys that are known required fields — prevents LLM from
  // storing placeholder names like "field_name" or "extracted_value" when
  // it misreads the format example.
  const VALID_KEYS = new Set([...REQUIRED_FIELDS]);
  if (updatesMatch) {
    try {
      const updates = JSON.parse(updatesMatch[1]) as Record<string, string>;
      for (const [k, v] of Object.entries(updates)) {
        if (v && typeof v === 'string' && VALID_KEYS.has(k as (typeof REQUIRED_FIELDS)[number])) {
          requirements[k] = v;
        }
      }
      instance.context.proposalRequirements = requirements;
    } catch {
      // Ignore malformed updates
    }
  }

  // ── Strip any stale garbage keys (e.g. from prior bad LLM responses) ──
  for (const k of Object.keys(requirements)) {
    if (!VALID_KEYS.has(k as (typeof REQUIRED_FIELDS)[number])) {
      delete requirements[k];
    }
  }
  instance.context.proposalRequirements = requirements;

  // ── Auto-fill remaining fields from high-confidence RFP extraction ──
  // Only fills fields the user hasn't provided yet, and only with ≥0.85 confidence.
  // This runs AFTER user input is applied so user corrections always win.
  const rfpRaw = (instance.context.rfpExtractedRequirements ?? {}) as Record<string, { value: string; confidence: number }>;
  const autoFilled: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (requirements[field]) continue; // already have it
    const rfpEntry = rfpRaw[field];
    if (rfpEntry?.value && (rfpEntry.confidence ?? 0) >= 0.85) {
      requirements[field] = rfpEntry.value;
      autoFilled.push(`**${field}**: ${rfpEntry.value}`);
    }
  }
  if (autoFilled.length > 0) {
    instance.context.proposalRequirements = requirements;
  }

  // ── Ready check ───────────────────────────────────────────────
  // Only trust READY:true from LLM if requirements are actually complete.
  if (isReadyForGeneration(instance.context)) {
    const autoNote = autoFilled.length > 0
      ? `I found these from your RFP documents:\n${autoFilled.map((l) => `• ${l}`).join('\n')}\n\n`
      : '';
    const llmReply = responseMatch?.[1]?.trim();
    const reply = autoNote + (llmReply && !readyMatch ? llmReply + '\n\n' : '') +
      "I have everything I need. I'll now recommend a template for your proposal.";
    return { message: reply, stateSignal: 'READY' };
  }

  // ── Return the conversational reply ──────────────────────────
  if (responseMatch?.[1]?.trim()) {
    return { message: responseMatch[1].trim() };
  }

  const missing = REQUIRED_FIELDS.filter((f) => !requirements[f]);
  return { message: `What is the ${missing[0]} for this proposal?` };
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
      // User confirmed template — move to final confirmation step
      instance.context.awaitingTemplateConfirmation = undefined;
      return { message: 'Template confirmed.', stateSignal: 'DONE' };
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

  // Store as a synthetic template in context, named after the namespace
  const nsTemplateSlug = namespace.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  instance.context.selectedTemplate = {
    id: nsTemplateSlug,
    name: namespace,
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
    `I've generated a proposal structure for **${namespace}**:`,
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
// confirm_generation handler
// ---------------------------------------------------------------------------

/**
 * Pause before generation begins and ask the user for explicit confirmation.
 *
 * Shows a summary of everything collected so far (requirements, template,
 * detected context) so the user can verify before any LLM or plugin work runs.
 *
 * Flow:
 *   1. On first entry: build summary, set awaitingGenerationConfirm = true, wait.
 *   2. On user reply:
 *        - yes / confirm / proceed → signal CONFIRM → generating_outline
 *        - no / cancel / stop      → signal DECLINE → collecting_inputs
 */
export async function handleConfirmGeneration(ctx: HandlerContext): Promise<HandlerResult> {
  const { instance, incomingMessage, onChunk } = ctx;

  // ── Second entry: user is responding to the confirmation prompt ──────────
  if (instance.context.awaitingGenerationConfirm) {
    instance.context.awaitingGenerationConfirm = undefined;

    const lower = incomingMessage.toLowerCase().trim();
    const isDecline =
      lower.startsWith('no') ||
      lower.includes('cancel') ||
      lower.includes('stop') ||
      lower.includes('wait') ||
      lower.includes('change');

    if (isDecline) {
      return {
        message: "No problem — let me know what you'd like to adjust.",
        stateSignal: 'DECLINE',
      };
    }

    return {
      message: "Great — starting proposal generation now.",
      stateSignal: 'CONFIRM',
    };
  }

  // ── First entry: build summary and ask for confirmation ──────────────────
  const reqs = getEffectiveRequirements(instance.context);
  const template = instance.context.selectedTemplate as
    | { name?: string; structure?: string[] }
    | undefined;

  const lines: string[] = [
    "I have everything I need to generate your proposal. Here's a summary of what I'll use:",
    '',
  ];

  if (reqs.client)   lines.push(`• **Client:** ${reqs.client}`);
  if (reqs.industry) lines.push(`• **Industry:** ${reqs.industry}`);
  if (reqs.timeline) lines.push(`• **Timeline:** ${reqs.timeline}`);
  if (reqs.budget)   lines.push(`• **Budget:** ${reqs.budget}`);

  if (template?.name) {
    lines.push(`• **Template:** ${template.name}`);
  }
  if (template?.structure && template.structure.length > 0) {
    lines.push('• **Sections:**');
    template.structure.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  }

  lines.push('');
  lines.push('Reply **yes** to generate the proposal, or **no** to make changes.');

  const message = lines.join('\n');
  onChunk(message);

  instance.context.awaitingGenerationConfirm = true;

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

  onPhase('Planning proposal structure');

  // Read RFP document content
  let rfpContent = '';
  if (instance.context.rfpUri) {
    const rfpPath = path.join(workdir, 'namespaces', namespace, instance.context.rfpUri as string);
    rfpContent = await readFile(rfpPath, 'utf-8').catch(() => '');
  }

  onPhase('Building section outline (step 1 of 2)');

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
  const outputFile = (meta.output_path ?? meta.output_file) as string | undefined;
  if (!outputFile) throw new Error('Proposal not saved — plugin returned no output_path');

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
// Proposal ready message builder
// ---------------------------------------------------------------------------

function buildProposalReadyMessage(
  instance: WorkflowInstance,
  namespace: string,
  artifactId: string,
): string {
  const template = instance.context.selectedTemplate as { structure?: string[] } | undefined;
  const sections = template?.structure ?? [];

  const parts = [
    `Your proposal **${artifactId}** is ready for **${namespace}**.`,
  ];

  if (sections.length > 0) {
    parts.push('', '**Sections generated:**');
    parts.push(...sections.map((s, i) => `${i + 1}. ${s}`));
  }

  parts.push(
    '',
    'You can ask me to improve any section — for example:',
    '- "Make the Executive Summary more compelling"',
    '- "Add more detail to the pricing section"',
    '- "Rewrite the technical approach to emphasise our cloud experience"',
  );

  return parts.join('\n');
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

  // ── Guard: no proposal was actually generated ─────────────────
  // If the generation step failed or was skipped, artifactId will be absent.
  // Do not claim "looks consistent" — that message only makes sense after a
  // real proposal has been saved.
  if (!artifactId) {
    return {
      message: 'No proposal was generated yet.',
      stateSignal: 'DONE',
    };
  }

  // ── No contradictions → proceed immediately ───────────────────
  if (contradictions.length === 0) {
    return {
      message: buildProposalReadyMessage(instance, namespace, artifactId),
      stateSignal: 'DONE',
      actions: { openProposalUrl: `/proposals/${namespace}/${artifactId}` },
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
        message: `I've aligned the inconsistent values across all sections.\n\n${buildProposalReadyMessage(instance, namespace, artifactId)}`,
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

  // User declined fixes
  return {
    message: buildProposalReadyMessage(instance, namespace, artifactId),
    stateSignal: 'DONE',
    actions: artifactId ? { openProposalUrl: `/proposals/${namespace}/${artifactId}` } : {},
  };
}
