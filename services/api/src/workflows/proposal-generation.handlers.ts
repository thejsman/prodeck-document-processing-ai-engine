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
import { loadFilesIndex } from '../ingestion/ingestion-service.js';
import { llmGenerateFn } from '../agent-routes.js';
import { AgentExecutor, TOOL_TIMEOUT_MS } from '../chat/agent-executor.js';
import type { ToolDescriptor } from '../chat/agent-executor.js';

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
  const { workdir, namespace, instance } = ctx;

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

  // Use the most recently uploaded file as the RFP source
  const rfpFile = available[0];
  instance.context.rfpUri = `uploads/${rfpFile.fileName}`;

  return {
    message: `Found RFP document: "${rfpFile.fileName}". Proceeding to generate the proposal outline.`,
    stateSignal: 'READY',
  };
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

  const prompt = [
    'You are a professional proposal writer. Create a concise, structured proposal outline based on the RFP below.',
    '',
    'The outline must include these sections:',
    '1. Executive Summary',
    '2. Problem Statement',
    '3. Proposed Solution',
    '4. Technical Approach',
    '5. Timeline & Milestones',
    '6. Team & Credentials',
    '7. Budget Estimate',
    '8. Next Steps',
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

  return {
    message: proposalMarkdown,
    stateSignal: 'DONE',
    actions: {
      openProposalUrl: `/proposals/${namespace}/${fileName}`,
    },
  };
}
