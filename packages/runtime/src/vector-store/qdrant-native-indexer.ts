/**
 * Native Node.js Qdrant indexer.
 *
 * Eliminates the Python subprocess cold start for the indexing branch by
 * chunking content, embedding via the configured LLM provider HTTP API, and
 * upserting directly to Qdrant using the JS REST client.
 *
 * Chunk size (500 chars) and distance metric (COSINE) match the Python
 * knowledge_store.py so that collections are interchangeable.
 *
 * Uses dynamic import() for @qdrant/js-client-rest to stay compatible with
 * the CJS-compiled runtime package while the qdrant client ships as ESM.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 500;
/** Chunks per embed + upsert batch — balances memory vs round-trips. */
const EMBED_BATCH_SIZE = 32;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NativeQdrantIndexParams {
  namespace: string;
  fileName: string;
  content: string;
  qdrantUrl: string;
  /** API key for Qdrant Cloud. Leave undefined for local Docker (no auth). */
  qdrantApiKey?: string;
  /** Called after each batch is upserted so the caller can emit SSE progress. */
  onProgress?: (chunksProcessed: number, totalChunks: number) => void;
}

export interface NativeQdrantIndexResult {
  chunks: number;
}

// ---------------------------------------------------------------------------
// Minimal local interface — avoids static type import from ESM package.
// Matches the subset of QdrantClient we actually call.
// ---------------------------------------------------------------------------

interface QdrantCollectionInfo {
  points_count?: number;
  config?: {
    params?: {
      vectors?: { size?: number } | Record<string, { size?: number }>;
    };
  };
}

interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

interface QdrantClient {
  getCollection(name: string): Promise<QdrantCollectionInfo>;
  createCollection(name: string, config: { vectors: { size: number; distance: string } }): Promise<unknown>;
  upsert(collection: string, opts: { wait: boolean; points: QdrantPoint[] }): Promise<unknown>;
  deleteCollection(name: string): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Lazy Qdrant client loader — defers ESM import to runtime
// ---------------------------------------------------------------------------

let _QdrantClientCtor: (new (opts: { url: string; apiKey?: string }) => QdrantClient) | undefined;

async function loadQdrantCtor() {
  if (!_QdrantClientCtor) {
    // Dynamic import keeps the CJS bundle compatible with the ESM qdrant package.
    const mod = (await import('@qdrant/js-client-rest')) as {
      QdrantClient: new (opts: { url: string; apiKey?: string }) => QdrantClient;
    };
    _QdrantClientCtor = mod.QdrantClient;
  }
  return _QdrantClientCtor;
}

async function createClient(url: string, apiKey?: string): Promise<QdrantClient> {
  const Ctor = await loadQdrantCtor();
  return new Ctor({ url, ...(apiKey ? { apiKey } : {}) });
}

// ---------------------------------------------------------------------------
// Chunking — matches Python split_chunks(text, CHUNK_SIZE)
// ---------------------------------------------------------------------------

function splitChunks(text: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += CHUNK_SIZE) {
    const chunk = text.slice(start, start + CHUNK_SIZE).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

async function embedOllama(texts: string[]): Promise<number[][]> {
  const baseUrl = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
  const model = process.env['OLLAMA_EMBEDDING_MODEL'] ?? 'nomic-embed-text';
  return Promise.all(
    texts.map(async (text) => {
      const res = await fetch(`${baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
      });
      if (!res.ok) {
        throw new Error(`Ollama embeddings error ${res.status}: ${await res.text()}`);
      }
      const json = (await res.json()) as { embedding: number[] };
      return json.embedding;
    }),
  );
}

async function embedOpenAI(texts: string[]): Promise<number[][]> {
  const apiKey = process.env['OPENAI_API_KEY'] ?? '';
  const model = process.env['OPENAI_EMBEDDING_MODEL'] ?? 'text-embedding-3-large';
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embeddings error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

function embedBatch(texts: string[], provider: string): Promise<number[][]> {
  return provider === 'openai' ? embedOpenAI(texts) : embedOllama(texts);
}

// ---------------------------------------------------------------------------
// Qdrant collection management
// ---------------------------------------------------------------------------

async function ensureCollection(client: QdrantClient, namespace: string, dim: number): Promise<void> {
  try {
    const info = await client.getCollection(namespace);
    // Detect dimension mismatch — vectors may be unnamed (VectorParams) or named (Record<string, VectorParams>)
    const vCfg = info.config?.params?.vectors;
    const existingDim: number | undefined =
      vCfg && typeof vCfg === 'object' && 'size' in vCfg
        ? (vCfg as { size: number }).size
        : undefined;
    if (existingDim !== undefined && existingDim !== dim) {
      throw new Error(
        `Qdrant collection '${namespace}' has dimension ${existingDim} but ` +
          `current embedding model produces dimension ${dim}. ` +
          `Delete the collection or switch to a matching embedding model.`,
      );
    }
  } catch (err) {
    // ApiError from @qdrant/openapi-typescript-fetch carries a numeric `status`.
    // Checking the status code is more reliable than string-matching the message
    // (which varies in capitalisation: "Not Found" vs "Not found").
    const status = (err as { status?: number }).status;
    if (status === 404) {
      await client.createCollection(namespace, {
        vectors: { size: dim, distance: 'Cosine' },
      });
    } else {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Chunk, embed, and upsert a single document into a Qdrant collection.
 * Uses native HTTP calls to the embedding provider — no Python subprocess.
 */
export async function nativeQdrantIndex(
  params: NativeQdrantIndexParams,
): Promise<NativeQdrantIndexResult> {
  const { namespace, fileName, content, qdrantUrl, qdrantApiKey, onProgress } = params;
  const provider = process.env['LLM_PROVIDER'] ?? 'ollama';

  const chunks = splitChunks(content);
  if (chunks.length === 0) return { chunks: 0 };

  const client = await createClient(qdrantUrl, qdrantApiKey);
  let collectionReady = false;
  let processed = 0;

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedBatch(batch, provider);

    if (!collectionReady) {
      await ensureCollection(client, namespace, embeddings[0].length);
      collectionReady = true;
    }

    const points = batch.map((text, j) => ({
      id: randomUUID(),
      vector: embeddings[j],
      payload: { text, document: fileName } as Record<string, unknown>,
    }));

    await client.upsert(namespace, { wait: true, points });

    processed += batch.length;
    onProgress?.(processed, chunks.length);
  }

  return { chunks: chunks.length };
}

/**
 * Drop a namespace's Qdrant collection. Safe to call even if it doesn't exist.
 */
export async function nativeQdrantDeleteNamespace(
  qdrantUrl: string,
  namespace: string,
): Promise<void> {
  const client = await createClient(qdrantUrl);
  try {
    await client.deleteCollection(namespace);
  } catch {
    // Collection may not exist — treat as success.
  }
}

/**
 * Return the number of vectors in a namespace's Qdrant collection.
 */
export async function nativeQdrantNamespaceStats(
  qdrantUrl: string,
  namespace: string,
): Promise<{ vectorCount: number }> {
  const client = await createClient(qdrantUrl);
  try {
    const info = await client.getCollection(namespace);
    return { vectorCount: info.points_count ?? 0 };
  } catch {
    return { vectorCount: 0 };
  }
}
