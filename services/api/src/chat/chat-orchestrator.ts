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

import type { ProviderPolicyConfig } from '../provider-policy.js';
import { routeIntent } from './intent-router.js';
import { scanNamespace } from '../namespace/namespace-intelligence.service.js';
import { deriveInsightSuggestions } from '../namespace/insight-rules.js';
import { ProposalWorkflow } from '../workflows/proposal-generation.workflow.js';
import type { WorkflowDefinition } from '../workflows/proposal-generation.workflow.js';
import { RfpAnalysisWorkflow } from '../workflows/rfp-analysis.workflow.js';
import {
  createInstance,
  loadActiveInstance,
  updateState,
  updateContext,
  markCompleted,
  setAwaitingInput,
  type WorkflowInstance,
} from '../workflows/workflow-instance.service.js';
import { emitChatSessionEvent } from './chat-session-bus.js';
import {
  handleCollectingRfp,
  handleGeneratingOutline,
  handleGeneratingSections,
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

// ---------------------------------------------------------------------------
// Workflow registry — extend here to support additional workflows
// ---------------------------------------------------------------------------

const WORKFLOW_REGISTRY: Record<string, WorkflowDefinition> = {
  [ProposalWorkflow.id]: ProposalWorkflow,
  [RfpAnalysisWorkflow.id]: RfpAnalysisWorkflow,
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
  generating_outline: handleGeneratingOutline,
  generating_sections: handleGeneratingSections,
  // rfp_analysis
  checking_rfp: handleCheckingRfp,
  await_rfp_upload: handleAwaitRfpUpload,
  extract_requirements: handleExtractRequirements,
  gap_analysis: handleGapAnalysis,
  go_no_go: handleGoNoGo,
};

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
    const {
      message,
      namespace,
      chatSessionId,
      onPhase = () => {},
      onChunk = () => {},
    } = params;

    // ── Load or create workflow instance ─────────────────────────
    let instance = await loadActiveInstance(this.workdir, namespace, chatSessionId);

    if (!instance) {
      const intent = routeIntent(message);

      if (!intent) {
        return {
          message:
            'I can help you create proposals. Try saying "Create a proposal for [topic]".',
        };
      }

      const workflow = WORKFLOW_REGISTRY[intent.workflowId];
      if (!workflow) {
        return { message: `Unknown workflow: "${intent.workflowId}". Please try again.` };
      }

      instance = await createInstance(
        this.workdir,
        namespace,
        chatSessionId,
        workflow.id,
        workflow.initialState,
      );
    }

    const workflow = WORKFLOW_REGISTRY[instance.workflowId];
    if (!workflow) {
      return { message: `Workflow "${instance.workflowId}" is no longer registered.` };
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
          message:
            'This proposal workflow is already complete. Start a new chat session to create another.',
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
            status: event.type === 'tool_started'
              ? 'started'
              : event.type === 'tool_completed'
                ? 'completed'
                : 'failed',
            tool: event.tool,
            input: event.input,
            output: event.output,
            error: event.error,
          },
        });
      };

      const ctx: HandlerContext = {
        workdir: this.workdir,
        namespace,
        instance,
        incomingMessage: message,
        onPhase,
        onChunk,
        onToolEvent,
      };

      const result = await handler(ctx);
      lastResult = result;

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

      if (nextState === 'completed') {
        await markCompleted(this.workdir, instance);
        break;
      }

      const nextStateDef = workflow.states[nextState];

      if (nextStateDef?.kind === 'input') {
        // Pause: next state requires user input before we can continue
        break;
      }

      // agent / tool states: continue executing in this same turn
    }

    // ── Build final response ──────────────────────────────────────
    if (instance.state === 'completed') {
      // STEP 7 — completion message + action metadata
      // Use the last handler's message when available (workflow-agnostic).
      // Fall back to a workflow-specific default if no message was emitted.
      const defaultMessages: Record<string, string> = {
        proposal_generation: 'Your proposal draft is ready.',
        rfp_analysis: 'RFP analysis complete. See the go/no-go recommendation above.',
      };
      const completionMessage =
        lastResult?.message?.trim() ||
        defaultMessages[instance.workflowId] ||
        'Workflow completed.';

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

    const onPhase = (phase: string) =>
      emitChatSessionEvent(chatSessionId, { type: 'phase', phase });

    const onChunk = (chunk: string) =>
      emitChatSessionEvent(chatSessionId, { type: 'chunk', chunk });

    const onToolEvent = (event: ToolTraceEvent) =>
      emitChatSessionEvent(chatSessionId, {
        type: 'tool_progress',
        toolProgress: {
          status: event.type === 'tool_started'
            ? 'started'
            : event.type === 'tool_completed'
              ? 'completed'
              : 'failed',
          tool: event.tool,
          input: event.input,
          output: event.output,
          error: event.error,
        },
      });

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
          onToolEvent,
        };

        const result = await handler(ctx);
        lastResult = result;

        await updateContext(this.workdir, instance, instance.context);

        if (!result.stateSignal) {
          await setAwaitingInput(this.workdir, instance, true);
          break;
        }

        const currentStateDef = workflow.states[currentState];
        const nextState = currentStateDef?.transitions[result.stateSignal];

        if (!nextState) break;

        await updateState(this.workdir, instance, nextState);

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
      };
      if (instance.state === 'completed') {
        const completionMessage =
          lastResult?.message?.trim() ||
          resumeDefaultMessages[instance.workflowId] ||
          'Workflow completed.';
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
      emitChatSessionEvent(chatSessionId, { type: 'error', error: errorMessage });
    }
  }
}
