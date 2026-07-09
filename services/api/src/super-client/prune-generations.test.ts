import { describe, it, expect } from 'vitest';
import { pruneStaleGenerations, STALE_GENERATION_MS } from '../super-client-routes.js';

const NOW = Date.parse('2026-07-09T12:00:00.000Z');

function gen(overrides: Partial<Parameters<typeof pruneStaleGenerations>[0][number]>) {
  return {
    id: 'g1',
    clientSlug: 'cloud-9',
    type: 'slide' as const,
    phase: 'generating' as const,
    title: 'Presentation',
    steps: [],
    ...overrides,
  };
}

describe('pruneStaleGenerations', () => {
  it('drops a stale generating entry (older than the ceiling)', () => {
    const old = new Date(NOW - STALE_GENERATION_MS - 1000).toISOString();
    const result = pruneStaleGenerations([gen({ createdAt: old })], NOW);
    expect(result).toHaveLength(0);
  });

  it('keeps a fresh generating entry', () => {
    const recent = new Date(NOW - 30_000).toISOString();
    const result = pruneStaleGenerations([gen({ createdAt: recent })], NOW);
    expect(result).toHaveLength(1);
  });

  it('drops a generating entry with no timestamp', () => {
    const result = pruneStaleGenerations([gen({ createdAt: undefined })], NOW);
    expect(result).toHaveLength(0);
  });

  it('drops a generating entry with an unparseable timestamp', () => {
    const result = pruneStaleGenerations([gen({ createdAt: 'not-a-date' })], NOW);
    expect(result).toHaveLength(0);
  });

  it('always keeps terminal entries regardless of age', () => {
    const old = new Date(NOW - STALE_GENERATION_MS * 100).toISOString();
    const result = pruneStaleGenerations(
      [
        gen({ id: 'c', phase: 'complete', createdAt: old }),
        gen({ id: 'e', phase: 'error', createdAt: undefined }),
      ],
      NOW,
    );
    expect(result.map((g) => g.id)).toEqual(['c', 'e']);
  });
});
