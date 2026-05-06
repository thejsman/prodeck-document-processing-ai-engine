import crypto from 'node:crypto';
import type { ClientKnowledgeEntry, MemoryConflict } from './client-memory.types.js';

interface IncomingContradiction {
  existingId: string;
  incomingContent: string;
  reason: string;
}

export function detectMemoryConflicts(
  contradictions: IncomingContradiction[],
  existingKnowledge: ClientKnowledgeEntry[],
  now: string,
): MemoryConflict[] {
  return contradictions.map((c) => {
    const existing = existingKnowledge.find((k) => k.id === c.existingId);
    return {
      id: crypto.randomUUID(),
      existingId: c.existingId,
      existingContent: existing?.content ?? '(unknown)',
      incomingContent: c.incomingContent,
      reason: c.reason,
      status: 'needs_review' as const,
      createdAt: now,
    };
  });
}
