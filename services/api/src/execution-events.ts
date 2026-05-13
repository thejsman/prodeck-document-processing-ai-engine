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
import type { DocumentClassification, RequirementKey, ConflictRecord } from './chat/context.types.js';

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

/**
 * Short-lived cache of terminal events (COMPLETED / FAILED) so the polling
 * endpoint can serve clients that missed the SSE push.  Entries expire after
 * 10 minutes — long enough for any 5-second poller to catch up.
 */
const recentTerminalEvents = new Map<string, ExecutionEvent>();

/**
 * Cache of ALL execution events (any status) keyed by executionId.
 * Stores the latest event per execution so the polling and trace endpoints
 * can return status for in-progress jobs too.
 */
const recentAllEvents = new Map<string, { event: ExecutionEvent; cachedAt: number }>();

/** Broadcast an execution status update to all connected SSE clients. */
export function emitExecution(event: ExecutionEvent): void {
  executionBus.emit('update', event);

  const cachedAt = Date.now();
  recentAllEvents.set(event.executionId, { event, cachedAt });
  // Evict after 10 minutes, but only if no newer update has replaced this entry
  setTimeout(() => {
    const current = recentAllEvents.get(event.executionId);
    if (current && current.cachedAt === cachedAt) {
      recentAllEvents.delete(event.executionId);
    }
  }, 10 * 60 * 1000);

  if (event.status === 'COMPLETED' || event.status === 'FAILED') {
    recentTerminalEvents.set(event.executionId, event);
    setTimeout(() => { recentTerminalEvents.delete(event.executionId); }, 10 * 60 * 1000);
  }
}

/** Return the cached terminal event for an execution ID, or undefined if not yet terminal. */
export function getRecentExecution(executionId: string): ExecutionEvent | undefined {
  return recentTerminalEvents.get(executionId);
}

/** Return the latest cached event for any execution ID regardless of status. */
export function getExecution(executionId: string): ExecutionEvent | undefined {
  return recentAllEvents.get(executionId)?.event;
}

// ---------------------------------------------------------------------------
// Extraction-ready events — emitted after extraction completes under
// EXTRACTION_CONFIRMATION=true, before anything is written to context.json.
// ---------------------------------------------------------------------------

export interface ExtractionReadyPayload {
  cardId: string;
  namespace: string;
  fileName: string;
  classification: DocumentClassification;
  extractedFields: Array<{
    key: RequirementKey;
    value: unknown;
    confidence: number;
    conflict?: ConflictRecord;
  }>;
  knowledgeEntryCount: number;
  highConfidenceCount: number;
  lowConfidenceCount: number;
  /** Tier 1 fields that were not found in the document. */
  notFoundFields: RequirementKey[];
  /** ISO timestamp — card expires 24 hours after emission. */
  expiresAt: string;
}

/** Separate bus for extraction-ready events — emitted as named SSE events. */
export const extractionBus = new EventEmitter();
extractionBus.setMaxListeners(0);

/** Emit an extraction-ready payload to all connected SSE clients. */
export function emitExtractionReady(payload: ExtractionReadyPayload): void {
  extractionBus.emit('extraction_ready', payload);
}

// ---------------------------------------------------------------------------
// Ingestion progress events — granular stage updates emitted throughout the
// indexing and extraction branches so the UI can show live progress.
// ---------------------------------------------------------------------------

export interface IngestionProgressEvent {
  fileName: string;
  namespace: string;
  stage:
    | 'chunking'    // splitting document into chunks
    | 'embedding'   // vectorizing and storing chunks
    | 'detecting'   // document type detection
    | 'excerpting'  // smart excerpt extraction (Phase 3)
    | 'extracting'  // LLM extraction call in progress
    | 'storing';    // writing to context.json / pending cache
  chunksProcessed?: number;
  totalChunks?: number;
  message?: string;
}

export const progressBus = new EventEmitter();
progressBus.setMaxListeners(0);

export function emitIngestionProgress(event: IngestionProgressEvent): void {
  progressBus.emit('ingestion_progress', event);
}
