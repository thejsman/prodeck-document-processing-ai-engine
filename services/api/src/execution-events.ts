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

/** Broadcast an execution status update to all connected SSE clients. */
export function emitExecution(event: ExecutionEvent): void {
  executionBus.emit('update', event);
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
