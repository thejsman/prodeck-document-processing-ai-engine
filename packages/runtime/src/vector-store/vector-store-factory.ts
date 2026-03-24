/**
 * Vector store factory.
 *
 * Returns the appropriate VectorStoreProvider for a namespace based on the
 * resolved namespace config.  Defaults to FAISS when no `vectorStore` config
 * is present, preserving existing behaviour for all current namespaces.
 *
 * Namespace config shape (workdir/config/namespaces/<ns>.json):
 * ```json
 * {
 *   "vectorStore": { "type": "faiss" }
 * }
 * ```
 *
 * Future provider mappings (add implementation here when ready):
 *   TODO: qdrant   — one collection per namespace; use Qdrant HTTP/gRPC client.
 *   TODO: pinecone — one namespace partition per namespace; use Pinecone SDK.
 *   TODO: pgvector — one table partition (or column index) per namespace;
 *                    use pg/postgres.js with pgvector extension.
 */

import type { VectorStoreProvider } from '@ai-engine/core';
import { FaissVectorStoreProvider } from './faiss-provider.js';

export interface VectorStoreProviderOptions {
  namespace: string;
  /** Resolved namespace config (from ConfigResolver). */
  config: Record<string, unknown>;
  workdir: string;
}

export function getVectorStoreProvider(
  options: VectorStoreProviderOptions,
): VectorStoreProvider {
  const vsConfig = options.config as { vectorStore?: { type?: string } };
  const type = vsConfig?.vectorStore?.type ?? 'faiss';

  if (type === 'faiss') {
    return new FaissVectorStoreProvider(options.workdir);
  }

  throw new Error(
    `Unknown vector store type: "${type}". ` +
      `Supported: faiss. Planned: qdrant, pinecone, pgvector.`,
  );
}
