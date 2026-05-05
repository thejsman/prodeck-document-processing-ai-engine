import { describe, it, expect } from 'vitest';
import { detectConflicts } from './conflict-detector.js';
import type { RequirementField, NamespaceContext } from '../chat/context.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function field<T>(value: T, confidence = 0.9, sourceFile?: string): RequirementField<unknown> {
  return {
    value,
    confidence,
    source: 'document',
    updatedAt: new Date().toISOString(),
    ...(sourceFile ? { sourceFile } : {}),
  };
}

function makeContext(
  fields: Partial<Record<string, RequirementField<unknown>>>,
): NamespaceContext {
  return {
    namespace: 'test',
    requirements: { fields: fields as NamespaceContext['requirements']['fields'] },
    knowledge: [],
    sources: [],
    lastUpdated: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// No-conflict cases
// ---------------------------------------------------------------------------

describe('detectConflicts — no conflicts', () => {
  it('returns empty array when existing is null', () => {
    const incoming = { clientName: field('Acme Corp') };
    expect(detectConflicts(incoming, null, 'new.pdf')).toEqual([]);
  });

  it('returns empty array when incoming field has no existing counterpart', () => {
    const existing = makeContext({ clientIndustry: field('Healthcare') });
    const incoming = { clientName: field('Acme Corp') };
    expect(detectConflicts(incoming, existing, 'new.pdf')).toEqual([]);
  });

  it('returns empty array when incoming and existing values are identical', () => {
    const existing = makeContext({ clientName: field('Acme Corp') });
    const incoming = { clientName: field('Acme Corp') };
    expect(detectConflicts(incoming, existing, 'new.pdf')).toEqual([]);
  });

  it('skips existing field marked pendingConfirmation', () => {
    const pendingField: RequirementField<unknown> = {
      ...field('Old Name'),
      pendingConfirmation: true,
    };
    const existing = makeContext({ clientName: pendingField });
    const incoming = { clientName: field('New Name') };
    expect(detectConflicts(incoming, existing, 'new.pdf')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

describe('detectConflicts — produces conflicts', () => {
  it('detects a conflict when values differ', () => {
    const existing = makeContext({ clientName: field('Acme Corp', 0.9, 'old.pdf') });
    const incoming = { clientName: field('Globex Inc', 0.85) };
    const conflicts = detectConflicts(incoming, existing, 'new.pdf');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].key).toBe('clientName');
    expect(conflicts[0].incomingValue).toBe('Globex Inc');
    expect(conflicts[0].existingValue).toBe('Acme Corp');
    expect(conflicts[0].incomingSourceFile).toBe('new.pdf');
    expect(conflicts[0].existingSourceFile).toBe('old.pdf');
  });

  it('detects multiple conflicts across different fields', () => {
    const existing = makeContext({
      clientName: field('Acme'),
      clientIndustry: field('Finance'),
    });
    const incoming = {
      clientName: field('Globex'),
      clientIndustry: field('Healthcare'),
    };
    const conflicts = detectConflicts(incoming, existing, 'new.pdf');
    expect(conflicts).toHaveLength(2);
  });

  it('includes incomingConfidence and existingConfidence', () => {
    const existing = makeContext({ clientName: field('Acme', 0.95) });
    const incoming = { clientName: field('Globex', 0.7) };
    const conflicts = detectConflicts(incoming, existing, 'new.pdf');
    expect(conflicts[0].incomingConfidence).toBe(0.7);
    expect(conflicts[0].existingConfidence).toBe(0.95);
  });
});

// ---------------------------------------------------------------------------
// Tier 1 sort order
// ---------------------------------------------------------------------------

describe('detectConflicts — tier 1 sort', () => {
  it('sorts Tier 1 keys (clientName, clientIndustry, projectType) before others', () => {
    const existing = makeContext({
      clientName: field('Acme'),
      clientIndustry: field('Finance'),
      budget: field('$100k'),
    });
    const incoming = {
      budget: field('$200k'),
      clientName: field('Globex'),
      clientIndustry: field('Healthcare'),
    };
    const conflicts = detectConflicts(incoming, existing, 'new.pdf');
    const keys = conflicts.map((c) => c.key);
    // clientName and clientIndustry are Tier 1 — they must come before budget
    const budgetIdx = keys.indexOf('budget');
    const clientNameIdx = keys.indexOf('clientName');
    const industryIdx = keys.indexOf('clientIndustry');
    expect(clientNameIdx).toBeLessThan(budgetIdx);
    expect(industryIdx).toBeLessThan(budgetIdx);
  });
});

// ---------------------------------------------------------------------------
// Array value equality
// ---------------------------------------------------------------------------

describe('detectConflicts — array value equality', () => {
  it('treats identical arrays as no conflict', () => {
    const existing = makeContext({ keyStakeholders: field(['Alice', 'Bob']) });
    const incoming = { keyStakeholders: field(['Alice', 'Bob']) };
    expect(detectConflicts(incoming, existing, 'new.pdf')).toHaveLength(0);
  });

  it('detects conflict when array values differ', () => {
    const existing = makeContext({ keyStakeholders: field(['Alice']) });
    const incoming = { keyStakeholders: field(['Alice', 'Bob']) };
    expect(detectConflicts(incoming, existing, 'new.pdf')).toHaveLength(1);
  });
});
