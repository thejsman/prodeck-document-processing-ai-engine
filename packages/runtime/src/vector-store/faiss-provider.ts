/**
 * FAISS vector store provider.
 *
 * Delegates all vector operations to the Python `knowledge_store` subprocess
 * via the knowledge bridge.  Enforces a per-namespace async write lock so
 * concurrent ingestion calls never corrupt the same FAISS index.
 *
 * Storage layout (unchanged from existing FAISS implementation):
 *   {workdir}/namespaces/{namespace}/index.faiss   — binary FAISS index
 *   {workdir}/namespaces/{namespace}/chunks.json   — chunk text metadata
 *
 * The `embedding` field on each VectorChunk is intentionally ignored: the
 * Python subprocess handles embedding computation internally via the
 * configured LLM provider.  External providers (Qdrant, Pinecone, PGVector)
 * will use the pre-computed embeddings from the VectorChunk.
 *
 * For `search`, pass the raw query text through `filter.query`.
 * `queryEmbedding` is reserved for providers that require pre-computed
 * embeddings supplied by the Node.js layer.
 */

import path from 'node:path';
import { stat, rm, readFile } from 'node:fs/promises';
import type { VectorStoreProvider, VectorChunk, VectorSearchResult } from '@ai-engine/core';
import {
  ingestDocuments,
  searchKnowledgeChunks,
} from '../knowledge/knowledge-bridge.js';

export class FaissVectorStoreProvider implements VectorStoreProvider {
  /**
   * Per-namespace async write locks.
   * Maps namespace → the tail of the current write-lock chain.
   */
  private readonly _writeLocks = new Map<string, Promise<void>>();

  constructor(private readonly workdir: string) {}

  // ── Write mutex ───────────────────────────────────────────────────────────

  /**
   * Serialize writes to a single namespace.
   * Concurrent writes are queued and executed one at a time.
   * Concurrent reads are never blocked.
   */
  private async withWriteLock<T>(
    namespace: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this._writeLocks.get(namespace) ?? Promise.resolve();

    let resolveLock!: () => void;
    const lockHeld = new Promise<void>((res) => {
      resolveLock = res;
    });

    // Register the new lock tail — swallow errors so one failure
    // does not permanently block subsequent writes.
    this._writeLocks.set(
      namespace,
      prev.then(() => lockHeld).catch(() => lockHeld),
    );

    try {
      await prev; // wait for any active write to finish
      return await fn();
    } finally {
      resolveLock(); // release this lock so queued writes can proceed
    }
  }

  // ── VectorStoreProvider implementation ───────────────────────────────────

  /**
   * Upsert chunks into the FAISS index.
   *
   * Maps VectorChunk[] → { fileName, content }[] and delegates to
   * `ingestDocuments`, which spawns `knowledge_store.py` to handle
   * embedding and index updates.
   *
   * Writes are serialized per namespace to prevent concurrent index corruption.
   */
  async upsertChunks(params: {
    namespace: string;
    chunks: VectorChunk[];
  }): Promise<void> {
    const { namespace, chunks } = params;
    const storageDir = path.join(this.workdir, 'namespaces', namespace);

    const documents = chunks.map((c) => ({
      fileName: c.id,
      content: c.text,
    }));

    await this.withWriteLock(namespace, () =>
      ingestDocuments({ documents, storageDir, namespace }),
    );
  }

  /**
   * Search the FAISS index and return raw chunk results.
   *
   * Supply the query text via `filter.query`.  The Python subprocess
   * handles embedding computation and returns top-k chunks with scores.
   *
   * Reads are not locked and can proceed concurrently with other reads.
   * A concurrent write may cause the read to see a slightly stale index;
   * this is acceptable for RAG workloads.
   */
  async search(params: {
    namespace: string;
    queryEmbedding: number[];
    topK: number;
    filter?: Record<string, unknown>;
  }): Promise<VectorSearchResult[]> {
    const { namespace, topK, filter } = params;
    const question = filter?.query as string | undefined;
    if (!question) return [];

    const storageDir = path.join(this.workdir, 'namespaces', namespace);
    const result = await searchKnowledgeChunks({
      question,
      storageDir,
      namespace,
      topK,
    });

    return result.chunks.map((chunk, i) => ({
      id: `${namespace}-chunk-${i}`,
      score: chunk.score,
      text: chunk.text,
      metadata: { namespace } as Record<string, unknown>,
    }));
  }

  /**
   * Delete all vector data for a namespace.
   *
   * Removes `index.faiss` and `chunks.json` from the namespace directory.
   * The namespace directory itself is preserved (it may contain uploads, etc.).
   */
  async deleteNamespace(namespace: string): Promise<void> {
    const storageDir = path.join(this.workdir, 'namespaces', namespace);
    await rm(path.join(storageDir, 'index.faiss'), { force: true });
    await rm(path.join(storageDir, 'chunks.json'), { force: true });
  }

  /**
   * Return vector count and index file size for a namespace.
   *
   * Reads `chunks.json` for the vector count and `stat`s `index.faiss`
   * for the byte size.  Returns `{ vectorCount: 0 }` if the namespace
   * has not been indexed yet.
   */
  async namespaceStats(namespace: string): Promise<{
    vectorCount: number;
    sizeBytes?: number;
  }> {
    const storageDir = path.join(this.workdir, 'namespaces', namespace);
    const chunksPath = path.join(storageDir, 'chunks.json');
    const indexPath = path.join(storageDir, 'index.faiss');

    try {
      const raw = await readFile(chunksPath, 'utf-8');
      const chunks = JSON.parse(raw) as unknown[];
      const indexStat = await stat(indexPath).catch(() => null);
      return {
        vectorCount: Array.isArray(chunks) ? chunks.length : 0,
        sizeBytes: indexStat?.size,
      };
    } catch {
      return { vectorCount: 0 };
    }
  }
}
