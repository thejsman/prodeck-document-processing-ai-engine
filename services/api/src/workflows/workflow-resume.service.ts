/**
 * Workflow resume service — reacts to ingestion events and unblocks waiting workflows.
 *
 * When a document finishes indexing, any workflow instance that is paused in
 * the collecting_rfp state (awaitingInput = true) for the same namespace is
 * resumed automatically.
 *
 * Resume sequence:
 *   1. Scan namespace for instances in state="collecting_rfp", awaitingInput=true.
 *   2. STEP 7 — concurrency guard: skip instances already being resumed.
 *   3. Set context.rfpUri and context.rfpIngested = true.
 *   4. Clear awaitingInput flag.
 *   5. Call orchestrator.resumeWorkflow() which continues the execution loop.
 *
 * On ingestion failure:
 *   1. Same scan.
 *   2. Emit a system message to the chat session channel so the user is informed.
 *   3. Leave workflow state unchanged (user can re-upload).
 */

import type { IngestionCompletedEvent, IngestionFailedEvent } from './workflow-event-bus.js';
import {
  loadWorkflowsInState,
  updateContext,
  setAwaitingInput,
  type WorkflowInstance,
} from './workflow-instance.service.js';
import { emitChatSessionEvent } from '../chat/chat-session-bus.js';
import type { ChatOrchestrator } from '../chat/chat-orchestrator.js';
import { scanNamespace } from '../namespace/namespace-intelligence.service.js';
import { deriveInsightSuggestions } from '../namespace/insight-rules.js';

// ---------------------------------------------------------------------------
// Concurrency guard — prevents double-resume of the same instance
// ---------------------------------------------------------------------------

const resumingInstances = new Set<string>();

// ---------------------------------------------------------------------------
// ingestion_completed handler
// ---------------------------------------------------------------------------

/**
 * Resume every collecting_rfp workflow in the affected namespace.
 *
 * Called from the workflowEventBus listener registered at server startup.
 * Errors are logged but do not propagate — ingestion completion must not
 * be rolled back because of a downstream workflow failure.
 */
export async function resumeWorkflowsForIngestion(
  event: IngestionCompletedEvent,
  workdir: string,
  orchestrator: ChatOrchestrator,
): Promise<void> {
  const instances = await loadWorkflowsInState(workdir, event.namespace, 'collecting_rfp');

  for (const instance of instances) {
    // STEP 7 — concurrency safety: skip if already being resumed
    if (resumingInstances.has(instance.id)) continue;
    resumingInstances.add(instance.id);

    try {
      await resumeSingleInstance(instance, event, workdir, orchestrator);
    } catch (err) {
      console.error(
        `[WorkflowResume] Failed to resume instance ${instance.id}: ${String(err)}`,
      );
    } finally {
      resumingInstances.delete(instance.id);
    }
  }

  // STEP 6 — post-ingestion namespace scan: push suggestions to all active sessions.
  // Non-fatal — scan errors must never block ingestion completion.
  scanNamespace(workdir, event.namespace)
    .then((insights) => {
      const suggestions = deriveInsightSuggestions(insights);
      if (suggestions.length === 0) return;

      // Broadcast to every workflow instance in this namespace so all open
      // SSE sessions receive the updated suggestion chips.
      for (const instance of instances) {
        emitChatSessionEvent(instance.chatSessionId, {
          type: 'namespace_insight',
          suggestions,
        });
      }
    })
    .catch((err) => {
      process.stderr.write(`[NamespaceIntelligence] post-ingestion scan failed: ${String(err)}\n`);
    });
}

async function resumeSingleInstance(
  instance: WorkflowInstance,
  event: IngestionCompletedEvent,
  workdir: string,
  orchestrator: ChatOrchestrator,
): Promise<void> {
  // STEP 7 — re-validate state after acquiring the "lock" slot
  if (instance.completedAt) return;
  if (instance.state !== 'collecting_rfp') return;
  if (!instance.awaitingInput) return;

  // Set rfpUri from the ingestion event — prefer storage URI, fall back to filename
  const rfpUri = event.uri ?? `uploads/${event.fileName}`;
  await updateContext(workdir, instance, {
    rfpUri,
    rfpIngested: true,
  });

  // Clear the pause flag before resuming so re-entrant calls are skipped
  await setAwaitingInput(workdir, instance, false);

  // STEP 5 — resume execution loop via orchestrator
  await orchestrator.resumeWorkflow(instance);
}

// ---------------------------------------------------------------------------
// ingestion_failed handler  (STEP 6)
// ---------------------------------------------------------------------------

/**
 * Notify any waiting workflow that ingestion failed so the user can re-upload.
 * The workflow state is intentionally left unchanged.
 */
export async function handleIngestionFailure(
  event: IngestionFailedEvent,
  workdir: string,
): Promise<void> {
  const instances = await loadWorkflowsInState(workdir, event.namespace, 'collecting_rfp');

  for (const instance of instances) {
    emitChatSessionEvent(instance.chatSessionId, {
      type: 'system',
      message: 'Ingestion failed. Please re-upload the RFP document.',
    });
  }
}
