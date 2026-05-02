import { describe, it, expect } from 'vitest';
import { validateExtractionResults, KnowledgeEntrySchema } from './extraction-validator.js';
import { VALID_REQUIREMENT_KEYS } from './requirement-extractor.js';
import type { KnowledgeEntry, RequirementField } from '../chat/context.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeField(overrides?: Partial<RequirementField<unknown>>): RequirementField<unknown> {
  return {
    value: 'Acme Corp',
    confidence: 0.85,
    source: 'document',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeKnowledgeEntry(overrides?: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    id: 'test-uuid',
    content: 'The client requires a mobile-first design for all deliverables.',
    category: 'requirement',
    source: { type: 'document', fileName: 'rfp.txt' },
    extractedAt: new Date().toISOString(),
    confidence: 0.7,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// KnowledgeEntrySchema
// ---------------------------------------------------------------------------

describe('KnowledgeEntrySchema', () => {
  it('accepts a valid knowledge entry', () => {
    const result = KnowledgeEntrySchema.safeParse({
      content: 'The client needs a mobile-first UI.',
      category: 'requirement',
      confidence: 0.7,
    });
    expect(result.success).toBe(true);
  });

  it('rejects content shorter than 5 chars', () => {
    const result = KnowledgeEntrySchema.safeParse({
      content: 'Hi',
      category: 'requirement',
      confidence: 0.7,
    });
    expect(result.success).toBe(false);
  });

  it('rejects content longer than 500 chars', () => {
    const result = KnowledgeEntrySchema.safeParse({
      content: 'A'.repeat(501),
      category: 'requirement',
      confidence: 0.7,
    });
    expect(result.success).toBe(false);
  });

  it('accepts content exactly 5 chars', () => {
    const result = KnowledgeEntrySchema.safeParse({
      content: 'Hello',
      category: 'context',
      confidence: 0.5,
    });
    expect(result.success).toBe(true);
  });

  it('accepts content exactly 500 chars', () => {
    const result = KnowledgeEntrySchema.safeParse({
      content: 'A'.repeat(500),
      category: 'context',
      confidence: 0.5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid category', () => {
    const result = KnowledgeEntrySchema.safeParse({
      content: 'The client uses Salesforce.',
      category: 'note',
      confidence: 0.7,
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid categories', () => {
    const categories = [
      'requirement',
      'preference',
      'constraint',
      'context',
      'history',
      'concern',
      'decision',
      'action_item',
      'relationship',
    ] as const;
    for (const category of categories) {
      const result = KnowledgeEntrySchema.safeParse({
        content: 'Some relevant fact about the project.',
        category,
        confidence: 0.7,
      });
      expect(result.success, `category "${category}" should be valid`).toBe(true);
    }
  });

  it('rejects confidence below 0.3', () => {
    const result = KnowledgeEntrySchema.safeParse({
      content: 'The client is in the healthcare sector.',
      category: 'context',
      confidence: 0.29,
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence above 1.0', () => {
    const result = KnowledgeEntrySchema.safeParse({
      content: 'The client is in the healthcare sector.',
      category: 'context',
      confidence: 1.01,
    });
    expect(result.success).toBe(false);
  });

  it('accepts confidence exactly 0.3', () => {
    const result = KnowledgeEntrySchema.safeParse({
      content: 'Something inferred from context.',
      category: 'preference',
      confidence: 0.3,
    });
    expect(result.success).toBe(true);
  });

  it('accepts confidence exactly 1.0', () => {
    const result = KnowledgeEntrySchema.safeParse({
      content: 'The client explicitly confirmed the budget.',
      category: 'decision',
      confidence: 1.0,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateExtractionResults — requirement fields
// ---------------------------------------------------------------------------

describe('validateExtractionResults — requirement fields', () => {
  it('passes through valid fields unchanged', () => {
    const fields = { clientName: makeField({ value: 'Acme Corp' }) };
    const { validFields, errors } = validateExtractionResults(fields, []);
    expect(validFields.clientName).toBeDefined();
    expect(errors).toHaveLength(0);
  });

  it('drops unknown requirement keys and records an error', () => {
    const fields = {
      clientName: makeField(),
      unknownKey: makeField({ value: 'something' }),
    } as Record<string, RequirementField<unknown>>;
    const { validFields, errors } = validateExtractionResults(fields, []);
    expect(Object.keys(validFields)).not.toContain('unknownKey');
    expect(errors.some((e) => e.includes('Unknown requirement key'))).toBe(true);
  });

  it('drops fields with null value and records an error', () => {
    const fields = { clientName: makeField({ value: null }) };
    const { validFields, errors } = validateExtractionResults(fields, []);
    expect(validFields.clientName).toBeUndefined();
    expect(errors.some((e) => e.includes('Empty value'))).toBe(true);
  });

  it('drops fields with undefined value and records an error', () => {
    const fields = { clientIndustry: makeField({ value: undefined }) };
    const { validFields, errors } = validateExtractionResults(fields, []);
    expect(validFields.clientIndustry).toBeUndefined();
    expect(errors.some((e) => e.includes('Empty value'))).toBe(true);
  });

  it('drops fields with empty string value and records an error', () => {
    const fields = { projectType: makeField({ value: '' }) };
    const { validFields, errors } = validateExtractionResults(fields, []);
    expect(validFields.projectType).toBeUndefined();
    expect(errors.some((e) => e.includes('Empty value'))).toBe(true);
  });

  it('accepts all valid VALID_REQUIREMENT_KEYS', () => {
    const fields = Object.fromEntries(
      VALID_REQUIREMENT_KEYS.map((key) => [key, makeField({ value: 'some value' })]),
    );
    const { validFields, errors } = validateExtractionResults(fields, []);
    expect(Object.keys(validFields)).toHaveLength(VALID_REQUIREMENT_KEYS.length);
    expect(errors).toHaveLength(0);
  });

  it('accepts array values (e.g. technicalStack)', () => {
    const fields = {
      technicalStack: makeField({ value: ['React', 'Node.js'] }),
    };
    const { validFields, errors } = validateExtractionResults(fields, []);
    expect(validFields.technicalStack).toBeDefined();
    expect(errors).toHaveLength(0);
  });

  it('returns empty validFields and no errors for empty input', () => {
    const { validFields, errors } = validateExtractionResults({}, []);
    expect(Object.keys(validFields)).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('handles mix of valid and invalid fields', () => {
    const fields = {
      clientName: makeField({ value: 'Acme' }),
      bogusField: makeField({ value: 'x' }),
      budget: makeField({ value: null }),
    } as Record<string, RequirementField<unknown>>;
    const { validFields, errors } = validateExtractionResults(fields, []);
    expect(Object.keys(validFields)).toEqual(['clientName']);
    expect(errors).toHaveLength(2); // bogusField + budget
  });
});

// ---------------------------------------------------------------------------
// validateExtractionResults — knowledge entries
// ---------------------------------------------------------------------------

describe('validateExtractionResults — knowledge entries', () => {
  it('passes through valid knowledge entries unchanged', () => {
    const entry = makeKnowledgeEntry();
    const { validKnowledge, errors } = validateExtractionResults({}, [entry]);
    expect(validKnowledge).toHaveLength(1);
    expect(validKnowledge[0]).toBe(entry);
    expect(errors).toHaveLength(0);
  });

  it('drops entries with content too short', () => {
    const entry = makeKnowledgeEntry({ content: 'Hi' });
    const { validKnowledge, errors } = validateExtractionResults({}, [entry]);
    expect(validKnowledge).toHaveLength(0);
    expect(errors.some((e) => e.includes('Invalid knowledge entry'))).toBe(true);
  });

  it('drops entries with content too long', () => {
    const entry = makeKnowledgeEntry({ content: 'A'.repeat(501) });
    const { validKnowledge, errors } = validateExtractionResults({}, [entry]);
    expect(validKnowledge).toHaveLength(0);
    expect(errors.some((e) => e.includes('Invalid knowledge entry'))).toBe(true);
  });

  it('drops entries with invalid category', () => {
    const entry = makeKnowledgeEntry({ category: 'note' as never });
    const { validKnowledge, errors } = validateExtractionResults({}, [entry]);
    expect(validKnowledge).toHaveLength(0);
    expect(errors.some((e) => e.includes('Invalid knowledge entry'))).toBe(true);
  });

  it('drops entries with confidence below 0.3', () => {
    const entry = makeKnowledgeEntry({ confidence: 0.1 });
    const { validKnowledge, errors } = validateExtractionResults({}, [entry]);
    expect(validKnowledge).toHaveLength(0);
    expect(errors.some((e) => e.includes('Invalid knowledge entry'))).toBe(true);
  });

  it('drops entries with confidence above 1.0', () => {
    const entry = makeKnowledgeEntry({ confidence: 1.5 });
    const { validKnowledge, errors } = validateExtractionResults({}, [entry]);
    expect(validKnowledge).toHaveLength(0);
    expect(errors.some((e) => e.includes('Invalid knowledge entry'))).toBe(true);
  });

  it('preserves id, source, extractedAt, and supersededBy on valid entries', () => {
    const entry = makeKnowledgeEntry({ id: 'my-id', supersededBy: 'other-id' });
    const { validKnowledge } = validateExtractionResults({}, [entry]);
    expect(validKnowledge[0].id).toBe('my-id');
    expect(validKnowledge[0].supersededBy).toBe('other-id');
    expect(validKnowledge[0].source).toEqual({ type: 'document', fileName: 'rfp.txt' });
  });

  it('handles mix of valid and invalid knowledge entries', () => {
    const entries = [
      makeKnowledgeEntry({ content: 'The client has a strict GDPR compliance requirement.' }),
      makeKnowledgeEntry({ content: 'Hi', confidence: 0.7 }), // too short
      makeKnowledgeEntry({ category: 'bad' as never }),        // invalid category
      makeKnowledgeEntry({ confidence: 0.6 }),
    ];
    const { validKnowledge, errors } = validateExtractionResults({}, entries);
    expect(validKnowledge).toHaveLength(2);
    expect(errors).toHaveLength(2);
  });

  it('returns empty validKnowledge and no errors for empty input', () => {
    const { validKnowledge, errors } = validateExtractionResults({}, []);
    expect(validKnowledge).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateExtractionResults — combined
// ---------------------------------------------------------------------------

describe('validateExtractionResults — combined fields and knowledge', () => {
  it('validates both fields and knowledge independently', () => {
    const fields = {
      clientName: makeField({ value: 'Acme' }),
      badKey: makeField({ value: 'x' }),
    } as Record<string, RequirementField<unknown>>;
    const knowledge = [
      makeKnowledgeEntry(),
      makeKnowledgeEntry({ content: 'X' }), // too short
    ];
    const { validFields, validKnowledge, errors } = validateExtractionResults(fields, knowledge);
    expect(Object.keys(validFields)).toHaveLength(1);
    expect(validKnowledge).toHaveLength(1);
    expect(errors).toHaveLength(2); // badKey + short content
  });

  it('accumulates all errors without throwing', () => {
    const fields = {
      badKey1: makeField(),
      badKey2: makeField(),
    } as Record<string, RequirementField<unknown>>;
    const knowledge = [
      makeKnowledgeEntry({ content: 'Hi' }),
      makeKnowledgeEntry({ confidence: 2.0 }),
    ];
    const { errors } = validateExtractionResults(fields, knowledge);
    expect(errors).toHaveLength(4);
  });
});
