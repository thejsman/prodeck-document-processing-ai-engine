import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mock method refs — configured per test via beforeEach / mockResolvedValueOnce
// ---------------------------------------------------------------------------

const mockGetCollection = vi.fn();
const mockCreateCollection = vi.fn();
const mockUpsert = vi.fn();
const mockDeleteCollection = vi.fn();

// @qdrant/js-client-rest mock — must use regular function (not arrow) so it
// works as a constructor with `new`.
vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: vi.fn(function () {
    return {
      getCollection: mockGetCollection,
      createCollection: mockCreateCollection,
      upsert: mockUpsert,
      deleteCollection: mockDeleteCollection,
    };
  }),
}));

// ---------------------------------------------------------------------------
// Import after mock declarations (vi.mock is hoisted so the order is safe).
// ---------------------------------------------------------------------------

import {
  nativeQdrantIndex,
  nativeQdrantDeleteNamespace,
  nativeQdrantNamespaceStats,
} from './qdrant-native-indexer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeEmbedding(dim = 768): number[] {
  return Array.from({ length: dim }, (_, i) => i / dim);
}

/** fetch mock that returns an Ollama-style embedding response (one text at a time). */
function ollamaFetch(dim = 768): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ embedding: fakeEmbedding(dim) }),
    text: () => Promise.resolve('ok'),
  });
}

/** fetch mock that returns an OpenAI-style batch embedding response. */
function openAiFetch(count: number, dim = 1536): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        data: Array.from({ length: count }, () => ({ embedding: fakeEmbedding(dim) })),
      }),
    text: () => Promise.resolve('ok'),
  });
}

const QDRANT_URL = 'http://localhost:6333';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: collection doesn't exist — 404 triggers createCollection
  mockGetCollection.mockRejectedValue(new Error('404 Not found'));
  mockCreateCollection.mockResolvedValue({});
  mockUpsert.mockResolvedValue({});
  mockDeleteCollection.mockResolvedValue({});

  process.env['LLM_PROVIDER'] = 'ollama';
  process.env['OLLAMA_BASE_URL'] = 'http://localhost:11434';
  process.env['OLLAMA_EMBEDDING_MODEL'] = 'nomic-embed-text';
  delete process.env['OPENAI_API_KEY'];
  delete process.env['OPENAI_EMBEDDING_MODEL'];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Chunking behaviour
// ---------------------------------------------------------------------------

describe('nativeQdrantIndex — chunking', () => {
  it('returns { chunks: 0 } for empty content without calling fetch', async () => {
    const fetchMock = ollamaFetch();
    vi.stubGlobal('fetch', fetchMock);

    const result = await nativeQdrantIndex({
      namespace: 'test-ns',
      fileName: 'empty.txt',
      content: '',
      qdrantUrl: QDRANT_URL,
    });

    expect(result.chunks).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns { chunks: 1 } for content shorter than 500 chars', async () => {
    vi.stubGlobal('fetch', ollamaFetch());

    const result = await nativeQdrantIndex({
      namespace: 'test-ns',
      fileName: 'short.txt',
      content: 'Short document under 500 characters.',
      qdrantUrl: QDRANT_URL,
    });

    expect(result.chunks).toBe(1);
  });

  it('splits 1200-char content into 3 chunks of 500/500/200', async () => {
    vi.stubGlobal('fetch', ollamaFetch());

    const result = await nativeQdrantIndex({
      namespace: 'test-ns',
      fileName: 'long.txt',
      content: 'A'.repeat(1200),
      qdrantUrl: QDRANT_URL,
    });

    expect(result.chunks).toBe(3); // ceil(1200/500) = 3
  });

  it('fires onProgress with cumulative chunk counts per batch (EMBED_BATCH_SIZE=32)', async () => {
    vi.stubGlobal('fetch', ollamaFetch());

    const calls: Array<[number, number]> = [];
    // 50 chunks → batch 1: processed=32, batch 2: processed=50
    await nativeQdrantIndex({
      namespace: 'test-ns',
      fileName: 'batched.txt',
      content: 'A'.repeat(50 * 500),
      qdrantUrl: QDRANT_URL,
      onProgress: (processed, total) => calls.push([processed, total]),
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([32, 50]);
    expect(calls[1]).toEqual([50, 50]);
  });

  it('fires no progress events for empty content', async () => {
    vi.stubGlobal('fetch', ollamaFetch());
    const calls: number[] = [];

    await nativeQdrantIndex({
      namespace: 'test-ns',
      fileName: 'empty.txt',
      content: '',
      qdrantUrl: QDRANT_URL,
      onProgress: (p) => calls.push(p),
    });

    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Embedding API
// ---------------------------------------------------------------------------

describe('nativeQdrantIndex — embedding API', () => {
  it('calls Ollama /api/embeddings once per chunk', async () => {
    const fetchMock = ollamaFetch();
    vi.stubGlobal('fetch', fetchMock);

    // 3 chunks → 3 individual Ollama calls (Ollama embeds one text at a time)
    await nativeQdrantIndex({
      namespace: 'test-ns',
      fileName: 'doc.txt',
      content: 'A'.repeat(1500),
      qdrantUrl: QDRANT_URL,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/embeddings');
    const body = JSON.parse(opts.body as string) as { model: string; prompt: string };
    expect(body.model).toBe('nomic-embed-text');
    expect(typeof body.prompt).toBe('string');
  });

  it('uses OLLAMA_BASE_URL env var for embedding endpoint', async () => {
    process.env['OLLAMA_BASE_URL'] = 'http://custom-ollama:9999';
    const fetchMock = ollamaFetch();
    vi.stubGlobal('fetch', fetchMock);

    await nativeQdrantIndex({
      namespace: 'test-ns',
      fileName: 'doc.txt',
      content: 'Hello.',
      qdrantUrl: QDRANT_URL,
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('http://custom-ollama:9999/api/embeddings');
  });

  it('calls OpenAI /v1/embeddings once per batch when LLM_PROVIDER=openai', async () => {
    process.env['LLM_PROVIDER'] = 'openai';
    process.env['OPENAI_API_KEY'] = 'test-key';
    process.env['OPENAI_EMBEDDING_MODEL'] = 'text-embedding-3-small';

    // 2 chunks → one batch call returning 2 embeddings
    const fetchMock = openAiFetch(2);
    vi.stubGlobal('fetch', fetchMock);

    await nativeQdrantIndex({
      namespace: 'test-ns',
      fileName: 'doc.txt',
      content: 'A'.repeat(1000), // 2 chunks
      qdrantUrl: QDRANT_URL,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('openai.com/v1/embeddings');
    const body = JSON.parse(opts.body as string) as { model: string; input: string[] };
    expect(body.model).toBe('text-embedding-3-small');
    expect(Array.isArray(body.input)).toBe(true);
    expect(body.input).toHaveLength(2);
  });

  it('includes Authorization header for OpenAI', async () => {
    process.env['LLM_PROVIDER'] = 'openai';
    process.env['OPENAI_API_KEY'] = 'sk-test';

    const fetchMock = openAiFetch(1);
    vi.stubGlobal('fetch', fetchMock);

    await nativeQdrantIndex({
      namespace: 'test-ns',
      fileName: 'doc.txt',
      content: 'Hello.',
      qdrantUrl: QDRANT_URL,
    });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
  });

  it('throws when the embedding API returns a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service Unavailable'),
    }));

    await expect(
      nativeQdrantIndex({
        namespace: 'test-ns',
        fileName: 'doc.txt',
        content: 'Some text here.',
        qdrantUrl: QDRANT_URL,
      }),
    ).rejects.toThrow(/embeddings error 503/);
  });
});

// ---------------------------------------------------------------------------
// Qdrant collection lifecycle
// ---------------------------------------------------------------------------

describe('nativeQdrantIndex — Qdrant collection', () => {
  it('creates the collection with COSINE distance on first ingest (404)', async () => {
    vi.stubGlobal('fetch', ollamaFetch(768));

    await nativeQdrantIndex({
      namespace: 'new-ns',
      fileName: 'doc.txt',
      content: 'Hello world.',
      qdrantUrl: QDRANT_URL,
    });

    expect(mockCreateCollection).toHaveBeenCalledWith(
      'new-ns',
      expect.objectContaining({
        vectors: expect.objectContaining({ size: 768, distance: 'Cosine' }),
      }),
    );
  });

  it('skips createCollection when the collection already exists', async () => {
    mockGetCollection.mockResolvedValueOnce({
      points_count: 5,
      config: { params: { vectors: { size: 768 } } },
    });
    vi.stubGlobal('fetch', ollamaFetch(768));

    await nativeQdrantIndex({
      namespace: 'existing-ns',
      fileName: 'doc.txt',
      content: 'Hello world.',
      qdrantUrl: QDRANT_URL,
    });

    expect(mockCreateCollection).not.toHaveBeenCalled();
  });

  it('throws when existing collection has mismatched embedding dimension', async () => {
    mockGetCollection.mockResolvedValueOnce({
      points_count: 10,
      config: { params: { vectors: { size: 1536 } } }, // existing: 1536
    });
    vi.stubGlobal('fetch', ollamaFetch(768)); // new embeddings: 768

    await expect(
      nativeQdrantIndex({
        namespace: 'dim-mismatch-ns',
        fileName: 'doc.txt',
        content: 'Hello world.',
        qdrantUrl: QDRANT_URL,
      }),
    ).rejects.toThrow(/dimension/);
  });

  it('calls upsert once per batch with correct collection name', async () => {
    vi.stubGlobal('fetch', ollamaFetch());

    await nativeQdrantIndex({
      namespace: 'my-ns',
      fileName: 'doc.txt',
      content: 'A'.repeat(1000), // 2 chunks → 1 batch
      qdrantUrl: QDRANT_URL,
    });

    expect(mockUpsert).toHaveBeenCalledWith('my-ns', expect.objectContaining({ wait: true }));
  });

  it('upsert points carry text and document in payload', async () => {
    vi.stubGlobal('fetch', ollamaFetch());

    await nativeQdrantIndex({
      namespace: 'ns',
      fileName: 'report.pdf',
      content: 'Some actual content.',
      qdrantUrl: QDRANT_URL,
    });

    const [, opts] = mockUpsert.mock.calls[0] as [string, { points: Array<{ payload: Record<string, unknown> }> }];
    expect(opts.points[0].payload['document']).toBe('report.pdf');
    expect(typeof opts.points[0].payload['text']).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// nativeQdrantDeleteNamespace
// ---------------------------------------------------------------------------

describe('nativeQdrantDeleteNamespace', () => {
  it('calls deleteCollection with the namespace name', async () => {
    await nativeQdrantDeleteNamespace(QDRANT_URL, 'target-ns');
    expect(mockDeleteCollection).toHaveBeenCalledWith('target-ns');
  });

  it('does not throw when deleteCollection rejects', async () => {
    mockDeleteCollection.mockRejectedValueOnce(new Error('collection not found'));
    await expect(nativeQdrantDeleteNamespace(QDRANT_URL, 'missing-ns')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// nativeQdrantNamespaceStats
// ---------------------------------------------------------------------------

describe('nativeQdrantNamespaceStats', () => {
  it('returns vectorCount from getCollection points_count', async () => {
    mockGetCollection.mockResolvedValueOnce({ points_count: 42 });

    const stats = await nativeQdrantNamespaceStats(QDRANT_URL, 'test-ns');
    expect(stats.vectorCount).toBe(42);
  });

  it('returns { vectorCount: 0 } when getCollection rejects (missing collection)', async () => {
    // Default mock already rejects with 404
    const stats = await nativeQdrantNamespaceStats(QDRANT_URL, 'missing-ns');
    expect(stats.vectorCount).toBe(0);
  });

  it('returns { vectorCount: 0 } when points_count is undefined', async () => {
    mockGetCollection.mockResolvedValueOnce({ points_count: undefined });
    const stats = await nativeQdrantNamespaceStats(QDRANT_URL, 'empty-ns');
    expect(stats.vectorCount).toBe(0);
  });
});
