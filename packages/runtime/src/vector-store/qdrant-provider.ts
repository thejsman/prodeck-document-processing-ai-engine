/**
 * Qdrant vector store provider.
 *
 * Delegates all vector operations to the Python `knowledge_store` subprocess
 * via the knowledge bridge, passing a `vectorStore` config that tells the
 * Python layer to use QdrantVectorStore instead of FaissVectorStore.
 *
 * One Qdrant collection is created per namespace.  The Qdrant server handles
 * persistence — there are no local index files to manage.
 *
 * Configuration (workdir/config/namespaces/<ns>.json):
 * ```json
 * {
 *   "vectorStore": {
 *     "type": "qdrant",
 *     "url": "http://localhost:6333"
 *   }
 * }
 * ```
 *
 * Or set a global default via QDRANT_URL environment variable.
 *
 * For Qdrant Cloud, also set QDRANT_API_KEY (or pass apiKey in the namespace
 * config under "vectorStore.apiKey").  Local Docker setups without auth work
 * fine with no key set.
 */

import type { VectorStoreProvider, VectorChunk, VectorSearchResult } from '@ai-engine/core';
import {
  ingestDocuments,
  searchKnowledgeChunks,
  deleteNamespace as bridgeDeleteNamespace,
  namespaceStats as bridgeNamespaceStats,
} from '../knowledge/knowledge-bridge.js';

export class QdrantVectorStoreProvider implements VectorStoreProvider {
  private readonly qdrantUrl: string;
  private readonly qdrantApiKey: string | undefined;

  constructor(
    private readonly workdir: string,
    qdrantUrl?: string,
    qdrantApiKey?: string,
  ) {
    this.qdrantUrl =
      qdrantUrl ??
      process.env['QDRANT_URL'] ??
      'http://localhost:6333';
    this.qdrantApiKey = qdrantApiKey ?? process.env['QDRANT_API_KEY'];
  }

  private get vectorStoreConfig() {
    return {
      type: 'qdrant' as const,
      url: this.qdrantUrl,
      ...(this.qdrantApiKey ? { apiKey: this.qdrantApiKey } : {}),
    };
  }

  // ── VectorStoreProvider implementation ───────────────────────────────────

  async upsertChunks(params: {
    namespace: string;
    chunks: VectorChunk[];
  }): Promise<void> {
    const { namespace, chunks } = params;

    const documents = chunks.map((c) => ({
      fileName: c.id,
      content: c.text,
    }));

    await ingestDocuments({
      documents,
      // storageDir is required by the bridge signature but ignored by Qdrant
      storageDir: '',
      namespace,
      vectorStoreConfig: this.vectorStoreConfig,
    });
  }

  async search(params: {
    namespace: string;
    queryEmbedding: number[];
    topK: number;
    filter?: Record<string, unknown>;
  }): Promise<VectorSearchResult[]> {
    const { namespace, topK, filter } = params;
    const question = filter?.query as string | undefined;
    if (!question) return [];

    const result = await searchKnowledgeChunks({
      question,
      storageDir: '',
      namespace,
      topK,
      vectorStoreConfig: this.vectorStoreConfig,
    });

    return result.chunks.map((chunk, i) => ({
      id: `${namespace}-chunk-${i}`,
      score: chunk.score,
      text: chunk.text,
      metadata: { namespace } as Record<string, unknown>,
    }));
  }

  async deleteNamespace(namespace: string): Promise<void> {
    await bridgeDeleteNamespace({
      storageDir: '',
      namespace,
      vectorStoreConfig: this.vectorStoreConfig,
    });
  }

  async namespaceStats(namespace: string): Promise<{
    vectorCount: number;
    sizeBytes?: number;
  }> {
    return bridgeNamespaceStats({
      storageDir: '',
      namespace,
      vectorStoreConfig: this.vectorStoreConfig,
    });
  }
}
