/**
 * RFP Analysis Workflow — state handlers.
 *
 * Each handler maps to one workflow state and drives the RFP analysis pipeline:
 *   checking_rfp       → scan namespace; signal READY or MISSING
 *   await_rfp_upload   → prompt user to upload; hold on input
 *   extract_requirements → query vector store; build requirement matrix
 *   gap_analysis        → AgentExecutor identifies capability gaps
 *   go_no_go            → AgentExecutor produces bid recommendation
 *
 * All handlers receive dependencies via HandlerContext — same contract as
 * proposal-generation.handlers.ts so the orchestrator dispatch table is uniform.
 */

import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { toolRegistry } from '@ai-engine/core';
import type { HandlerContext, HandlerResult } from './proposal-generation.handlers.js';
import { formatConversationForContext } from '../chat/context-builder.js';
import { scanNamespace } from '../namespace/namespace-intelligence.service.js';
import {
  extractRfpRequirements,
  formatRequirementMatrix,
  type RequirementMatrix,
} from '../ingestion/extract-rfp-requirements.js';
import { llmGenerateFn } from '../agent-routes.js';
import { AgentExecutor, TOOL_TIMEOUT_MS } from '../chat/agent-executor.js';
import type { ToolDescriptor } from '../chat/agent-executor.js';
import type { ToolOutput } from '@ai-engine/core';

// ---------------------------------------------------------------------------
// Tools available to RFP analysis agents
// ---------------------------------------------------------------------------

const RFP_AGENT_TOOLS: ToolDescriptor[] = [
  {
    name: 'search-documents',
    description: 'Search indexed documents in the namespace for supporting evidence.',
    inputSchema: '{ "query": "string" }',
  },
  {
    name: 'extract-section',
    description: 'Extract a named section from markdown content.',
    inputSchema: '{ "content": "string", "query": "string" }',
  },
];

// ---------------------------------------------------------------------------
// Tool runner (mirrors proposal-generation.handlers.ts pattern)
// ---------------------------------------------------------------------------

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
    setTimeout(
      () => reject(new Error(`Tool "${toolName}" timed out after ${TOOL_TIMEOUT_MS}ms`)),
      TOOL_TIMEOUT_MS,
    ),
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
// checking_rfp
// ---------------------------------------------------------------------------

/**
 * Auto-check namespace for an RFP document.
 * Signals READY immediately if one exists; MISSING if not.
 * This is a system state — no user interaction required.
 */
export async function handleCheckingRfp(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, onPhase } = ctx;

  onPhase('Scanning RFP');

  const insights = await scanNamespace(workdir, namespace);

  if (insights.hasRfp) {
    return { message: '', stateSignal: 'READY' };
  }

  return { message: '', stateSignal: 'MISSING' };
}

// ---------------------------------------------------------------------------
// await_rfp_upload
// ---------------------------------------------------------------------------

/**
 * Pause and ask the user to upload an RFP document.
 * Once ingestion completes the resume service will re-trigger this workflow
 * by checking awaitingInput instances in `await_rfp_upload` state.
 */
export async function handleAwaitRfpUpload(ctx: HandlerContext): Promise<HandlerResult> {
  // If the namespace now has an RFP (e.g. resumed after upload), proceed.
  const insights = await scanNamespace(ctx.workdir, ctx.namespace);
  if (insights.hasRfp) {
    return { message: '', stateSignal: 'READY' };
  }

  return {
    message:
      'Please upload the RFP document to begin analysis. Once uploaded and indexed I will proceed automatically.',
  };
  // No stateSignal → orchestrator sets awaitingInput = true
}

// ---------------------------------------------------------------------------
// extract_requirements
// ---------------------------------------------------------------------------

/**
 * Query the namespace vector store and build a structured requirement matrix.
 * Stores the result in workflow context for downstream agent states.
 */
export async function handleExtractRequirements(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, onPhase, onChunk } = ctx;

  onPhase('Extracting requirements');

  const matrix = await extractRfpRequirements(workdir, namespace);

  // Store in context for gap_analysis and go_no_go handlers
  instance.context.requirementMatrix = matrix;

  onPhase('Building requirement matrix');

  const formatted = formatRequirementMatrix(matrix);

  // Stream matrix to client
  const CHUNK = 80;
  for (let i = 0; i < formatted.length; i += CHUNK) {
    onChunk(formatted.slice(i, i + CHUNK));
  }

  return {
    message: formatted,
    stateSignal: 'DONE',
  };
}

// ---------------------------------------------------------------------------
// gap_analysis
// ---------------------------------------------------------------------------

/**
 * Use the LLM (via AgentExecutor) to identify capability and input gaps.
 * The agent may call search-documents to cross-reference the requirement
 * matrix against what is already in the namespace knowledge base.
 */
export async function handleGapAnalysis(ctx: HandlerContext): Promise<HandlerResult> {
  const { namespace, instance, onPhase, onChunk, onToolEvent } = ctx;

  onPhase('Analyzing capability gaps');

  const matrix = (instance.context.requirementMatrix ?? {}) as RequirementMatrix;
  const matrixSummary = formatRequirementMatrix(matrix);

  const prompt = [
    'You are a bid strategist reviewing an RFP requirement matrix.',
    '',
    'Your task: identify capability gaps and missing inputs that would prevent a successful bid.',
    '',
    'For each gap, specify:',
    '- What is required by the RFP',
    '- What is missing from our current capabilities or submitted documents',
    '- Severity: Critical / Important / Minor',
    '',
    matrixSummary,
    '',
    'You may use the search-documents tool to check what capabilities or prior work exist in the knowledge base.',
    '',
    'Output a structured gap analysis as a markdown list. Be concise and actionable.',
  ].join('\n');

  const executor = new AgentExecutor(llmGenerateFn);
  let gapAnalysis = '';

  for await (const event of executor.runStreaming({
    prompt,
    namespace,
    tools: RFP_AGENT_TOOLS,
    systemPrompt: ctx.conversationContext?.systemPrompt,
    priorContext: ctx.conversationContext
      ? formatConversationForContext(ctx.conversationContext.conversationWindow)
      : undefined,
  })) {
    if (event.type === 'token') {
      onChunk(event.text);
      gapAnalysis += event.text;
    } else if (event.type === 'phase') {
      onPhase(event.name);
    } else if (event.type === 'tool_request') {
      onPhase(`Using tool: ${event.tool}`);
      const output = await runTool(event.tool, event.input, namespace, onToolEvent);
      executor.resumeWithToolResult(output);
    } else if (event.type === 'final') {
      if (!gapAnalysis) gapAnalysis = event.result.text;
    }
  }

  instance.context.gapAnalysis = gapAnalysis;

  return {
    message: gapAnalysis,
    stateSignal: 'DONE',
  };
}

// ---------------------------------------------------------------------------
// go_no_go
// ---------------------------------------------------------------------------

/**
 * Use the LLM to produce a structured go/no-go bid recommendation.
 * Draws on both the requirement matrix and the gap analysis from prior states.
 * Persists the final analysis as a markdown artifact in the namespace.
 */
export async function handleGoNoGo(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, onPhase, onChunk, onToolEvent } = ctx;

  onPhase('Evaluating bid viability');

  const matrix = (instance.context.requirementMatrix ?? {}) as RequirementMatrix;
  const gapAnalysis = (instance.context.gapAnalysis as string | undefined) ?? '';
  const matrixSummary = formatRequirementMatrix(matrix);

  const prompt = [
    'You are a senior bid strategist. Based on the requirement matrix and gap analysis below,',
    'produce a clear go/no-go recommendation for whether we should pursue this RFP.',
    '',
    'Your response must include:',
    '1. **Recommendation**: Go / No-Go / Conditional Go (with conditions)',
    '2. **Confidence**: High / Medium / Low',
    '3. **Key strengths** that support bidding',
    '4. **Critical risks** that could prevent a win',
    '5. **Immediate actions** required before submitting',
    '',
    matrixSummary,
    '',
    '## Gap Analysis',
    gapAnalysis || '(no gaps identified)',
    '',
    'Write a clear, executive-level recommendation. Format as structured markdown.',
  ].join('\n');

  const executor = new AgentExecutor(llmGenerateFn);
  let recommendation = '';

  for await (const event of executor.runStreaming({
    prompt,
    namespace,
    tools: RFP_AGENT_TOOLS,
    systemPrompt: ctx.conversationContext?.systemPrompt,
    priorContext: ctx.conversationContext
      ? formatConversationForContext(ctx.conversationContext.conversationWindow)
      : undefined,
  })) {
    if (event.type === 'token') {
      onChunk(event.text);
      recommendation += event.text;
    } else if (event.type === 'phase') {
      onPhase(event.name);
    } else if (event.type === 'tool_request') {
      onPhase(`Using tool: ${event.tool}`);
      const output = await runTool(event.tool, event.input, namespace, onToolEvent);
      executor.resumeWithToolResult(output);
    } else if (event.type === 'final') {
      if (!recommendation) recommendation = event.result.text;
    }
  }

  instance.context.goNoGoRecommendation = recommendation;

  // Persist the full analysis artifact
  const timestamp = Date.now();
  const fileName = `rfp-analysis-${timestamp}.md`;
  const analysisDir = path.join(workdir, 'namespaces', namespace, 'analysis');
  await mkdir(analysisDir, { recursive: true });

  const artifact = [
    '# RFP Analysis Report',
    '',
    matrixSummary,
    '',
    '## Gap Analysis',
    '',
    gapAnalysis || '_No gaps identified._',
    '',
    '## Go / No-Go Recommendation',
    '',
    recommendation,
  ].join('\n');

  await writeFile(path.join(analysisDir, fileName), artifact, 'utf-8');

  instance.context.rfpAnalysisArtifactId = fileName;

  return {
    message: recommendation,
    stateSignal: 'DONE',
    actions: {
      generateProposalUrl: '/chat',
      viewAnalysisUrl: `/analysis/${namespace}/${fileName}`,
    },
  };
}
