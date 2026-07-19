import { describe, it, expect, vi } from 'vitest';
import { buildFactExtractionPrompt, dedupeFacts, extractFactsForPage } from './fact-extraction.service.js';
import type { Fact, RawPageExtraction } from './types.js';

function makePage(overrides: Partial<RawPageExtraction> = {}): RawPageExtraction {
  return {
    url: 'https://example.com/about',
    canonical_url: null,
    title: 'About Us',
    meta_description: 'About Example Co.',
    lang: 'en',
    headings: [{ level: 2, text: 'Our Story' }],
    body_text: 'Founded in 2019, Example Co is headquartered in Austin, TX.',
    json_ld: [],
    links: [],
    forms: [],
    images: [],
    contact: { emails: [], phones: [], addresses: [] },
    http_status: 200,
    redirect_chain: [],
    render_timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('buildFactExtractionPrompt', () => {
  it('interpolates page fields and leaves no placeholder tokens', () => {
    const prompt = buildFactExtractionPrompt(makePage());
    expect(prompt).toContain('https://example.com/about');
    expect(prompt).toContain('h2: Our Story');
    expect(prompt).toContain('Founded in 2019');
    expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});

describe('extractFactsForPage', () => {
  it('maps a well-formed LLM response into Fact objects', async () => {
    const generateFn = vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          category: 'company_info',
          statement: 'Founded in 2019, headquartered in Austin, TX.',
          confidence: 'high',
          source_section: 'h2: Our Story',
          verbatim_support: 'Founded in 2019, Example Co is headquartered in Austin, TX.',
        },
      ]),
    );

    const facts = await extractFactsForPage(makePage(), 'https://example.com', generateFn);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      site_url: 'https://example.com',
      source_url: 'https://example.com/about',
      category: 'company_info',
      confidence: 'high',
      statement: 'Founded in 2019, headquartered in Austin, TX.',
    });
    expect(facts[0].fact_id).toBeTruthy();
    expect(facts[0].extracted_at).toBeTruthy();
  });

  it('strips markdown code fences before parsing', async () => {
    const generateFn = vi.fn().mockResolvedValue('```json\n[{"category":"other","statement":"x","confidence":"low","source_section":"","verbatim_support":"x"}]\n```');
    const facts = await extractFactsForPage(makePage(), 'https://example.com', generateFn);
    expect(facts).toHaveLength(1);
  });

  it('drops items with no statement and falls back to safe defaults for invalid category/confidence', async () => {
    const generateFn = vi.fn().mockResolvedValue(
      JSON.stringify([
        { category: 'not-a-real-category', statement: 'A real claim.', confidence: 'extreme' },
        { category: 'other', statement: '' },
      ]),
    );
    const facts = await extractFactsForPage(makePage(), 'https://example.com', generateFn);
    expect(facts).toHaveLength(1);
    expect(facts[0].category).toBe('other');
    expect(facts[0].confidence).toBe('low');
  });

  it('returns an empty array for pages with no body text, without calling the LLM', async () => {
    const generateFn = vi.fn();
    const facts = await extractFactsForPage(makePage({ body_text: '' }), 'https://example.com', generateFn);
    expect(facts).toEqual([]);
    expect(generateFn).not.toHaveBeenCalled();
  });

  it('returns an empty array when the LLM response is not parseable JSON', async () => {
    const generateFn = vi.fn().mockResolvedValue('Sorry, I cannot help with that.');
    const facts = await extractFactsForPage(makePage(), 'https://example.com', generateFn);
    expect(facts).toEqual([]);
  });
});

describe('dedupeFacts', () => {
  function makeFact(overrides: Partial<Fact> = {}): Fact {
    return {
      fact_id: crypto.randomUUID(),
      site_url: 'https://example.com',
      source_url: 'https://example.com/',
      source_section: '',
      category: 'contact',
      statement: 'Contact us at hello@example.com',
      confidence: 'high',
      extracted_at: new Date().toISOString(),
      verbatim_support: 'hello@example.com',
      ...overrides,
    };
  }

  it('drops near-identical statements repeated across pages within the same category', () => {
    const facts = [
      makeFact({ source_url: 'https://example.com/' }),
      makeFact({ source_url: 'https://example.com/contact', statement: 'Contact us at hello@example.com!' }),
    ];
    expect(dedupeFacts(facts)).toHaveLength(1);
  });

  it('keeps facts with the same statement in different categories', () => {
    const facts = [makeFact({ category: 'contact' }), makeFact({ category: 'company_info' })];
    expect(dedupeFacts(facts)).toHaveLength(2);
  });
});
