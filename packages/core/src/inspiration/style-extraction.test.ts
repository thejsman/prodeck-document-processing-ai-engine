import { describe, it, expect } from 'vitest';
import { buildStylePrompt, parseStyleResponse, looksLikeFact } from './style-extraction.js';

describe('buildStylePrompt', () => {
  it('names the file, forbids facts, and truncates very long text', () => {
    const prompt = buildStylePrompt('acme.md', 'x'.repeat(200_000));
    expect(prompt).toContain('acme.md');
    expect(prompt.toLowerCase()).toContain('style only');
    // excerpt is capped well under the raw 200k input
    expect(prompt.length).toBeLessThan(120_000);
  });
});

describe('looksLikeFact', () => {
  it('flags money, percentages, and long number runs', () => {
    expect(looksLikeFact('save $40,000')).toBe(true);
    expect(looksLikeFact('grew 35%')).toBe(true);
    expect(looksLikeFact('over 2024 quarters')).toBe(true);
    expect(looksLikeFact('we partner with you')).toBe(false);
  });
});

describe('parseStyleResponse', () => {
  it('parses JSON wrapped in preamble/code fences and sanitizes facts', () => {
    const raw =
      'Here is the analysis:\n```json\n' +
      JSON.stringify({
        tone: ['confident', '  ', 'warm'],
        formality: 'FORMAL',
        sectionPatterns: ['Executive Summary', 'Pricing'],
        openingStyle: 'leads with a value statement',
        closingStyle: 'ends with a CTA',
        recurringPhrases: ['we partner with you', 'saved them $50,000'],
        vocabulary: ['scalable', 'grew 35%'],
        persuasionPatterns: ['roi-led'],
        formatting: ['short paragraphs'],
      }) +
      '\n```\nDone.';
    const style = parseStyleResponse(raw);
    expect(style.tone).toEqual(['confident', 'warm']); // blanks dropped
    expect(style.formality).toBe('formal'); // normalized
    // fact-bearing phrases stripped, clean ones kept
    expect(style.recurringPhrases).toEqual(['we partner with you']);
    expect(style.vocabulary).toEqual(['scalable']);
  });

  it('falls back to neutral formality on an invalid value', () => {
    const style = parseStyleResponse(JSON.stringify({ formality: 'bombastic' }));
    expect(style.formality).toBe('neutral');
    expect(style.tone).toEqual([]);
  });
});
