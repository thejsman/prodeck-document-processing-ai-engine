import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClientMemoryService } from './client-memory.service.js';
import type { ClientMemory, DistillationResult } from './client-memory.types.js';
import type { NamespaceContext } from '../chat/context.types.js';
import os from 'node:os';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Mock memory-distiller so tests don't hit the LLM bridge
// ---------------------------------------------------------------------------
vi.mock('./memory-distiller.js', () => ({
  distill: vi.fn().mockResolvedValue({
    stableFields: {
      clientIndustry: { value: 'Fintech', confidence: 0.9 },
    },
    newKnowledge: [
      { content: 'Prefers phased delivery', category: 'preference', confidence: 0.85 },
    ],
    confirmedKnowledge: [],
    contradictions: [],
    stakeholders: [
      { name: 'Sarah Chen', role: 'CTO', notes: 'Budget approvals' },
    ],
  } satisfies DistillationResult),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeContext(clientName: string, projectType = 'platform-build'): NamespaceContext {
  return {
    namespace: 'test-ns',
    requirements: {
      fields: {
        clientName: { value: clientName, confidence: 1.0, source: 'user', updatedAt: '' },
        projectType: { value: projectType, confidence: 1.0, source: 'user', updatedAt: '' },
      },
      customFields: {},
    },
    knowledge: [],
    sources: [],
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let service: ClientMemoryService;

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), `cm-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  service = new ClientMemoryService(tmpDir);
});

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(service.slugify('Acme Corp')).toBe('acme-corp');
  });

  it('strips special characters', () => {
    expect(service.slugify('N&B Engineering, LLC')).toBe('n-b-engineering-llc');
  });

  it('trims leading and trailing dashes', () => {
    expect(service.slugify('  Trimmed  ')).toBe('trimmed');
  });

  it('collapses multiple non-alphanumeric chars into a single dash', () => {
    expect(service.slugify('Foo  -- Bar')).toBe('foo-bar');
  });
});

// ---------------------------------------------------------------------------
// createEmpty / get / save
// ---------------------------------------------------------------------------

describe('createEmpty', () => {
  it('creates a memory record with empty collections', async () => {
    const memory = await service.createEmpty('Acme Corp');

    expect(memory.clientSlug).toBe('acme-corp');
    expect(memory.clientName).toBe('Acme Corp');
    expect(memory.knowledge).toEqual([]);
    expect(memory.stakeholders).toEqual([]);
    expect(memory.engagements).toEqual([]);
    expect(memory.conflicts).toEqual([]);
    expect(memory.version).toBe(1);
  });

  it('persists to disk and is retrievable via get()', async () => {
    await service.createEmpty('Acme Corp');
    const retrieved = await service.get('acme-corp');
    expect(retrieved?.clientName).toBe('Acme Corp');
  });
});

describe('get', () => {
  it('returns null for an unknown client', async () => {
    const result = await service.get('unknown-client');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// prepopulate
// ---------------------------------------------------------------------------

describe('prepopulate', () => {
  it('returns found: false when no memory exists', async () => {
    const result = await service.prepopulate('no-such-client');
    expect(result.found).toBe(false);
    expect(result.knowledge).toEqual([]);
    expect(result.engagementCount).toBe(0);
  });

  it('returns found: true with fields and knowledge when memory exists', async () => {
    const now = new Date().toISOString();
    const memory: ClientMemory = {
      clientSlug: 'acme-corp',
      clientName: 'Acme Corp',
      clientIndustry: 'Fintech',
      stableFields: {
        clientIndustry: {
          value: 'Fintech',
          confidence: 0.9,
          sourceEngagements: ['eng-1'],
          firstSeenAt: now,
          lastConfirmedAt: now,
        },
      },
      knowledge: [
        {
          id: 'k1',
          content: 'Prefers phased delivery',
          category: 'preference',
          confidence: 0.85,
          sourceEngagements: ['eng-1'],
          firstSeenAt: now,
          lastConfirmedAt: now,
        },
        {
          id: 'k2',
          content: 'Old preference',
          category: 'preference',
          confidence: 0.8,
          sourceEngagements: ['eng-0'],
          firstSeenAt: now,
          lastConfirmedAt: now,
          supersededBy: 'k1',
        },
      ],
      stakeholders: [],
      engagements: [{ namespace: 'eng-1', projectType: 'rebuild', closedAt: now, fieldsContributed: [], knowledgeContributed: 1 }],
      conflicts: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await service.save('acme-corp', memory);

    const result = await service.prepopulate('acme-corp');

    expect(result.found).toBe(true);
    expect(result.stableFields.clientIndustry?.value).toBe('Fintech');
    expect(result.knowledge).toHaveLength(1); // superseded entry excluded
    expect(result.knowledge[0].id).toBe('k1');
    expect(result.engagementCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// distill
// ---------------------------------------------------------------------------

describe('distill', () => {
  it('creates a new memory record when none exists', async () => {
    const context = makeContext('Acme Corp');
    await service.distill('eng-1', context);

    const memory = await service.get('acme-corp');
    expect(memory).not.toBeNull();
    expect(memory!.clientName).toBe('Acme Corp');
  });

  it('writes industry from distillation stableFields', async () => {
    const context = makeContext('Acme Corp');
    await service.distill('eng-1', context);

    const memory = await service.get('acme-corp');
    expect(memory!.clientIndustry).toBe('Fintech');
    expect(memory!.stableFields.clientIndustry?.value).toBe('Fintech');
  });

  it('appends new knowledge entries', async () => {
    const context = makeContext('Acme Corp');
    await service.distill('eng-1', context);

    const memory = await service.get('acme-corp');
    expect(memory!.knowledge).toHaveLength(1);
    expect(memory!.knowledge[0].content).toBe('Prefers phased delivery');
  });

  it('merges new stakeholders', async () => {
    const context = makeContext('Acme Corp');
    await service.distill('eng-1', context);

    const memory = await service.get('acme-corp');
    expect(memory!.stakeholders).toHaveLength(1);
    expect(memory!.stakeholders[0].name).toBe('Sarah Chen');
  });

  it('appends an engagement summary', async () => {
    const context = makeContext('Acme Corp', 'platform-build');
    await service.distill('eng-1', context);

    const memory = await service.get('acme-corp');
    expect(memory!.engagements).toHaveLength(1);
    expect(memory!.engagements[0].namespace).toBe('eng-1');
    expect(memory!.engagements[0].projectType).toBe('platform-build');
  });

  it('does not duplicate engagement summary on second distill for same namespace', async () => {
    const context = makeContext('Acme Corp');
    await service.distill('eng-1', context);
    await service.distill('eng-1', context);

    const memory = await service.get('acme-corp');
    expect(memory!.engagements).toHaveLength(1);
  });

  it('returns a DistillResult summary', async () => {
    const context = makeContext('Acme Corp');
    const result = await service.distill('eng-1', context);

    expect(result.clientSlug).toBe('acme-corp');
    expect(result.fieldsUpdated).toBe(1);
    expect(result.knowledgeAdded).toBe(1);
    expect(result.stakeholdersUpdated).toBe(1);
  });

  it('throws when clientName is missing from context', async () => {
    const context = makeContext('');
    context.requirements.fields = {};
    await expect(service.distill('eng-1', context)).rejects.toThrow(
      'clientName not found in context',
    );
  });
});

// ---------------------------------------------------------------------------
// confidence compounding (via mergeDistillation)
// ---------------------------------------------------------------------------

describe('confidence compounding', () => {
  it('compounds confidence across two engagements for the same field', async () => {
    const context = makeContext('Acme Corp');

    // First distill — sets clientIndustry at 0.9
    await service.distill('eng-1', context);

    // Second distill — confirms at 0.9 again → should push toward 0.945
    await service.distill('eng-2', context);

    const memory = await service.get('acme-corp');
    const field = memory!.stableFields.clientIndustry;
    expect(field!.confidence).toBeGreaterThan(0.9);
    expect(field!.confidence).toBeLessThan(1.0);
    expect(field!.sourceEngagements).toContain('eng-1');
    expect(field!.sourceEngagements).toContain('eng-2');
  });
});

// ---------------------------------------------------------------------------
// resolveConflict
// ---------------------------------------------------------------------------

describe('resolveConflict', () => {
  async function seedWithConflict() {
    const now = new Date().toISOString();
    const memory: ClientMemory = {
      clientSlug: 'acme-corp',
      clientName: 'Acme Corp',
      clientIndustry: '',
      stableFields: {},
      knowledge: [
        {
          id: 'k1',
          content: 'Prefers React',
          category: 'preference',
          confidence: 0.85,
          sourceEngagements: ['eng-1'],
          firstSeenAt: now,
          lastConfirmedAt: now,
        },
      ],
      stakeholders: [],
      engagements: [],
      conflicts: [
        {
          id: 'c1',
          existingId: 'k1',
          existingContent: 'Prefers React',
          incomingContent: 'Migrating away from React',
          reason: 'Technology preference changed',
          status: 'needs_review',
          createdAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await service.save('acme-corp', memory);
  }

  it('keep_old marks conflict resolved without changing the entry', async () => {
    await seedWithConflict();
    await service.resolveConflict('acme-corp', 'c1', 'keep_old');

    const memory = await service.get('acme-corp');
    expect(memory!.conflicts[0].status).toBe('resolved');
    expect(memory!.conflicts[0].resolution).toBe('keep_old');
    expect(memory!.knowledge[0].content).toBe('Prefers React');
  });

  it('use_new replaces the existing entry content', async () => {
    await seedWithConflict();
    await service.resolveConflict('acme-corp', 'c1', 'use_new');

    const memory = await service.get('acme-corp');
    expect(memory!.knowledge[0].content).toBe('Migrating away from React');
    expect(memory!.conflicts[0].status).toBe('resolved');
  });

  it('keep_both adds a new knowledge entry with the incoming content', async () => {
    await seedWithConflict();
    await service.resolveConflict('acme-corp', 'c1', 'keep_both');

    const memory = await service.get('acme-corp');
    expect(memory!.knowledge).toHaveLength(2);
    expect(memory!.knowledge[1].content).toBe('Migrating away from React');
    expect(memory!.conflicts[0].status).toBe('resolved');
  });

  it('defer leaves the conflict as needs_review', async () => {
    await seedWithConflict();
    await service.resolveConflict('acme-corp', 'c1', 'defer');

    const memory = await service.get('acme-corp');
    expect(memory!.conflicts[0].status).toBe('needs_review');
  });
});

// ---------------------------------------------------------------------------
// CRUD — knowledge
// ---------------------------------------------------------------------------

describe('knowledge CRUD', () => {
  beforeEach(async () => {
    await service.createEmpty('Acme Corp');
  });

  it('addKnowledge creates an entry and persists it', async () => {
    const entry = await service.addKnowledge('acme-corp', 'SOC 2 required', 'constraint');
    expect(entry.id).toBeTruthy();
    expect(entry.confidence).toBe(1.0);

    const memory = await service.get('acme-corp');
    expect(memory!.knowledge).toHaveLength(1);
    expect(memory!.knowledge[0].content).toBe('SOC 2 required');
  });

  it('updateKnowledge changes the content', async () => {
    const entry = await service.addKnowledge('acme-corp', 'Old content', 'context');
    await service.updateKnowledge('acme-corp', entry.id, 'New content');

    const memory = await service.get('acme-corp');
    expect(memory!.knowledge[0].content).toBe('New content');
  });

  it('removeKnowledge deletes the entry', async () => {
    const entry = await service.addKnowledge('acme-corp', 'To delete', 'context');
    await service.removeKnowledge('acme-corp', entry.id);

    const memory = await service.get('acme-corp');
    expect(memory!.knowledge).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CRUD — stakeholders
// ---------------------------------------------------------------------------

describe('stakeholder CRUD', () => {
  beforeEach(async () => {
    await service.createEmpty('Acme Corp');
  });

  it('addStakeholder creates a record', async () => {
    const record = await service.addStakeholder('acme-corp', {
      name: 'Sarah Chen',
      role: 'CTO',
      notes: 'Budget approvals',
    });
    expect(record.id).toBeTruthy();

    const memory = await service.get('acme-corp');
    expect(memory!.stakeholders).toHaveLength(1);
    expect(memory!.stakeholders[0].name).toBe('Sarah Chen');
  });

  it('updateStakeholder changes fields', async () => {
    const record = await service.addStakeholder('acme-corp', { name: 'Sarah', role: 'VP' });
    await service.updateStakeholder('acme-corp', record.id, { role: 'CTO' });

    const memory = await service.get('acme-corp');
    expect(memory!.stakeholders[0].role).toBe('CTO');
  });

  it('removeStakeholder deletes the record', async () => {
    const record = await service.addStakeholder('acme-corp', { name: 'Sarah', role: 'CTO' });
    await service.removeStakeholder('acme-corp', record.id);

    const memory = await service.get('acme-corp');
    expect(memory!.stakeholders).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('list', () => {
  it('returns all client memory records', async () => {
    await service.createEmpty('Acme Corp');
    await service.createEmpty('N&B Engineering');

    const clients = await service.list();
    expect(clients).toHaveLength(2);
    const slugs = clients.map((c) => c.clientSlug);
    expect(slugs).toContain('acme-corp');
    expect(slugs).toContain('n-b-engineering');
  });

  it('returns empty array when no clients exist', async () => {
    const clients = await service.list();
    expect(clients).toEqual([]);
  });
});
