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
 * Expand the outline into a full proposal draft and persist the artifact.
 *
 * Uses AgentExecutor so the LLM can call search-documents to pull in
 * supporting evidence, benchmarks, or existing proposal language while
 * writing each section.
 *
 * Flow:
 *   1. Emit phase "Writing proposal draft".
 *   2. Run AgentExecutor tool-request loop:
 *        - LLM may call tools to enrich individual sections
 *        - Token chunks forwarded to onChunk
 *        - Tool events forwarded to onToolEvent
 *   3. Save draft as {namespace}/proposals/chat-draft-{timestamp}.md.
 *   4. Set context.proposalArtifactId to the saved file name.
 *   5. Signal DONE.
 */
export async function handleGeneratingSections(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, onPhase, onChunk, onToolEvent } = ctx;

  onPhase('Writing proposal draft');

  const prompt = [
    'You are a professional proposal writer. Using the outline below, write a complete, detailed proposal document.',
    '',
    'Requirements:',
    '- Write every section in full — no placeholders or "[TBD]"',
    '- Use clear, professional language',
    '- Format as clean markdown with headings',
    '- Be specific, actionable, and persuasive',
    '',
    `Outline:\n${(instance.context.outline as string | undefined) ?? '(no outline provided)'}`,
    '',
    'You may use the search-documents tool to find supporting evidence, metrics, or prior work in the knowledge base.',
  ].join('\n');

  const executor = new AgentExecutor(llmGenerateFn);
  let proposalMarkdown = '';

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
      proposalMarkdown += event.text;
    } else if (event.type === 'phase') {
      onPhase(event.name);
    } else if (event.type === 'tool_request') {
      onPhase(`Using tool: ${event.tool}`);
      const toolOutput = await runTool(event.tool, event.input, namespace, onToolEvent);
      executor.resumeWithToolResult(toolOutput);
    } else if (event.type === 'final') {
      if (!proposalMarkdown) proposalMarkdown = event.result.text;
      if (event.result.maxIterationsReached) {
        onPhase('Tool iteration limit reached — proceeding with available information.');
      }
    }
  }

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
