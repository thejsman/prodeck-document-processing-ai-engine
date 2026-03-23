/**
 * Execution event bus — in-process pub/sub for execution status changes.
 *
 * Workers and route handlers emit to this bus; the SSE endpoint
 * (GET /api/ai-executions/stream) subscribes and forwards events to clients.
 *
 * Usage:
 *   // Emit from a worker:
 *   emitExecution({ executionId: job.id, status: 'RUNNING', type: 'ingestion' });
 *
 *   // Subscribe in an SSE handler:
 *   executionBus.on('update', (event) => res.write(...));
 *   req.on('close', () => executionBus.off('update', handler));
 */

import { EventEmitter } from 'node:events';

export interface ExecutionEvent {
  executionId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  /** Optional execution type hint for the frontend tracker (e.g. "ingestion"). */
  type?: string;
  /** Display title shown in the task drawer (e.g. file name, proposal name). */
  title?: string;
  /** Human-readable status message or error description. */
  message?: string;
}

/** Singleton event bus.  Max listeners is uncapped — one per SSE connection. */
export const executionBus = new EventEmitter();
executionBus.setMaxListeners(0);

/** Broadcast an execution status update to all connected SSE clients. */
export function emitExecution(event: ExecutionEvent): void {
  executionBus.emit('update', event);
}
