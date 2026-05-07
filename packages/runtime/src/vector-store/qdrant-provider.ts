/**
 * Qdrant vector store provider — native Node.js implementation.
 *
 * Uses @qdrant/js-client-rest to talk to Qdrant directly and the OpenAI
 * embeddings API to generate vectors in Node.js.  The Python knowledge-bridge
 * is NOT used here; FAISS users continue through the Python bridge unchanged.
 *
 * One Qdrant collection is created per namespace (idempotent).  The Qdrant
 * server handles persistence — there are no local index files to manage.
 *
 * Configuration (workdir/config/namespaces/<ns>.json):
 * ```json
 * {
 *   "vectorStore": {
 *     "type": "qdrant",
 *     "url": "https://your-cluster.aws.cloud.qdrant.io",
 *     "apiKey": "optional-per-namespace-key"
 *   }
 * }
 * ```
 *
 * Or set global defaults via environment variables:
 *   QDRANT_URL        — Qdrant base URL (default: http://localhost:6333)
 *   QDRANT_API_KEY    — Qdrant Cloud API key (optional for local Docker)
 *   OPENAI_API_KEY    — Required for embedding generation
 *   OPENAI_EMBEDDING_MODEL — Embedding model (default: text-embedding-3-large)
 */

import type { VectorStoreProvider, VectorChunk, VectorSearchResult } from '@ai-engine/core';
import { QdrantClient, type Schemas } from '@qdrant/js-client-rest';
import OpenAI from 'openai';

const VECTOR_SIZE = 3072;
const COLLECTION_DISTANCE = 'Cosine' as const;

export class QdrantVectorStoreProvider implements VectorStoreProvider {
  private readonly client: QdrantClient;
  private readonly openai: OpenAI;
  private readonly embeddingModel: string;

  constructor(
    _workdir: string,
    qdrantUrl?: string,
    qdrantApiKey?: string,
  ) {
    const url = qdrantUrl ?? process.env['QDRANT_URL'] ?? 'http://localhost:6333';
    const apiKey = qdrantApiKey ?? process.env['QDRANT_API_KEY'];
    this.client = new QdrantClient({ url, ...(apiKey ? { apiKey } : {}) });
    this.openai = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
    this.embeddingModel =
      process.env['OPENAI_EMBEDDING_MODEL'] ?? 'text-embedding-3-large';
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async embedTexts(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += 100) {
      const batch = texts.slice(i, i + 100);
      try {
        const res = await this.openai.embeddings.create({
          model: this.embeddingModel,
          input: batch,
        });
        results.push(...res.data.map((d: { embedding: number[] }) => d.embedding));
      } catch (err) {
        console.warn('[QdrantVectorStoreProvider] embedTexts failed:', err);
        throw err;
      }
    }
    return results;
  }

  private async ensureCollection(namespace: string): Promise<void> {
    const { exists } = await this.client.collectionExists(namespace);
    if (!exists) {
      await this.client.createCollection(namespace, {
        vectors: { size: VECTOR_SIZE, distance: COLLECTION_DISTANCE },
      });
    }
  }

  // ── VectorStoreProvider implementation ───────────────────────────────────

  async upsertChunks(params: {
    namespace: string;
    chunks: VectorChunk[];
  }): Promise<void> {
    const { namespace, chunks } = params;
    await this.ensureCollection(namespace);

    const texts = chunks.map((c) => c.text);
    const embeddings = await this.embedTexts(texts);

    for (let i = 0; i < chunks.length; i += 100) {
      const points = chunks.slice(i, i + 100).map((c, j) => ({
        id: i + j,
        vector: embeddings[i + j],
        payload: {
          text: c.text,
          fileName: c.id,
          namespace,
          docId: c.metadata.docId,
        },
      }));
      await this.client.upsert(namespace, { wait: true, points });
    }
  }

  async search(params: {
    namespace: string;
    queryEmbedding: number[];
    topK: number;
    filter?: Record<string, unknown>;
  }): Promise<VectorSearchResult[]> {
    const { namespace, topK, filter } = params;
    const queryText = filter?.['query'] as string | undefined;
    if (!queryText) return [];

    try {
      const [queryVector] = await this.embedTexts([queryText]);
      const results = await this.client.search(namespace, {
        vector: queryVector,
        limit: topK,
        with_payload: true,
      });
      return results.map((r: Schemas['ScoredPoint']) => ({
        id: String(r.id),
        score: r.score,
        text: r.payload?.['text'] as string,
        metadata: r.payload as Record<string, unknown>,
      }));
    } catch {
      return [];
    }
  }

  async deleteNamespace(namespace: string): Promise<void> {
    try {
      await this.client.deleteCollection(namespace);
    } catch { /* collection didn't exist — resolve silently */ }
  }

  async namespaceStats(namespace: string): Promise<{
    vectorCount: number;
    sizeBytes?: number;
  }> {
    try {
      const info = await this.client.getCollection(namespace);
      return { vectorCount: info.indexed_vectors_count ?? 0 };
    } catch {
      return { vectorCount: 0 };
    }
  }
}
