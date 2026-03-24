/**
 * Workflow event bus — in-process pub/sub for ingestion lifecycle events.
 *
 * The ingestion worker emits here; the workflow resume service subscribes.
 * Follows the same singleton EventEmitter pattern as execution-events.ts.
 *
 * Event names:
 *   ingestion_completed — a document finished indexing successfully
 *   ingestion_failed    — all retries exhausted for a document
 */

import { EventEmitter } from 'node:events';

export interface IngestionCompletedEvent {
  namespace: string;
  /** File name within the namespace uploads directory. */
  fileName: string;
  /** Storage URI for stream-uploaded files (e.g. local://uploads/rfp.pdf). */
  uri?: string;
  jobId: string;
  chunkCount: number;
}

export interface IngestionFailedEvent {
  namespace: string;
  fileName: string;
  uri?: string;
  jobId: string;
  error: string;
}

/** Singleton workflow event bus.  Max listeners uncapped — safe for tests. */
export const workflowEventBus = new EventEmitter();
workflowEventBus.setMaxListeners(0);
