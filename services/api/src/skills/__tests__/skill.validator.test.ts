import { describe, it, expect } from 'vitest';
import {
  SkillSchema,
  SectionDefinitionSchema,
  SectionConditionSchema,
  PricingTierSchema,
  PricingDefaultsSchema,
  MicrositeDefaultsSchema,
  SkillSectionsSchema,
  GeneratedSkillSchema,
} from '../skill.validator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validSkill() {
  return {
    slug: 'my-skill',
    displayName: 'My Skill',
    description: 'A great skill',
    industries: ['Technology'],
    projectTypes: ['SaaS'],
    tags: ['test'],
    toneDescription: 'Professional',
    micrositeDefaults: {},
    author: 'alice',
    version: '1.0',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    scope: 'global',
  };
}

function validSection() {
  return {
    id: 'exec-summary',
    title: 'Executive Summary',
    order: 1,
    required: true,
    promptHint: 'Write a concise executive summary',
    useRagContext: false,
  };
}

// ---------------------------------------------------------------------------
// SkillSchema
// ---------------------------------------------------------------------------

describe('SkillSchema', () => {
  it('accepts a valid skill', () => {
    const result = SkillSchema.safeParse(validSkill());
    expect(result.success).toBe(true);
  });

  it('rejects slug with uppercase letters', () => {
    const result = SkillSchema.safeParse({ ...validSkill(), slug: 'MySkill' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/lowercase kebab-case/i);
  });

  it('rejects slug with spaces', () => {
    const result = SkillSchema.safeParse({ ...validSkill(), slug: 'my skill' });
    expect(result.success).toBe(false);
  });

  it('rejects slug with special chars other than hyphen', () => {
    const result = SkillSchema.safeParse({ ...validSkill(), slug: 'my_skill!' });
    expect(result.success).toBe(false);
  });

  it('accepts slug with numbers and hyphens', () => {
    const result = SkillSchema.safeParse({ ...validSkill(), slug: 'skill-42-alpha' });
    expect(result.success).toBe(true);
  });

  it('rejects version without dot notation', () => {
    const result = SkillSchema.safeParse({ ...validSkill(), version: 'v1' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/semver/i);
  });

  it('rejects version like "1.0.0" (three parts)', () => {
    const result = SkillSchema.safeParse({ ...validSkill(), version: '1.0.0' });
    expect(result.success).toBe(false);
  });

  it('accepts version "2.14"', () => {
    const result = SkillSchema.safeParse({ ...validSkill(), version: '2.14' });
    expect(result.success).toBe(true);
  });

  it('rejects unknown scope values', () => {
    const result = SkillSchema.safeParse({ ...validSkill(), scope: 'team' });
    expect(result.success).toBe(false);
  });

  it('accepts namespace scope with namespace field', () => {
    const result = SkillSchema.safeParse({
      ...validSkill(),
      scope: 'namespace',
      namespace: 'acme',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required field displayName', () => {
    const { displayName: _, ...rest } = validSkill();
    const result = SkillSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MicrositeDefaultsSchema
// ---------------------------------------------------------------------------

describe('MicrositeDefaultsSchema', () => {
  it('accepts empty object', () => {
    expect(MicrositeDefaultsSchema.safeParse({}).success).toBe(true);
  });

  it('accepts valid hex colors', () => {
    const result = MicrositeDefaultsSchema.safeParse({
      primaryColor: '#1a3a5c',
      secondaryColor: '#FFFFFF',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid hex color (no hash)', () => {
    const result = MicrositeDefaultsSchema.safeParse({ primaryColor: '1a3a5c' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/valid hex color/i);
  });

  it('rejects 3-digit hex shorthand', () => {
    const result = MicrositeDefaultsSchema.safeParse({ primaryColor: '#fff' });
    expect(result.success).toBe(false);
  });

  it('rejects hex with invalid characters', () => {
    const result = MicrositeDefaultsSchema.safeParse({ primaryColor: '#GGGGGG' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SectionDefinitionSchema
// ---------------------------------------------------------------------------

describe('SectionDefinitionSchema', () => {
  it('accepts a valid section', () => {
    expect(SectionDefinitionSchema.safeParse(validSection()).success).toBe(true);
  });

  it('rejects section id with uppercase', () => {
    const result = SectionDefinitionSchema.safeParse({ ...validSection(), id: 'ExecSummary' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/kebab-case/i);
  });

  it('rejects section id with spaces', () => {
    const result = SectionDefinitionSchema.safeParse({ ...validSection(), id: 'exec summary' });
    expect(result.success).toBe(false);
  });

  it('rejects order of 0 (must be positive)', () => {
    const result = SectionDefinitionSchema.safeParse({ ...validSection(), order: 0 });
    expect(result.success).toBe(false);
  });

  it('accepts section with all optional fields', () => {
    const result = SectionDefinitionSchema.safeParse({
      ...validSection(),
      maxWords: 500,
      useRagContext: true,
      ragQuery: 'compliance requirements',
      assetRef: 'guide.md',
      condition: { field: 'constraints', operator: 'contains', value: 'GDPR' },
    });
    expect(result.success).toBe(true);
  });

  it('defaults useRagContext to false when omitted', () => {
    const { useRagContext: _, ...rest } = validSection();
    const result = SectionDefinitionSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.useRagContext).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// SectionConditionSchema
// ---------------------------------------------------------------------------

describe('SectionConditionSchema', () => {
  it('accepts valid operators', () => {
    for (const operator of ['exists', 'equals', 'contains'] as const) {
      const result = SectionConditionSchema.safeParse({ field: 'scope', operator });
      expect(result.success).toBe(true);
    }
  });

  it('rejects unknown operator', () => {
    const result = SectionConditionSchema.safeParse({ field: 'scope', operator: 'notequals' });
    expect(result.success).toBe(false);
  });

  it('rejects empty field', () => {
    const result = SectionConditionSchema.safeParse({ field: '', operator: 'exists' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PricingDefaultsSchema
// ---------------------------------------------------------------------------

describe('PricingDefaultsSchema', () => {
  it('accepts valid pricing with hourly model', () => {
    const result = PricingDefaultsSchema.safeParse({
      model: 'hourly',
      rates: { Senior: 150, Junior: 80 },
      currency: 'USD',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown pricing model', () => {
    const result = PricingDefaultsSchema.safeParse({ model: 'subscription', currency: 'USD' });
    expect(result.success).toBe(false);
  });

  it('accepts all four model types', () => {
    for (const model of ['hourly', 'fixed', 'tiered', 'retainer'] as const) {
      const result = PricingDefaultsSchema.safeParse({ model, currency: 'USD' });
      expect(result.success).toBe(true);
    }
  });

  it('defaults currency to USD', () => {
    const result = PricingDefaultsSchema.safeParse({ model: 'fixed' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe('USD');
    }
  });

  it('rejects currency longer than 3 chars', () => {
    const result = PricingDefaultsSchema.safeParse({ model: 'fixed', currency: 'USDD' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PricingTierSchema
// ---------------------------------------------------------------------------

describe('PricingTierSchema', () => {
  it('accepts valid tier', () => {
    const result = PricingTierSchema.safeParse({
      name: 'MVP',
      description: 'Minimum viable product',
      features: ['Auth', 'Dashboard'],
      priceRange: '$50k – $80k',
      duration: '8–12 weeks',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = PricingTierSchema.safeParse({ name: '', description: 'desc', features: [] });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SkillSectionsSchema
// ---------------------------------------------------------------------------

describe('SkillSectionsSchema', () => {
  it('accepts valid sections wrapper', () => {
    const result = SkillSectionsSchema.safeParse({ sections: [validSection()] });
    expect(result.success).toBe(true);
  });

  it('accepts empty sections array', () => {
    expect(SkillSectionsSchema.safeParse({ sections: [] }).success).toBe(true);
  });

  it('rejects missing sections key', () => {
    expect(SkillSectionsSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GeneratedSkillSchema
// ---------------------------------------------------------------------------

describe('GeneratedSkillSchema', () => {
  it('accepts a valid generated skill', () => {
    const result = GeneratedSkillSchema.safeParse({
      displayName: 'Fintech Proposals',
      description: 'Generates fintech proposals',
      industries: ['Fintech'],
      projectTypes: ['Platform'],
      tags: ['fintech'],
      toneDescription: 'Professional',
      instructions: '## Identity\nYou write fintech proposals.',
      sections: [
        {
          id: 'exec-summary',
          title: 'Executive Summary',
          order: 1,
          required: true,
          promptHint: 'Write an executive summary',
          useRagContext: false,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing displayName', () => {
    const result = GeneratedSkillSchema.safeParse({
      description: 'A skill',
      industries: [],
      projectTypes: [],
      tags: [],
      toneDescription: 'Professional',
      instructions: '## Identity',
      sections: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional pricingDefaults and micrositeDefaults', () => {
    const result = GeneratedSkillSchema.safeParse({
      displayName: 'Test',
      description: '',
      industries: [],
      projectTypes: [],
      tags: [],
      toneDescription: '',
      instructions: '',
      sections: [],
      pricingDefaults: { model: 'fixed', currency: 'EUR' },
      micrositeDefaults: { primaryColor: '#000000' },
    });
    expect(result.success).toBe(true);
  });
});
