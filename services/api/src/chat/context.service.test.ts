import { describe, it, expect, beforeEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ContextService, mergeField, mergeArrayField } from './context.service.js';
import type { KnowledgeEntry, RequirementField } from './context.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkdir(): string {
  return path.join(tmpdir(), `context-service-test-${randomUUID()}`);
}

function field<T>(value: T, confidence: number, source: 'user' | 'document' | 'inferred'): RequirementField<T> {
  return { value, confidence, source, updatedAt: new Date().toISOString() };
}

function entry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: randomUUID(),
    content: 'The client requires SOC 2 compliance certification',
    category: 'requirement',
    source: { type: 'document' },
    extractedAt: new Date().toISOString(),
    confidence: 0.8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mergeField
// ---------------------------------------------------------------------------

describe('mergeField', () => {
  it('returns incoming when no existing', () => {
    const incoming = field('Acme Corp', 0.9, 'document');
    expect(mergeField(undefined, incoming)).toBe(incoming);
  });

  it('user-stated overwrites document-extracted regardless of confidence', () => {
    const existing = field('Old Name', 0.95, 'document');
    const incoming = field('New Name', 0.3, 'user');
    expect(mergeField(existing, incoming)).toBe(incoming);
  });

  it('document does NOT overwrite user-stated', () => {
    const existing = field('User Name', 0.5, 'user');
    const incoming = field('Doc Name', 0.99, 'document');
    expect(mergeField(existing, incoming)).toBe(existing);
  });

  it('higher confidence wins when both are same source', () => {
    const existing = field('Low Confidence', 0.5, 'document');
    const incoming = field('High Confidence', 0.9, 'document');
    expect(mergeField(existing, incoming)).toBe(incoming);
  });

  it('keeps existing when incoming has lower confidence (same source)', () => {
    const existing = field('Good', 0.8, 'document');
    const incoming = field('Worse', 0.4, 'document');
    expect(mergeField(existing, incoming)).toBe(existing);
  });
});

// ---------------------------------------------------------------------------
// mergeArrayField
// ---------------------------------------------------------------------------

describe('mergeArrayField', () => {
  it('returns incoming when no existing', () => {
    const incoming = field(['React', 'Node'], 0.8, 'document');
    expect(mergeArrayField(undefined, incoming)).toBe(incoming);
  });

  it('union-deduplicates values', () => {
    const existing = field(['React', 'Node'], 0.7, 'document');
    const incoming = field(['Node', 'PostgreSQL'], 0.8, 'document');
    const result = mergeArrayField(existing, incoming);
    expect(result.value).toEqual(expect.arrayContaining(['React', 'Node', 'PostgreSQL']));
    expect(result.value).toHaveLength(3);
  });

  it('takes max confidence from both sides', () => {
    const existing = field(['a'], 0.9, 'document');
    const incoming = field(['b'], 0.6, 'document');
    expect(mergeArrayField(existing, incoming).confidence).toBe(0.9);
  });

  it('incoming user source promotes merged result to user', () => {
    const existing = field(['a'], 0.9, 'document');
    const incoming = field(['b'], 0.5, 'user');
    expect(mergeArrayField(existing, incoming).source).toBe('user');
  });

  it('keeps existing source when incoming is not user', () => {
    const existing = field(['a'], 0.9, 'user');
    const incoming = field(['b'], 0.5, 'document');
    expect(mergeArrayField(existing, incoming).source).toBe('user');
  });
});

// ---------------------------------------------------------------------------
// ContextService.get
// ---------------------------------------------------------------------------

describe('ContextService.get', () => {
  it('returns null for a missing namespace', async () => {
    const svc = new ContextService(makeWorkdir());
    expect(await svc.get('nonexistent')).toBeNull();
  });

  it('returns the saved context after save', async () => {
    const workdir = makeWorkdir();
    const svc = new ContextService(workdir);
    await svc.reset('acme');
    const result = await svc.get('acme');
    expect(result).not.toBeNull();
    expect(result?.namespace).toBe('acme');
    expect(result?.version).toBe(0);
    await rm(workdir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// ContextService.mergeRequirements
// ---------------------------------------------------------------------------

describe('ContextService.mergeRequirements', () => {
  let workdir: string;
  let svc: ContextService;

  beforeEach(async () => {
    workdir = makeWorkdir();
    await mkdir(workdir, { recursive: true });
    svc = new ContextService(workdir);
  });

  it('version increments on each merge', async () => {
    const r1 = await svc.mergeRequirements('ns', { clientName: field('Acme', 0.8, 'document') });
    expect(r1.version).toBe(1);
    const r2 = await svc.mergeRequirements('ns', { clientName: field('Acme', 0.9, 'document') });
    expect(r2.version).toBe(2);
    await rm(workdir, { recursive: true, force: true });
  });

  it('user source overwrites document source', async () => {
    await svc.mergeRequirements('ns', { clientName: field('Doc Name', 0.95, 'document') });
    const result = await svc.mergeRequirements('ns', { clientName: field('User Name', 0.3, 'user') });
    expect((result.requirements.fields.clientName as RequirementField<string>).value).toBe('User Name');
    await rm(workdir, { recursive: true, force: true });
  });

  it('document does not overwrite user source', async () => {
    await svc.mergeRequirements('ns', { clientName: field('User Name', 0.5, 'user') });
    const result = await svc.mergeRequirements('ns', { clientName: field('Doc Name', 0.99, 'document') });
    expect((result.requirements.fields.clientName as RequirementField<string>).value).toBe('User Name');
    await rm(workdir, { recursive: true, force: true });
  });

  it('array fields are union-merged (ARRAY_FIELDS)', async () => {
    await svc.mergeRequirements('ns', { technicalStack: field(['React'], 0.8, 'document') });
    const result = await svc.mergeRequirements('ns', { technicalStack: field(['Node', 'React'], 0.7, 'document') });
    const stack = (result.requirements.fields.technicalStack as RequirementField<string[]>).value;
    expect(stack).toEqual(expect.arrayContaining(['React', 'Node']));
    expect(stack).toHaveLength(2); // no duplicates
    await rm(workdir, { recursive: true, force: true });
  });

  it('appends source to sources array when provided', async () => {
    const src = {
      fileName: 'rfp.pdf',
      documentType: 'rfp' as const,
      extractedAt: new Date().toISOString(),
      fieldsExtracted: ['clientName' as const],
      knowledgeEntriesCreated: 0,
      preprocessConfidence: 0.9,
    };
    const result = await svc.mergeRequirements('ns', {}, src);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].fileName).toBe('rfp.pdf');
    await rm(workdir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// ContextService.mergeKnowledge
// ---------------------------------------------------------------------------

describe('ContextService.mergeKnowledge', () => {
  let workdir: string;
  let svc: ContextService;

  beforeEach(async () => {
    workdir = makeWorkdir();
    await mkdir(workdir, { recursive: true });
    svc = new ContextService(workdir);
  });

  it('version increments on merge', async () => {
    const result = await svc.mergeKnowledge('ns', [entry()]);
    expect(result.version).toBe(1);
    await rm(workdir, { recursive: true, force: true });
  });

  it('adds non-duplicate entries', async () => {
    const e1 = entry({ content: 'Client needs SOC 2 compliance' });
    const e2 = entry({ content: 'Budget is approximately one million dollars for the project' });
    const result = await svc.mergeKnowledge('ns', [e1, e2]);
    expect(result.knowledge).toHaveLength(2);
    await rm(workdir, { recursive: true, force: true });
  });

  it('duplicate detection: higher confidence wins and lower gets supersededBy', async () => {
    const existing = entry({ id: 'old', content: 'The client requires SOC 2 compliance', confidence: 0.6 });
    await svc.mergeKnowledge('ns', [existing]);

    const newer = entry({ id: 'new', content: 'client requires SOC 2 compliance certification', confidence: 0.9 });
    const result = await svc.mergeKnowledge('ns', [newer]);

    const old = result.knowledge.find((k) => k.id === 'old');
    expect(old?.supersededBy).toBe('new');
    expect(result.knowledge.some((k) => k.id === 'new')).toBe(true);
    await rm(workdir, { recursive: true, force: true });
  });

  it('duplicate: lower confidence incoming is discarded (existing kept)', async () => {
    const existing = entry({ id: 'orig', content: 'The client requires SOC 2 compliance', confidence: 0.9 });
    await svc.mergeKnowledge('ns', [existing]);

    const worse = entry({ id: 'worse', content: 'client requires SOC 2 compliance certification', confidence: 0.4 });
    const result = await svc.mergeKnowledge('ns', [worse]);

    // 'orig' should NOT be superseded, 'worse' should not be added as active
    const orig = result.knowledge.find((k) => k.id === 'orig');
    expect(orig?.supersededBy).toBeUndefined();
    // 'worse' was discarded, only 'orig' present
    expect(result.knowledge.filter((k) => !k.supersededBy)).toHaveLength(1);
    await rm(workdir, { recursive: true, force: true });
  });

  it('caps active entries at 200 and evicts lowest confidence', async () => {
    // Fill with 200 entries at confidence 0.5 — each has a UUID in content
    // so Jaccard similarity between any two is effectively 0 (no deduplication)
    const base = Array.from({ length: 200 }, () =>
      entry({
        id: randomUUID(),
        content: randomUUID(), // guaranteed unique, no word overlap
        category: 'context',
        confidence: 0.5,
      }),
    );
    await svc.mergeKnowledge('ns', base);

    // Add one more at higher confidence — should evict one of the base entries
    const extra = entry({
      id: 'extra',
      content: randomUUID(), // guaranteed no overlap with base entries
      category: 'context',
      confidence: 0.9,
    });
    const result = await svc.mergeKnowledge('ns', [extra]);

    const active = result.knowledge.filter((k) => !k.supersededBy);
    expect(active.length).toBeLessThanOrEqual(200);

    const evicted = result.knowledge.filter((k) => k.supersededBy === 'evicted');
    expect(evicted.length).toBeGreaterThanOrEqual(1);
    await rm(workdir, { recursive: true, force: true });
  }, 10000);
});

// ---------------------------------------------------------------------------
// ContextService.reset
// ---------------------------------------------------------------------------

describe('ContextService.reset', () => {
  it('clears context back to empty version 0', async () => {
    const workdir = makeWorkdir();
    const svc = new ContextService(workdir);
    await svc.mergeKnowledge('ns', [entry()]);
    await svc.reset('ns');
    const result = await svc.get('ns');
    expect(result?.version).toBe(0);
    expect(result?.knowledge).toHaveLength(0);
    await rm(workdir, { recursive: true, force: true });
  });
});
