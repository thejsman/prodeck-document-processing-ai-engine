/**
 * Ingestion queue — in-process FIFO queue that processes jobs sequentially.
 *
 * Jobs are processed one at a time to avoid overwhelming the Python FAISS
 * subprocess. Between jobs, control returns to the event loop so Fastify
 * can continue handling HTTP requests.
 *
 * Usage:
 *   ingestionQueue.init(workdir, policyConfig);
 *   ingestionQueue.enqueue({ namespace: 'acme', fileName: 'doc.md' });
 */

import { processJob } from './ingestion-worker.js';
import type { ProviderPolicyConfig } from '../provider-policy.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestionJob {
  id: string;
  namespace: string;
  fileName: string;
  /** If set, this is a full-rebuild job (e.g. after file deletion). */
  allFiles?: string[];
  /**
   * Storage URI for stream-uploaded files.
   * When present the worker uses processDocumentStream() instead of
   * reading from the local uploads directory.
   */
  uri?: string;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

class IngestionQueue {
  private jobs: IngestionJob[] = [];
  private running = false;
  private workdir = '';
  private policyConfig: ProviderPolicyConfig | null = null;

  init(workdir: string, policyConfig: ProviderPolicyConfig | null): void {
    this.workdir = workdir;
    this.policyConfig = policyConfig;
  }

  enqueue(job: Omit<IngestionJob, 'id'>): string {
    const fullJob: IngestionJob = {
      ...job,
      id: crypto.randomUUID(),
    };
    this.jobs.push(fullJob);
    if (!this.running) {
      // Defer to next microtask so current request handler can return first
      Promise.resolve().then(() => this.processNext());
    }
    return fullJob.id;
  }

  private async processNext(): Promise<void> {
    if (this.jobs.length === 0) {
      this.running = false;
      return;
    }
    this.running = true;
    const job = this.jobs.shift()!;

    try {
      await processJob(job, this.workdir, this.policyConfig);
    } catch {
      // processJob handles its own error state (updates files.json)
      // Swallow here to keep the queue running
    }

    // Yield to event loop between jobs
    setImmediate(() => {
      this.processNext().catch(() => {
        // Queue must not crash the process
      });
    });
  }
}

export const ingestionQueue = new IngestionQueue();
