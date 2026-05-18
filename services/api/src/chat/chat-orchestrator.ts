/**
 * Chat Orchestrator — executes chat-driven workflow instances.
 *
 * Responsibilities:
 *   1. Detect workflow intent from incoming messages (via intent router).
 *   2. Load or create a WorkflowInstance for the chat session.
 *   3. Run the execution loop: dispatch to state handlers, apply transitions,
 *      auto-advance through agent/tool states, pause on input states.
 *   4. Stream phase labels and content chunks to the caller via callbacks.
 *   5. Checkpoint state + context after every transition (STEP 8).
 *   6. Emit the final "done" message and action metadata when completed.
 *
 * The orchestrator is workflow-agnostic: it reads the WorkflowDefinition DSL
 * to determine which states are auto-advancing (agent/tool) vs. pause points
 * (input).  Adding a new workflow requires only a new definition + handlers.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { ProviderPolicyConfig } from '../provider-policy.js';
import { searchKnowledgeChunks } from '@ai-engine/runtime';
import { logTrace } from '../trace/trace-store.js';
import { routeIntent, isResetIntent, classifyIntentWithLLM, isDefinitelyNotWorkflow } from './intent-router.js';
import { scanNamespace } from '../namespace/namespace-intelligence.service.js';
import { deriveInsightSuggestions } from '../namespace/insight-rules.js';
import {
  buildLLMContext,
  classifyMessageIntent,
  buildInterruptContext,
} from './context-builder.js';
import { appendChatTurn, loadHistory } from './chat-history.service.js';
import { llmGenerateFn, withLlmTemperature } from '../agent-routes.js';
import { ProposalWorkflow } from '../workflows/proposal-generation.workflow.js';
import type { WorkflowDefinition } from '../workflows/proposal-generation.workflow.js';
import { RfpAnalysisWorkflow } from '../workflows/rfp-analysis.workflow.js';
import { ProposalVersionControlWorkflow } from '../workflows/proposal-version-control.workflow.js';
import { TemplateCreationWorkflow } from '../workflows/template-creation.workflow.js';
import { ComplianceRedlineWorkflow } from '../workflows/compliance-redline.workflow.js';
import { MicrositeGenerationWorkflow } from '../workflows/microsite-generation.workflow.js';
import {
  handleAnalyzing as handleComplianceAnalyzing,
  handleReviewing as handleComplianceReviewing,
  handleApplyingFix as handleComplianceApplyingFix,
} from '../workflows/compliance-redline.handlers.js';
import {
  createInstance,
  loadActiveInstance,
  updateState,
  updateContext,
  markCompleted,
  setAwaitingInput,
  type WorkflowInstance,
} from '../workflows/workflow-instance.service.js';
import { handleCheckingProposal, handleCollectingDesignInputs, handleGeneratingMicrosite } from '../workflows/microsite-generation.handlers.js';
import { emitChatSessionEvent } from './chat-session-bus.js';
import {
  handleCollectingRfp,
  handleCollectingInputs,
  handleRecommendTemplate,
  handleConfirmGeneration,
  handleGeneratingOutline,
  handleGeneratingSections,
  handleQaReview,
  type HandlerResult,
  type HandlerContext,
  type ToolTraceEvent,
} from '../workflows/proposal-generation.handlers.js';
import {
  handleCheckingRfp,
  handleAwaitRfpUpload,
  handleExtractRequirements,
  handleGapAnalysis,
  handleGoNoGo,
} from '../workflows/rfp-analysis.handlers.js';
import { handleResolveAction } from '../workflows/proposal-version-control.handlers.js';
import {
  handleAnalyzingRfp,
  handleReviewTemplate,
  handleGeneratingTemplate,
  handleNameTemplate,
  handleSavingTemplate,
} from '../workflows/template-creation.handlers.js';

// ---------------------------------------------------------------------------
// Workflow registry — extend here to support additional workflows
// ---------------------------------------------------------------------------

const WORKFLOW_REGISTRY: Record<string, WorkflowDefinition> = {
  [ProposalWorkflow.id]: ProposalWorkflow,
  [RfpAnalysisWorkflow.id]: RfpAnalysisWorkflow,
  [ProposalVersionControlWorkflow.id]: ProposalVersionControlWorkflow,
  [TemplateCreationWorkflow.id]: TemplateCreationWorkflow,
  [ComplianceRedlineWorkflow.id]: ComplianceRedlineWorkflow,
  [MicrositeGenerationWorkflow.id]: MicrositeGenerationWorkflow,
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ProcessMessageParams {
  message: string;
  namespace: string;
  chatSessionId: string;
  /** Called when a named execution phase begins (e.g. "Analyzing RFP"). */
  onPhase?: (phase: string) => void;
  /** Called with each streamed token chunk. */
  onChunk?: (chunk: string) => void;
  /**
   * Called once per generated proposal section with structured data.
   * When provided, the section generation handler emits structured blocks
   * instead of raw markdown chunks so the frontend can render editable blocks.
   */
  onSection?: (section: string, content: string, artifactId: string) => void;
}

export interface OrchestratorResult {
  /** Final chat message to display to the user. */
  message: string;
  /** Optional action links included in the completion payload (STEP 7). */
  actions?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Handler dispatch table — add new workflow handlers here
// ---------------------------------------------------------------------------

type HandlerFn = (ctx: HandlerContext) => Promise<HandlerResult>;

const STATE_HANDLERS: Record<string, HandlerFn> = {
  // proposal_generation
  collecting_rfp: handleCollectingRfp,
  collecting_inputs: handleCollectingInputs,
  recommend_template: handleRecommendTemplate,
  confirm_generation: handleConfirmGeneration,
  generating_outline: handleGeneratingOutline,
  generating_sections: handleGeneratingSections,
  qa_review: handleQaReview,
  // proposal_version_control
  resolve_action: handleResolveAction,
  // rfp_analysis
  checking_rfp: handleCheckingRfp,
  await_rfp_upload: handleAwaitRfpUpload,
  extract_requirements: handleExtractRequirements,
  gap_analysis: handleGapAnalysis,
  go_no_go: handleGoNoGo,
  // compliance_redline
  analyzing: handleComplianceAnalyzing,
  reviewing: handleComplianceReviewing,
  applying_fix: handleComplianceApplyingFix,
  // template_creation
  analyzing_rfp: handleAnalyzingRfp,
  review_template: handleReviewTemplate,
  generating_template: handleGeneratingTemplate,
  name_template: handleNameTemplate,
  saving_template: handleSavingTemplate,
  // microsite_generation
  checking_proposal: handleCheckingProposal,
  collecting_design_inputs: handleCollectingDesignInputs,
  generating_microsite: handleGeneratingMicrosite,
};

// ---------------------------------------------------------------------------
// Knowledge-grounded answer helper
// ---------------------------------------------------------------------------

/**
 * Retrieve document chunks from the knowledge base and synthesize an answer
 * using the LLM.  Uses broad topic queries so requests like "Summarize the
 * knowledge base" pull from many documents, not just chunks similar to those
 * exact words.
 */
async function answerFromKnowledge(
  workdir: string,
  namespace: string,
  message: string,
  generateFn: (prompt: string) => Promise<string>,
  extraContext?: string,
): Promise<string> {
  const storageDir = path.join(workdir, 'namespaces', namespace);
  const lower = message.toLowerCase();

  // System capabilities block — reused across multiple early-exit answers.
  const SYSTEM_CAPABILITIES = [
    'This is an AI-powered proposal management system. You interact with it via chat.',
    '',
    '**Available actions (just type these):**',
    '- **"Generate a proposal for [client]"** — Starts the proposal generation workflow. The system checks for an uploaded RFP, collects any extra requirements from you, recommends a template, asks for confirmation, then auto-generates all proposal sections.',
    '- **"Analyse this RFP"** or **"Should we bid?"** — Runs an RFP analysis and gives a go/no-go recommendation.',
    '- **"Convert proposal to microsite"** — Turns a generated proposal into a shareable presentation site.',
    '- **"Create a proposal template"** — Builds a reusable template from the RFP.',
    '- **"Check proposal for compliance issues"** — Legal/regulatory review of a proposal.',
    '- **"Update the [section name]"** — Edits a specific section of an existing proposal.',
    '- Ask any question about your uploaded documents.',
    '',
    '**To generate a proposal:**',
    '1. Upload your RFP and any supporting documents via the Knowledge tab.',
    '2. Select of gererate a proposal template if prompted — this helps the system structure the proposal correctly.',
    '3. Come back to chat and say: **"Generate a proposal for [client name]"**',
    '3. The system will guide you through the rest automatically.',
  ].join('\n');

  // "How do I use this?" / "How to generate a proposal?" — answer from system
  // context only, do not let RAG document chunks pollute the answer.
  const isSystemUsageQuery =
    /\b(how to|how do i|how can i|how does|what('s| is) needed|what do i need|what are the steps|what is the process|how to use|how do i use|what do i need to|needed to generate|needed to create|needed to start)\b/.test(
      lower,
    ) && /\b(proposal|generat|creat|start|use|work|this system|the system)\b/.test(lower);

  if (isSystemUsageQuery) {
    return generateFn(
      [
        'You are an assistant for a proposal management system. The user is asking how to use the system.',
        '',
        '## System Guide',
        SYSTEM_CAPABILITIES,
        '',
        '## User Question',
        message,
        '',
        'Answer based on the System Guide above. Do NOT reference any RFP document submission requirements — the user is asking about the software system, not about what to write in a proposal.',
      ].join('\n'),
    );
  }

  // "What documents are indexed?" / "What files are uploaded?" — answer from
  // files.json, not from the vector store (FAISS doesn't surface filenames).
  const isFileListQuery =
    /\b(what|which|list|show)\b/.test(lower) &&
    /\b(documents?|files?|uploaded|indexed|ingested|available)\b/.test(lower);

  if (isFileListQuery) {
    try {
      const filesIndexPath = path.join(workdir, 'namespaces', namespace, 'files.json');
      const raw = await readFile(filesIndexPath, 'utf-8');
      const files = JSON.parse(raw) as Array<{ fileName: string; status: string; uploadedAt?: string }>;
      if (files.length === 0) {
        return 'No files have been uploaded to this namespace yet.';
      }
      const indexed = files.filter((f) => f.status === 'indexed' || f.status === 'extracting' || f.status === 'extracted');
      const lines = files.map(
        (f) => `- **${f.fileName}** (${f.status}${f.uploadedAt ? `, uploaded ${f.uploadedAt.slice(0, 10)}` : ''})`,
      );
      return [
        `There are **${files.length} file(s)** in this namespace (${indexed.length} indexed):`,
        '',
        ...lines,
      ].join('\n');
    } catch {
      // files.json not found — fall through to vector search
    }
  }

  // For broad summarise/overview requests, query multiple topics to get
  // a representative cross-section of the documents.
  const isBroadSummary =
    /\b(summar(ise|ize)|overview|what('s| is) in|tell me about|describe)\b/.test(lower) &&
    /\b(knowledge\s*base|documents?|files?|content|data)\b/.test(lower);

  let allChunks: string[];

  if (isBroadSummary) {
    const broadQueries = [
      'main topics and key themes',
      'important dates timelines milestones',
      'requirements budget cost',
      'people organisations stakeholders',
      'decisions actions next steps',
    ];
    const results = await Promise.allSettled(
      broadQueries.map((q) => searchKnowledgeChunks({ question: q, storageDir, namespace, topK: 4 })),
    );
    const seen = new Set<string>();
    allChunks = results
      .flatMap((r) => (r.status === 'fulfilled' ? r.value.chunks : []))
      .filter((c) => {
        if (seen.has(c.text)) return false;
        seen.add(c.text);
        return true;
      })
      .map((c) => c.text);
  } else {
    // Specific question — single retrieval is fine
    const result = await searchKnowledgeChunks({ question: message, storageDir, namespace, topK: 8 });
    allChunks = result.chunks.map((c) => c.text);
  }

  if (allChunks.length === 0) {
    return 'No documents have been ingested into this namespace yet. Upload some files first, then I can answer questions about them.';
  }

  const context = allChunks.map((t, i) => `[${i + 1}] ${t}`).join('\n\n');
  const prompt = [
    "You are an AI assistant. Answer the user's question using ONLY the document excerpts provided below.",
    'Do NOT use general knowledge, make assumptions, or introduce information not present in the excerpts.',
    'If the excerpts do not contain enough information to answer, respond with: "I could not find that information in the uploaded documents."',
    ...(extraContext ? ['', '## Current Session Context', extraContext] : []),
    '',
    '## Document Excerpts',
    context,
    '',
    '## User Question',
    message,
    '',
    'Answer based solely on the document excerpts above.',
  ].join('\n');

  return generateFn(prompt);
}

// ---------------------------------------------------------------------------
// ChatOrchestrator
// ---------------------------------------------------------------------------

export class ChatOrchestrator {
  constructor(
    private readonly workdir: string,
    // Reserved for future policy-aware agent execution
    private readonly _policyConfig: ProviderPolicyConfig | null,
  ) {}

  /**
   * Process one chat message.
   *
   * Execution loop:
   *   while state has a registered handler:
   *     1. Execute handler → HandlerResult
   *     2. Checkpoint context (STEP 8)
   *     3. If stateSignal → resolve next state from transitions
   *     4. Checkpoint state transition (STEP 8)
   *     5. If next state kind is "input" → pause (return to caller)
   *     6. If next state kind is "agent" | "tool" → continue loop
   *     7. If "completed" → mark instance complete, emit final message (STEP 7)
   */
  async processMessage(params: ProcessMessageParams): Promise<OrchestratorResult> {
    const temperature = await this._readNamespaceTemperature(params.namespace);
    return withLlmTemperature(temperature, () => this._processMessageInner(params));
  }

  private async _readNamespaceTemperature(namespace: string): Promise<number | undefined> {
    try {
      const configFile = path.join(this.workdir, 'config', 'namespaces', `${namespace}.json`);
      const raw = await readFile(configFile, 'utf-8');
      const cfg = JSON.parse(raw) as { temperature?: unknown };
      const t = cfg.temperature;
      if (typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= 2) return t;
    } catch {
      // Config file absent or unreadable — use provider default
    }
    return undefined;
  }

  private async _processMessageInner(params: ProcessMessageParams): Promise<OrchestratorResult> {
    const { message, namespace, chatSessionId, onPhase = () => {}, onChunk = () => {}, onSection } = params;

    // ── Load or create workflow instance ─────────────────────────
    let instance = await loadActiveInstance(this.workdir, namespace, chatSessionId);

    // ── Reset intent: "start over", "reset", "new session" ───────
    // Clear the active instance so the user can start a fresh workflow.
    if (instance && isResetIntent(message)) {
      await markCompleted(this.workdir, instance);
      instance = null;
      // Try to route an underlying intent from the same message (e.g. "start over
      // and create a new proposal for fintech") — fall through to intent routing.
    }

    if (!instance) {
      // Skip all workflow routing for messages that are clearly not workflow triggers
      // (e.g. "give me JS code for X") — prevents history bias from misclassifying them.
      const skipWorkflow = isDefinitelyNotWorkflow(message);
      let intent = skipWorkflow ? null : routeIntent(message);

      // Second pass: LLM-based classification when rule-based matching fails
      if (!intent && !skipWorkflow) {
        const history = await loadHistory(this.workdir, namespace, chatSessionId);
        const recentMessages = (history?.messages ?? [])
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .slice(-6);
        const conversationWindow = recentMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
        intent = await classifyIntentWithLLM(message, conversationWindow, llmGenerateFn);
      }

      if (!intent) {
        // No workflow intent — retrieve document chunks and synthesize an answer.
        // Using searchKnowledgeChunks + llmGenerateFn instead of queryKnowledgeBase
        // so broad requests like "Summarize the knowledge base" get context from
        // many documents rather than chunks most similar to the literal phrase.
        try {
          const answer = await answerFromKnowledge(this.workdir, namespace, message, llmGenerateFn);
          void appendChatTurn(this.workdir, namespace, chatSessionId, message, answer);
          return { message: answer };
        } catch {
          return {
            message: [
              "Here's what I can help you with:",
              '',
              '- **Create a proposal** — "Create a proposal for [client]"',
              '- **Analyse an RFP** — "Analyse this RFP" or "Should we bid?"',
              '- **Generate a microsite** — "Convert proposal to microsite"',
              '- **Create a template** — "Create a proposal template"',
              '- **Compliance check** — "Check proposal for compliance issues"',
              '- **Edit a section** — "Update the timeline section"',
              '- **Ask about your documents** — any question about uploaded files',
              '',
              'What would you like to do?',
            ].join('\n'),
          };
        }
      }

      const workflow = WORKFLOW_REGISTRY[intent.workflowId];
      if (!workflow) {
        return { message: `Unknown workflow: "${intent.workflowId}". Please try again.` };
      }

      instance = await createInstance(this.workdir, namespace, chatSessionId, workflow.id, workflow.initialState);
    }

    const workflow = WORKFLOW_REGISTRY[instance.workflowId];
    if (!workflow) {
      return { message: `Workflow "${instance.workflowId}" is no longer registered.` };
    }

    // ── Build full LLM context ────────────────────────────────────
    // Use proposalRequirements (the merged flat map) for the status block.
    // This is kept in sync by handleCollectingInputs after every merge pass.
    if (!instance.context.proposalRequirements) {
      instance.context.proposalRequirements = {};
    }
    const conversationContext = await buildLLMContext(
      this.workdir,
      namespace,
      chatSessionId,
      instance.state,
      instance.context.proposalRequirements as Record<string, string>,
      llmGenerateFn,
    );

    // ── STEP 9 — Interrupt handling ───────────────────────────────
    // If the user asks a knowledge question while in an input-kind state,
    // answer directly without advancing the workflow state machine.
    //
    // Do NOT interrupt agent/tool states — those are auto-advancing and the
    // user can't be mid-turn in them anyway. Only interrupt input states where
    // the workflow is paused waiting for a user reply.
    const currentStateDef = workflow.states[instance.state];
    const isInputState = currentStateDef?.kind === 'input';

    const intentResult = await classifyMessageIntent(message, llmGenerateFn);
    if (isInputState && intentResult.intent === 'QUESTION') {
      try {
        // Build enriched context: recent conversation + current workflow state +
        // relevant artifacts (template info, proposal, requirements).
        // This lets the LLM answer questions like "is there a matching template?"
        // using what was just shown, rather than searching documents blindly.
        const interruptContext = buildInterruptContext(
          instance.state,
          conversationContext,
          instance.context as Record<string, unknown>,
        );
        const answer = await answerFromKnowledge(this.workdir, namespace, message, llmGenerateFn, interruptContext);
        void appendChatTurn(this.workdir, namespace, chatSessionId, message, answer);
        return { message: answer };
      } catch {
        // If knowledge base query fails, fall through to normal workflow dispatch
      }
    }

    // ── STEP 4 — Namespace intelligence scan ──────────────────────
    // Run on every turn so the client always has fresh suggestions.
    // Fire-and-forget pattern: scan failure must not block the workflow.
    scanNamespace(this.workdir, namespace)
      .then((insights) => {
        const suggestions = deriveInsightSuggestions(insights);
        if (suggestions.length > 0) {
          emitChatSessionEvent(chatSessionId, { type: 'namespace_insight', suggestions });
        }
        // STEP 5 — merge insights into workflow context so handlers can reference them
        instance.context.namespaceInsights = insights;
      })
      .catch((err) => {
        process.stderr.write(`[NamespaceIntelligence] scan failed: ${String(err)}\n`);
      });

    // ── Execution loop ────────────────────────────────────────────
    let lastResult: HandlerResult | null = null;

    for (;;) {
      const currentState = instance.state;

      if (currentState === 'completed') {
        // Already terminal from a prior turn — do not re-execute
        return {
          message: 'This proposal workflow is already complete. Start a new chat session to create another.',
        };
      }

      const handler = STATE_HANDLERS[currentState];
      if (!handler) {
        return { message: `No handler registered for workflow state: "${currentState}".` };
      }

      // Emit tool trace events via chatSessionBus so SSE clients receive them (STEP 5).
      const onToolEvent = (event: ToolTraceEvent) => {
        emitChatSessionEvent(chatSessionId, {
          type: 'tool_progress',
          toolProgress: {
            status:
              event.type === 'tool_started' ? 'started' : event.type === 'tool_completed' ? 'completed' : 'failed',
            tool: event.tool,
            input: event.input,
            output: event.output,
            error: event.error,
          },
        });
        // TRACE — tool calls and results
        if (event.type === 'tool_started') {
          logTrace(chatSessionId, { type: 'tool', name: event.tool, data: event.input });
        } else if (event.type === 'tool_completed') {
          logTrace(chatSessionId, { type: 'tool', name: `${event.tool}_result`, data: event.output });
        } else if (event.type === 'tool_failed') {
          logTrace(chatSessionId, { type: 'error', name: `${event.tool}_failed`, data: event.error });
        }
      };

      const ctx: HandlerContext = {
        workdir: this.workdir,
        namespace,
        instance,
        incomingMessage: message,
        onPhase,
        onChunk,
        onSection,
        onToolEvent,
        conversationContext,
      };

      let result: HandlerResult;
      try {
        result = await handler(ctx);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logTrace(chatSessionId, { type: 'error', name: msg });
        throw err;
      }
      lastResult = result;

      // TRACE — artifact creation (handler advertises the saved proposal URL)
      if (result.actions?.openProposalUrl) {
        const artifactId = result.actions.openProposalUrl.split('/').pop() ?? '';
        logTrace(chatSessionId, { type: 'artifact', name: 'proposal_saved', data: { artifactId } });
      }

      // STEP 8 — checkpoint context after every handler execution
      await updateContext(this.workdir, instance, instance.context);

      if (!result.stateSignal) {
        // Handler did not emit a signal — workflow is paused waiting for input.
        // Mark so the resume service can find this instance.
        await setAwaitingInput(this.workdir, instance, true);
        break;
      }

      const currentStateDef = workflow.states[currentState];
      const nextState = currentStateDef?.transitions[result.stateSignal];

      if (!nextState) {
        // Signal not mapped to a transition — stay in current state
        break;
      }

      // STEP 8 — checkpoint state transition
      await updateState(this.workdir, instance, nextState);

      // TRACE — state transition
      logTrace(chatSessionId, { type: 'state', name: nextState });

      if (nextState === 'completed') {
        await markCompleted(this.workdir, instance);
        break;
      }

      const nextStateDef = workflow.states[nextState];

      if (nextStateDef?.kind === 'input') {
        // Run the new input state's handler once immediately so it can emit
        // its entry prompt (e.g. "Here's the summary — reply yes to confirm").
        // Without this, the state transitions silently and the user sees no
        // follow-up message until they send the next turn.
        const entryHandler = STATE_HANDLERS[nextState];
        if (entryHandler) {
          const entryCtx: HandlerContext = {
            workdir: this.workdir,
            namespace,
            instance,
            incomingMessage: message,
            onPhase,
            onChunk,
            onSection,
            onToolEvent,
            conversationContext,
          };
          try {
            const entryResult = await entryHandler(entryCtx);
            lastResult = entryResult;
            await updateContext(this.workdir, instance, instance.context);
            // Entry handlers for input states must not return a signal on first
            // entry (they just show the prompt). If they do signal, continue the
            // loop so the auto-advance path handles it correctly.
            if (entryResult.stateSignal) {
              continue;
            }
          } catch {
            // Entry prompt failure is non-fatal — just break and let the user
            // trigger the next state on their own.
          }
          await setAwaitingInput(this.workdir, instance, true);
        }
        break;
      }

      // agent / tool states: continue executing in this same turn
    }

    // ── Persist chat turn ─────────────────────────────────────────
    // Done here (not in routes) so interrupt answers and normal workflow
    // turns are both captured in a single place.
    if (lastResult?.message) {
      const proposalArtifactId =
        typeof instance.context.proposalArtifactId === 'string' ? instance.context.proposalArtifactId : undefined;
      void appendChatTurn(
        this.workdir,
        namespace,
        chatSessionId,
        message,
        lastResult.message,
        proposalArtifactId ? { proposalArtifactId } : undefined,
      );
    }

    // ── Build final response ──────────────────────────────────────
    if (instance.state === 'completed') {
      // STEP 7 — completion message + action metadata
      // Use the last handler's message when available (workflow-agnostic).
      // Fall back to a workflow-specific default if no message was emitted.
      const defaultMessages: Record<string, string> = {
        proposal_generation: 'Your proposal draft is ready.',
        rfp_analysis: 'RFP analysis complete. See the go/no-go recommendation above.',
        proposal_version_control: 'Version operation complete.',
        template_creation: 'Template saved successfully.',
        microsite_generation: 'Your microsite has been generated successfully.',
        compliance_redline: 'Compliance review complete.',
      };
      const completionMessage =
        lastResult?.message?.trim() || defaultMessages[instance.workflowId] || 'Workflow completed.';

      const actions: Record<string, string> = {
        viewTraceUrl: `/chat/trace/${chatSessionId}`,
        ...(lastResult?.actions ?? {}),
      };
      return { message: completionMessage, actions };
    }

    return {
      message: lastResult?.message ?? '',
      actions: lastResult?.actions,
    };
  }

  /**
   * Resume a workflow instance that was paused waiting for external input.
   *
   * Called by the workflow resume service when an ingestion_completed event
   * fires.  There is no incoming HTTP request, so events are emitted to the
   * chat session bus for the client's SSE subscription to receive.
   *
   * STEP 5 — resume entry point.
   */
  async resumeWorkflow(instance: WorkflowInstance): Promise<void> {
    const { chatSessionId, namespace } = instance;

    const workflow = WORKFLOW_REGISTRY[instance.workflowId];
    if (!workflow) {
      emitChatSessionEvent(chatSessionId, {
        type: 'error',
        error: `Workflow "${instance.workflowId}" is no longer registered.`,
      });
      return;
    }

    // STEP 5 — emit initial phase to the client's SSE channel
    emitChatSessionEvent(chatSessionId, {
      type: 'phase',
      phase: 'RFP ingestion complete. Starting proposal generation.',
    });

    const onPhase = (phase: string) => emitChatSessionEvent(chatSessionId, { type: 'phase', phase });

    const onChunk = (chunk: string) => emitChatSessionEvent(chatSessionId, { type: 'chunk', chunk });

    const onSection = (section: string, content: string, artifactId: string) =>
      emitChatSessionEvent(chatSessionId, {
        type: 'proposal_section',
        proposalSection: { section, content, artifactId },
      });

    const onToolEvent = (event: ToolTraceEvent) => {
      emitChatSessionEvent(chatSessionId, {
        type: 'tool_progress',
        toolProgress: {
          status: event.type === 'tool_started' ? 'started' : event.type === 'tool_completed' ? 'completed' : 'failed',
          tool: event.tool,
          input: event.input,
          output: event.output,
          error: event.error,
        },
      });
      if (event.type === 'tool_started') {
        logTrace(chatSessionId, { type: 'tool', name: event.tool, data: event.input });
      } else if (event.type === 'tool_completed') {
        logTrace(chatSessionId, { type: 'tool', name: `${event.tool}_result`, data: event.output });
      } else if (event.type === 'tool_failed') {
        logTrace(chatSessionId, { type: 'error', name: `${event.tool}_failed`, data: event.error });
      }
    };

    let lastResult: HandlerResult | null = null;

    try {
      for (;;) {
        const currentState = instance.state;

        if (currentState === 'completed') break;

        const handler = STATE_HANDLERS[currentState];
        if (!handler) break;

        const ctx: HandlerContext = {
          workdir: this.workdir,
          namespace,
          instance,
          incomingMessage: '',
          onPhase,
          onChunk,
          onSection,
          onToolEvent,
        };

        const result = await handler(ctx);
        lastResult = result;

        if (result.actions?.openProposalUrl) {
          const artifactId = result.actions.openProposalUrl.split('/').pop() ?? '';
          logTrace(chatSessionId, { type: 'artifact', name: 'proposal_saved', data: { artifactId } });
        }

        await updateContext(this.workdir, instance, instance.context);

        if (!result.stateSignal) {
          await setAwaitingInput(this.workdir, instance, true);
          break;
        }

        const currentStateDef = workflow.states[currentState];
        const nextState = currentStateDef?.transitions[result.stateSignal];

        if (!nextState) break;

        await updateState(this.workdir, instance, nextState);
        logTrace(chatSessionId, { type: 'state', name: nextState });

        if (nextState === 'completed') {
          await markCompleted(this.workdir, instance);
          break;
        }

        const nextStateDef = workflow.states[nextState];
        if (nextStateDef?.kind === 'input') break;
      }

      // Emit final done event
      const resumeDefaultMessages: Record<string, string> = {
        proposal_generation: 'Your proposal draft is ready.',
        rfp_analysis: 'RFP analysis complete. See the go/no-go recommendation above.',
        proposal_version_control: 'Version operation complete.',
        template_creation: 'Template saved successfully.',
        microsite_generation: 'Your microsite has been generated successfully.',
        compliance_redline: 'Compliance review complete.',
      };
      if (instance.state === 'completed') {
        const completionMessage =
          lastResult?.message?.trim() || resumeDefaultMessages[instance.workflowId] || 'Workflow completed.';
        emitChatSessionEvent(chatSessionId, {
          type: 'done',
          message: completionMessage,
          actions: {
            viewTraceUrl: `/chat/trace/${chatSessionId}`,
            ...(lastResult?.actions ?? {}),
          },
        });
      } else if (lastResult?.message) {
        emitChatSessionEvent(chatSessionId, {
          type: 'done',
          message: lastResult.message,
          actions: lastResult.actions,
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logTrace(chatSessionId, { type: 'error', name: errorMessage });
      emitChatSessionEvent(chatSessionId, { type: 'error', error: errorMessage });
    }
  }
}
