/**
 * Ingestion queue — namespace-sharded concurrent queue.
 *
 * Documents within the same namespace are processed serially (preserving
 * safe context.json writes). Documents in different namespaces are processed
 * concurrently up to MAX_CONCURRENT_NAMESPACES (default 3).
 *
 * Between jobs, control returns to the event loop so Fastify can continue
 * handling HTTP requests.
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
  /** User-assigned role for this document — controls extraction gating. */
  classification?: import('../chat/context.types.js').DocumentClassification;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

class NamespaceShardedQueue {
  /** Per-namespace pending job lists. */
  private readonly perNamespace = new Map<string, IngestionJob[]>();
  /** Namespaces currently being processed (one job at a time each). */
  private readonly activeNamespaces = new Set<string>();

  private workdir = '';
  private policyConfig: ProviderPolicyConfig | null = null;
  private maxConcurrent = 3;

  init(workdir: string, policyConfig: ProviderPolicyConfig | null): void {
    this.workdir = workdir;
    this.policyConfig = policyConfig;
    this.maxConcurrent = Math.max(
      1,
      parseInt(process.env.MAX_CONCURRENT_NAMESPACES ?? '3', 10),
    );
  }

  enqueue(job: Omit<IngestionJob, 'id'>): string {
    const fullJob: IngestionJob = { ...job, id: crypto.randomUUID() };
    const ns = job.namespace;

    if (!this.perNamespace.has(ns)) {
      this.perNamespace.set(ns, []);
    }
    this.perNamespace.get(ns)!.push(fullJob);

    // Defer so the current request handler can return before work begins
    Promise.resolve().then(() => this.maybeStart(ns));

    return fullJob.id;
  }

  /** Start processing a namespace if it isn't already running and a slot is free. */
  private maybeStart(ns: string): void {
    if (this.activeNamespaces.has(ns)) return;
    if (this.activeNamespaces.size >= this.maxConcurrent) return;
    this.processNamespace(ns).catch(() => {
      // processNamespace swallows individual job errors; this is a safety net
    });
  }

  /** Drains one namespace's queue serially, then frees its slot. */
  private async processNamespace(ns: string): Promise<void> {
    const queue = this.perNamespace.get(ns);
    if (!queue || queue.length === 0) return;

    this.activeNamespaces.add(ns);

    while (queue.length > 0) {
      const job = queue.shift()!;
      try {
        await processJob(job, this.workdir, this.policyConfig);
      } catch {
        // processJob handles its own error state (updates files.json, emits events)
      }
      // Yield to event loop between jobs
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    this.activeNamespaces.delete(ns);
    this.perNamespace.delete(ns);

    // A slot just freed — start any namespace that was waiting at the cap
    this.startWaiting();
  }

  /** Pick up waiting namespaces now that a concurrent slot has opened. */
  private startWaiting(): void {
    for (const [ns, jobs] of this.perNamespace) {
      if (this.activeNamespaces.size >= this.maxConcurrent) break;
      if (jobs.length === 0 || this.activeNamespaces.has(ns)) continue;
      this.processNamespace(ns).catch(() => {});
    }
  }
}

export const ingestionQueue = new NamespaceShardedQueue();
