import { describe, it, expect } from 'vitest';
import { detectMemoryConflicts } from './conflict-detector.js';
import type { ClientKnowledgeEntry } from './client-memory.types.js';

function makeEntry(id: string, content: string): ClientKnowledgeEntry {
  const now = new Date().toISOString();
  return {
    id,
    content,
    category: 'preference',
    confidence: 0.85,
    sourceEngagements: ['eng-1'],
    firstSeenAt: now,
    lastConfirmedAt: now,
  };
}

describe('detectMemoryConflicts', () => {
  const NOW = '2026-05-06T00:00:00.000Z';

  it('returns an empty array when no contradictions are provided', () => {
    const result = detectMemoryConflicts([], [], NOW);
    expect(result).toEqual([]);
  });

  it('creates a MemoryConflict for each contradiction', () => {
    const existing = [makeEntry('k1', 'Prefers React')];
    const contradictions = [
      {
        existingId: 'k1',
        incomingContent: 'Migrating away from React',
        reason: 'Technology preference reversed',
      },
    ];

    const conflicts = detectMemoryConflicts(contradictions, existing, NOW);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].existingId).toBe('k1');
    expect(conflicts[0].existingContent).toBe('Prefers React');
    expect(conflicts[0].incomingContent).toBe('Migrating away from React');
    expect(conflicts[0].reason).toBe('Technology preference reversed');
    expect(conflicts[0].status).toBe('needs_review');
    expect(conflicts[0].createdAt).toBe(NOW);
    expect(conflicts[0].id).toBeTruthy();
  });

  it('falls back to "(unknown)" when existingId does not match any entry', () => {
    const conflicts = detectMemoryConflicts(
      [{ existingId: 'missing', incomingContent: 'New fact', reason: 'reason' }],
      [],
      NOW,
    );

    expect(conflicts[0].existingContent).toBe('(unknown)');
  });

  it('assigns a unique id to each conflict', () => {
    const existing = [makeEntry('k1', 'A'), makeEntry('k2', 'B')];
    const contradictions = [
      { existingId: 'k1', incomingContent: 'A2', reason: 'r1' },
      { existingId: 'k2', incomingContent: 'B2', reason: 'r2' },
    ];

    const conflicts = detectMemoryConflicts(contradictions, existing, NOW);

    expect(conflicts[0].id).not.toBe(conflicts[1].id);
  });
});
