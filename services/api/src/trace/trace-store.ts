/**
 * Execution Trace Store — per-session trace event log for workflow debugging.
 *
 * Enabled only when DEBUG_TRACE=true.  All public functions are no-ops when
 * tracing is disabled so callers can instrument unconditionally without
 * incurring any runtime cost in production.
 *
 * Key design decisions:
 *   - Keyed by chatSessionId (not workflowInstanceId) so the frontend can
 *     retrieve the trace with the same ID it already has from the chat URL.
 *   - Capped at MAX_EVENTS_PER_SESSION to prevent unbounded memory growth
 *     in long-running server processes.
 *   - No persistence — traces live only for the lifetime of the server
 *     process.  They are diagnostic, not durable.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TraceEvent {
  timestamp: number;
  type: 'state' | 'tool' | 'agent' | 'error' | 'artifact';
  name: string;
  /** Optional structured payload — tool input/output, artifact ID, etc. */
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRACE_ENABLED = process.env.DEBUG_TRACE === 'true';

/** Maximum events kept per session.  Oldest entries are dropped when exceeded. */
const MAX_EVENTS_PER_SESSION = 500;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** In-memory store: chatSessionId → ordered list of trace events. */
const traceStore: Record<string, TraceEvent[]> = {};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Append a trace event for a chat session.
 * No-op when DEBUG_TRACE !== "true".
 */
export function logTrace(
  sessionId: string,
  event: Omit<TraceEvent, 'timestamp'>,
): void {
  if (!TRACE_ENABLED) return;

  (traceStore[sessionId] ??= []).push({ ...event, timestamp: Date.now() });

  // Evict oldest entries when the cap is exceeded
  const list = traceStore[sessionId];
  if (list.length > MAX_EVENTS_PER_SESSION) {
    list.splice(0, list.length - MAX_EVENTS_PER_SESSION);
  }
}

/** Return all recorded events for a session.  Always safe to call. */
export function getTrace(sessionId: string): TraceEvent[] {
  return traceStore[sessionId] ?? [];
}

/** Remove all events for a session (e.g. when the session is cleared). */
export function clearTrace(sessionId: string): void {
  delete traceStore[sessionId];
}

/** Whether tracing is currently active. */
export function isTraceEnabled(): boolean {
  return TRACE_ENABLED;
}
