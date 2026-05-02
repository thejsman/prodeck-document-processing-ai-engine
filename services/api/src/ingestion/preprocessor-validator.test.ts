import { describe, it, expect } from 'vitest';
import {
  validatePreprocessedDocument,
  ParticipantSchema,
  SectionSchema,
  ActionItemSchema,
  PreprocessedDocumentSchema,
} from './preprocessor-validator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSection(overrides?: Record<string, unknown>) {
  return {
    topic: 'Budget Planning',
    summary: 'Discussed the 2025 marketing budget.',
    keyFacts: ['Budget was $135k last year'],
    decisions: ['Prioritize website refresh'],
    openQuestions: ['How to reallocate Google Ads spend'],
    sentiment: 'neutral',
    relevantQuotes: ['we came in at 144'],
    ...overrides,
  };
}

function makeDocument(overrides?: Record<string, unknown>) {
  return {
    participants: [
      { name: 'Alice', role: 'CEO', organization: 'Acme', inferredFrom: 'introduced herself' },
    ],
    sections: [makeSection()],
    actionItems: [
      { owner: 'Alice', action: 'Send proposal', deadline: 'next week', status: 'open' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ParticipantSchema
// ---------------------------------------------------------------------------

describe('ParticipantSchema', () => {
  it('accepts a valid participant', () => {
    const result = ParticipantSchema.safeParse({
      name: 'Alice',
      role: 'CEO',
      organization: 'Acme',
      inferredFrom: 'introduced herself',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = ParticipantSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding 200 chars', () => {
    const result = ParticipantSchema.safeParse({ name: 'A'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('applies defaults for role, organization, inferredFrom', () => {
    const result = ParticipantSchema.safeParse({ name: 'Bob' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('unknown');
      expect(result.data.organization).toBe('unknown');
      expect(result.data.inferredFrom).toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// SectionSchema
// ---------------------------------------------------------------------------

describe('SectionSchema', () => {
  it('accepts a valid section', () => {
    const result = SectionSchema.safeParse(makeSection());
    expect(result.success).toBe(true);
  });

  it('rejects empty topic', () => {
    const result = SectionSchema.safeParse(makeSection({ topic: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects topic exceeding 200 chars', () => {
    const result = SectionSchema.safeParse(makeSection({ topic: 'T'.repeat(201) }));
    expect(result.success).toBe(false);
  });

  it('rejects empty summary', () => {
    const result = SectionSchema.safeParse(makeSection({ summary: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects summary exceeding 2000 chars', () => {
    const result = SectionSchema.safeParse(makeSection({ summary: 'S'.repeat(2001) }));
    expect(result.success).toBe(false);
  });

  it('rejects more than 3 relevantQuotes', () => {
    const result = SectionSchema.safeParse(
      makeSection({ relevantQuotes: ['q1', 'q2', 'q3', 'q4'] }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts exactly 3 relevantQuotes', () => {
    const result = SectionSchema.safeParse(
      makeSection({ relevantQuotes: ['q1', 'q2', 'q3'] }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a quote exceeding 200 chars', () => {
    const result = SectionSchema.safeParse(
      makeSection({ relevantQuotes: ['Q'.repeat(201)] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects more than 20 keyFacts', () => {
    const result = SectionSchema.safeParse(
      makeSection({ keyFacts: Array.from({ length: 21 }, (_, i) => `fact ${i}`) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects more than 10 decisions', () => {
    const result = SectionSchema.safeParse(
      makeSection({ decisions: Array.from({ length: 11 }, (_, i) => `decision ${i}`) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects more than 10 openQuestions', () => {
    const result = SectionSchema.safeParse(
      makeSection({ openQuestions: Array.from({ length: 11 }, (_, i) => `q ${i}`) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects invalid sentiment value', () => {
    const result = SectionSchema.safeParse(makeSection({ sentiment: 'negative' }));
    expect(result.success).toBe(false);
  });

  it('applies defaults for arrays and sentiment', () => {
    const result = SectionSchema.safeParse({ topic: 'Topic', summary: 'A summary.' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.keyFacts).toEqual([]);
      expect(result.data.decisions).toEqual([]);
      expect(result.data.openQuestions).toEqual([]);
      expect(result.data.relevantQuotes).toEqual([]);
      expect(result.data.sentiment).toBe('neutral');
    }
  });
});

// ---------------------------------------------------------------------------
// ActionItemSchema
// ---------------------------------------------------------------------------

describe('ActionItemSchema', () => {
  it('accepts a valid action item', () => {
    const result = ActionItemSchema.safeParse({
      owner: 'Bob',
      action: 'Send the report',
      deadline: 'Friday',
      status: 'open',
    });
    expect(result.success).toBe(true);
  });

  it('accepts action item without deadline (optional)', () => {
    const result = ActionItemSchema.safeParse({ owner: 'Bob', action: 'Send the report' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deadline).toBeUndefined();
    }
  });

  it('rejects empty owner', () => {
    const result = ActionItemSchema.safeParse({ owner: '', action: 'Do something' });
    expect(result.success).toBe(false);
  });

  it('rejects empty action', () => {
    const result = ActionItemSchema.safeParse({ owner: 'Bob', action: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status value', () => {
    const result = ActionItemSchema.safeParse({
      owner: 'Bob',
      action: 'Do something',
      status: 'pending',
    });
    expect(result.success).toBe(false);
  });

  it('defaults status to open', () => {
    const result = ActionItemSchema.safeParse({ owner: 'Bob', action: 'Do something' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('open');
    }
  });
});

// ---------------------------------------------------------------------------
// PreprocessedDocumentSchema
// ---------------------------------------------------------------------------

describe('PreprocessedDocumentSchema', () => {
  it('accepts a valid full document', () => {
    const result = PreprocessedDocumentSchema.safeParse(makeDocument());
    expect(result.success).toBe(true);
  });

  it('rejects a document with no sections', () => {
    const result = PreprocessedDocumentSchema.safeParse(makeDocument({ sections: [] }));
    expect(result.success).toBe(false);
  });

  it('rejects more than 30 sections', () => {
    const result = PreprocessedDocumentSchema.safeParse(
      makeDocument({
        sections: Array.from({ length: 31 }, (_, i) =>
          makeSection({ topic: `Topic ${i}`, summary: 'Summary.' }),
        ),
      }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts exactly 30 sections', () => {
    const result = PreprocessedDocumentSchema.safeParse(
      makeDocument({
        sections: Array.from({ length: 30 }, (_, i) =>
          makeSection({ topic: `Topic ${i}`, summary: 'Summary.' }),
        ),
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects more than 20 participants', () => {
    const result = PreprocessedDocumentSchema.safeParse(
      makeDocument({
        participants: Array.from({ length: 21 }, (_, i) => ({ name: `Person ${i}` })),
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects more than 20 action items', () => {
    const result = PreprocessedDocumentSchema.safeParse(
      makeDocument({
        actionItems: Array.from({ length: 21 }, (_, i) => ({
          owner: `Owner ${i}`,
          action: `Action ${i}`,
        })),
      }),
    );
    expect(result.success).toBe(false);
  });

  it('defaults participants and actionItems to empty arrays when omitted', () => {
    const result = PreprocessedDocumentSchema.safeParse({ sections: [makeSection()] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.participants).toEqual([]);
      expect(result.data.actionItems).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// validatePreprocessedDocument
// ---------------------------------------------------------------------------

describe('validatePreprocessedDocument', () => {
  it('returns valid=true and the parsed document for valid input', () => {
    const result = validatePreprocessedDocument(makeDocument());
    expect(result.valid).toBe(true);
    expect(result.document).toBeDefined();
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid=false with error messages for invalid input', () => {
    const result = validatePreprocessedDocument({ sections: [] });
    expect(result.valid).toBe(false);
    expect(result.document).toBeUndefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns valid=false for null input', () => {
    const result = validatePreprocessedDocument(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns valid=false for a string input', () => {
    const result = validatePreprocessedDocument('not json');
    expect(result.valid).toBe(false);
  });

  it('error messages include the field path', () => {
    const result = validatePreprocessedDocument(
      makeDocument({ sections: [makeSection({ topic: '' })] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('sections'))).toBe(true);
  });
});
