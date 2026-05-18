import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock method refs — vi.hoisted ensures these are available inside vi.mock
// factories, which are hoisted above all other declarations.
// ---------------------------------------------------------------------------

const { mockSearch, mockResolveVectorStoreConfig } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
  mockResolveVectorStoreConfig: vi.fn(),
}));

// QdrantVectorStoreProvider must use a regular function (not arrow) to work as
// a constructor with `new`.
vi.mock('@ai-engine/runtime', () => ({
  QdrantVectorStoreProvider: vi.fn(function () {
    return { search: mockSearch };
  }),
}));

vi.mock('../ingestion/branch-runner.js', () => ({
  resolveVectorStoreConfig: mockResolveVectorStoreConfig,
}));

// ---------------------------------------------------------------------------
// Import after mock declarations (vi.mock is hoisted so order is safe).
// ---------------------------------------------------------------------------

import { retrieveProposalContext } from './proposal-rag.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hit(text: string, score: number, fileName?: string) {
  return { text, score, metadata: fileName ? { fileName } : {} };
}

const QDRANT_CONFIG = { type: 'qdrant' as const, url: 'http://localhost:6333', apiKey: undefined };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('retrieveProposalContext', () => {
  describe('returns null without querying when not on qdrant', () => {
    it('returns null when resolveVectorStoreConfig returns undefined', async () => {
      mockResolveVectorStoreConfig.mockResolvedValue(undefined);

      const result = await retrieveProposalContext('/wd', 'ns', 'Acme', 'Finance');

      expect(result).toBeNull();
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('returns null when vector store type is faiss', async () => {
      mockResolveVectorStoreConfig.mockResolvedValue({ type: 'faiss', url: '', apiKey: undefined });

      const result = await retrieveProposalContext('/wd', 'ns', 'Acme', 'Finance');

      expect(result).toBeNull();
      expect(mockSearch).not.toHaveBeenCalled();
    });
  });

  describe('returns null gracefully on failure', () => {
    it('returns null when resolveVectorStoreConfig throws', async () => {
      mockResolveVectorStoreConfig.mockRejectedValue(new Error('network error'));

      const result = await retrieveProposalContext('/wd', 'ns', 'Acme', 'Finance');

      expect(result).toBeNull();
    });

    it('returns empty array when all 4 searches return empty arrays', async () => {
      mockResolveVectorStoreConfig.mockResolvedValue(QDRANT_CONFIG);
      mockSearch.mockResolvedValue([]);

      const result = await retrieveProposalContext('/wd', 'ns', 'Acme', 'Finance');

      // [] is falsy in Python — processor treats it the same as null (falls back to raw_context).
      expect(result).toEqual([]);
    });
  });

  describe('fires 4 parallel search queries', () => {
    it('calls search exactly 4 times with the namespace', async () => {
      mockResolveVectorStoreConfig.mockResolvedValue(QDRANT_CONFIG);
      mockSearch.mockResolvedValue([hit('chunk a', 0.8)]);

      await retrieveProposalContext('/wd', 'my-ns', 'Acme Corp', 'Finance');

      expect(mockSearch).toHaveBeenCalledTimes(4);
      for (const call of mockSearch.mock.calls) {
        expect(call[0].namespace).toBe('my-ns');
        expect(call[0].topK).toBe(8);
      }
    });

    it('includes client name and industry in the queries', async () => {
      mockResolveVectorStoreConfig.mockResolvedValue(QDRANT_CONFIG);
      mockSearch.mockResolvedValue([]);

      await retrieveProposalContext('/wd', 'ns', 'Jim Smith', 'Marine');

      const queries: string[] = mockSearch.mock.calls.map((c) => c[0].filter.query as string);
      expect(queries.some((q) => q.includes('Jim Smith'))).toBe(true);
      expect(queries.some((q) => q.includes('Marine'))).toBe(true);
    });
  });

  describe('deduplication', () => {
    it('deduplicates chunks with identical text across queries', async () => {
      mockResolveVectorStoreConfig.mockResolvedValue(QDRANT_CONFIG);
      // All 4 queries return the same chunk.
      mockSearch.mockResolvedValue([hit('shared chunk', 0.9, 'doc.pdf')]);

      const result = await retrieveProposalContext('/wd', 'ns', 'Acme', 'Finance');

      expect(result).toHaveLength(1);
      expect(result![0].text).toBe('shared chunk');
    });

    it('keeps distinct chunks from different queries', async () => {
      mockResolveVectorStoreConfig.mockResolvedValue(QDRANT_CONFIG);
      mockSearch
        .mockResolvedValueOnce([hit('chunk A', 0.9)])
        .mockResolvedValueOnce([hit('chunk B', 0.8)])
        .mockResolvedValueOnce([hit('chunk C', 0.7)])
        .mockResolvedValueOnce([hit('chunk D', 0.6)]);

      const result = await retrieveProposalContext('/wd', 'ns', 'Acme', 'Finance');

      expect(result).toHaveLength(4);
    });
  });

  describe('sorting and capping', () => {
    it('returns chunks sorted by score descending', async () => {
      mockResolveVectorStoreConfig.mockResolvedValue(QDRANT_CONFIG);
      mockSearch
        .mockResolvedValueOnce([hit('low', 0.3), hit('high', 0.9)])
        .mockResolvedValueOnce([hit('mid', 0.6)])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await retrieveProposalContext('/wd', 'ns', 'Acme', 'Finance');

      expect(result![0].score).toBe(0.9);
      expect(result![1].score).toBe(0.6);
      expect(result![2].score).toBe(0.3);
    });

    it('caps results at 30 chunks', async () => {
      mockResolveVectorStoreConfig.mockResolvedValue(QDRANT_CONFIG);
      // Return 10 unique chunks per query = 40 total, expect cap at 30.
      mockSearch.mockImplementation(async () =>
        Array.from({ length: 10 }, (_, i) => hit(`chunk-${Math.random()}-${i}`, Math.random()))
      );

      const result = await retrieveProposalContext('/wd', 'ns', 'Acme', 'Finance');

      expect(result!.length).toBeLessThanOrEqual(30);
    });
  });

  describe('partial query failure (Promise.allSettled)', () => {
    it('returns results from successful queries when one query rejects', async () => {
      mockResolveVectorStoreConfig.mockResolvedValue(QDRANT_CONFIG);
      mockSearch
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce([hit('good chunk', 0.85, 'report.pdf')])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await retrieveProposalContext('/wd', 'ns', 'Acme', 'Finance');

      expect(result).toHaveLength(1);
      expect(result![0].text).toBe('good chunk');
      expect(result![0].document).toBe('report.pdf');
    });

    it('returns empty array when all queries reject', async () => {
      mockResolveVectorStoreConfig.mockResolvedValue(QDRANT_CONFIG);
      mockSearch.mockRejectedValue(new Error('qdrant down'));

      const result = await retrieveProposalContext('/wd', 'ns', 'Acme', 'Finance');

      // allSettled absorbs rejections; [] is falsy in Python so processor falls back to raw_context.
      expect(result).toEqual([]);
    });
  });

  describe('chunk shape', () => {
    it('maps hit fields to RetrievedChunk correctly', async () => {
      mockResolveVectorStoreConfig.mockResolvedValue(QDRANT_CONFIG);
      mockSearch
        .mockResolvedValueOnce([hit('chunk text', 0.77, 'brief.pdf')])
        .mockResolvedValue([]);

      const result = await retrieveProposalContext('/wd', 'ns', 'Acme', 'Finance');

      expect(result).toHaveLength(1);
      expect(result![0]).toEqual({ text: 'chunk text', score: 0.77, document: 'brief.pdf' });
    });

    it('omits document field when fileName is absent from metadata', async () => {
      mockResolveVectorStoreConfig.mockResolvedValue(QDRANT_CONFIG);
      mockSearch
        .mockResolvedValueOnce([hit('chunk text', 0.5)])
        .mockResolvedValue([]);

      const result = await retrieveProposalContext('/wd', 'ns', 'Acme', 'Finance');

      expect(result![0].document).toBeUndefined();
    });
  });
});
