/**
 * Workflow instance service — persistence for active chat workflow instances.
 *
 * Each instance is a JSON file at:
 *   {workdir}/workflows/{namespace}/{chatSessionId}.json
 *
 * This follows the project-wide pattern of filesystem JSON sidecars
 * (files.json, .meta.json, chunks.json) for per-namespace data.
 *
 * Functions are pure async; no in-memory registry.  The file is the
 * authoritative source of truth.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowContext {
  /** Storage-relative path of the RFP document (e.g. "uploads/rfp.pdf"). */
  rfpUri?: string;
  /** Markdown outline generated from the RFP. */
  outline?: string;
  /** File name of the saved proposal artifact (e.g. "chat-draft-1234567890.md"). */
  proposalArtifactId?: string;
  [key: string]: unknown;
}

export interface WorkflowInstance {
  id: string;
  namespace: string;
  chatSessionId: string;
  workflowId: string;
  /** Current workflow state name. */
  state: string;
  context: WorkflowContext;
  createdAt: string;
  updatedAt: string;
  /** Set when state machine reaches a terminal state. */
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function instancePath(
  workdir: string,
  namespace: string,
  chatSessionId: string,
): string {
  return path.join(workdir, 'workflows', namespace, `${chatSessionId}.json`);
}

// ---------------------------------------------------------------------------
// Internal persistence
// ---------------------------------------------------------------------------

async function persistInstance(
  workdir: string,
  instance: WorkflowInstance,
): Promise<void> {
  const filePath = instancePath(workdir, instance.namespace, instance.chatSessionId);
  instance.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(instance, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Create and persist a new workflow instance at the given initial state. */
export async function createInstance(
  workdir: string,
  namespace: string,
  chatSessionId: string,
  workflowId: string,
  initialState: string,
): Promise<WorkflowInstance> {
  const now = new Date().toISOString();
  const instance: WorkflowInstance = {
    id: randomUUID(),
    namespace,
    chatSessionId,
    workflowId,
    state: initialState,
    context: {},
    createdAt: now,
    updatedAt: now,
  };
  await persistInstance(workdir, instance);
  return instance;
}

/**
 * Load the active (not yet completed) instance for a chat session.
 * Returns null if no instance exists or if it has already been completed.
 */
export async function loadActiveInstance(
  workdir: string,
  namespace: string,
  chatSessionId: string,
): Promise<WorkflowInstance | null> {
  try {
    const raw = await readFile(
      instancePath(workdir, namespace, chatSessionId),
      'utf-8',
    );
    const instance = JSON.parse(raw) as WorkflowInstance;
    if (instance.completedAt) return null; // terminal — do not resume
    return instance;
  } catch {
    return null;
  }
}

/** Transition the instance to a new state and checkpoint to disk. */
export async function updateState(
  workdir: string,
  instance: WorkflowInstance,
  newState: string,
): Promise<WorkflowInstance> {
  instance.state = newState;
  await persistInstance(workdir, instance);
  return instance;
}

/** Merge partial context into the instance and checkpoint to disk. */
export async function updateContext(
  workdir: string,
  instance: WorkflowInstance,
  partialContext: Partial<WorkflowContext>,
): Promise<WorkflowInstance> {
  instance.context = { ...instance.context, ...partialContext };
  await persistInstance(workdir, instance);
  return instance;
}

/** Mark the instance as completed and checkpoint to disk. */
export async function markCompleted(
  workdir: string,
  instance: WorkflowInstance,
): Promise<WorkflowInstance> {
  instance.completedAt = new Date().toISOString();
  instance.state = 'completed';
  await persistInstance(workdir, instance);
  return instance;
}
