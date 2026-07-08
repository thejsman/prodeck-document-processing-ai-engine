import { describe, it, expect } from 'vitest';
import { formatSkillForSlides } from './skill.service.js';
import type { Skill, SectionDefinition } from './skill.types.js';

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    slug: 'pitch-deck',
    displayName: 'Pitch Deck',
    description: 'Investor pitch deck narratives',
    industries: [],
    projectTypes: [],
    tags: [],
    toneDescription: 'Compelling and story-driven',
    micrositeDefaults: {},
    author: 'test',
    version: '1.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scope: 'global',
    type: 'document',
    structureMode: 'guided',
    triggers: ['pitch deck'],
    outputFormats: ['md', 'pptx'],
    ...overrides,
  };
}

function makeSection(overrides: Partial<SectionDefinition> = {}): SectionDefinition {
  return {
    id: 'problem',
    title: 'The Problem',
    order: 1,
    required: true,
    promptHint: 'Make the investor feel the pain before the solution.',
    useRagContext: true,
    ...overrides,
  };
}

describe('formatSkillForSlides', () => {
  it('includes the header, instructions persona, and an ordered narrative arc', () => {
    const sections = [
      makeSection({ id: 'solution', title: 'The Solution', order: 2, promptHint: 'Lead with the aha moment.' }),
      makeSection({ id: 'problem', title: 'The Problem', order: 1, promptHint: 'Make the investor feel the pain.' }),
    ];
    const out = formatSkillForSlides(makeSkill(), 'You are an expert pitch deck writer.', sections);

    expect(out).toContain('## Slide Content Expertise: Pitch Deck');
    expect(out).toContain('You are an expert pitch deck writer.');
    expect(out).toContain('### Slide narrative arc');
    // Sorted by `order`: Problem (1) must precede Solution (2)
    expect(out.indexOf('1. The Problem')).toBeGreaterThan(-1);
    expect(out.indexOf('2. The Solution')).toBeGreaterThan(-1);
    expect(out.indexOf('The Problem')).toBeLessThan(out.indexOf('The Solution'));
  });

  it('marks required sections and uses count-precedence wording for guided skills', () => {
    const out = formatSkillForSlides(
      makeSkill({ structureMode: 'guided' }),
      'persona',
      [makeSection({ required: true })],
    );
    expect(out).toContain('(required)');
    expect(out).toContain('the requested slide count, which takes precedence');
    expect(out).not.toContain('Follow this slide structure');
  });

  it('uses strict wording when structureMode is strict', () => {
    const out = formatSkillForSlides(
      makeSkill({ structureMode: 'strict' }),
      'persona',
      [makeSection()],
    );
    expect(out).toContain('Follow this slide structure');
    expect(out).toContain("requested slide count still governs");
  });

  it('truncates long promptHints to 160 chars', () => {
    const longHint = 'x'.repeat(500);
    const out = formatSkillForSlides(makeSkill(), 'persona', [makeSection({ promptHint: longHint })]);
    expect(out).toContain('x'.repeat(160));
    expect(out).not.toContain('x'.repeat(161));
  });

  it('emits instructions only (no arc) when there are no sections', () => {
    const out = formatSkillForSlides(makeSkill(), 'You are an expert pitch deck writer.', []);
    expect(out).toContain('## Slide Content Expertise: Pitch Deck');
    expect(out).toContain('You are an expert pitch deck writer.');
    expect(out).not.toContain('### Slide narrative arc');
  });

  it('returns empty string when there is nothing to inject', () => {
    expect(formatSkillForSlides(makeSkill(), '   ', [])).toBe('');
  });
});
