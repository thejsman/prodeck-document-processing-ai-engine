/**
 * Chat session event bus — per-session streaming channel.
 *
 * When the orchestrator resumes a workflow triggered by an external event
 * (e.g. ingestion complete), there is no open HTTP request to write to.
 * Instead, the orchestrator emits events here and the client subscribes via
 * GET /chat/session/:chatSessionId/stream (SSE).
 *
 * Event names are the chatSessionId strings, so each session has its own
 * isolated channel.  The SSE endpoint subscribes on connect and unsubscribes
 * on disconnect.
 *
 * Usage:
 *   // Emitter (orchestrator / resume service):
 *   emitChatSessionEvent(chatSessionId, { type: 'phase', phase: 'Analyzing RFP' });
 *
 *   // Subscriber (SSE route handler):
 *   chatSessionBus.on(chatSessionId, handler);
 *   req.raw.on('close', () => chatSessionBus.off(chatSessionId, handler));
 */

import { EventEmitter } from 'node:events';

export type ChatSessionEventType = 'phase' | 'chunk' | 'done' | 'error' | 'system' | 'tool_progress';

export interface ToolProgressPayload {
  /** 'started' | 'completed' | 'failed' */
  status: string;
  tool: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface ChatSessionEvent {
  type: ChatSessionEventType;
  phase?: string;
  chunk?: string;
  message?: string;
  actions?: Record<string, string>;
  error?: string;
  toolProgress?: ToolProgressPayload;
}

/** Singleton bus.  One listener per connected SSE client — uncapped. */
export const chatSessionBus = new EventEmitter();
chatSessionBus.setMaxListeners(0);

/** Broadcast an event to all SSE clients subscribed to the given session. */
export function emitChatSessionEvent(
  chatSessionId: string,
  event: ChatSessionEvent,
): void {
  chatSessionBus.emit(chatSessionId, event);
}
