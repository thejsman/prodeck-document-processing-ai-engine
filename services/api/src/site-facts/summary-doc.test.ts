import { describe, it, expect, vi } from 'vitest';
import {
  buildSummaryDocPrompt,
  buildSourcesSection,
  generateSummaryDoc,
  processCitations,
} from './summary-doc.service.js';
import type { Fact, SiteManifest } from './types.js';

function makeFact(overrides: Partial<Fact> = {}): Fact {
  return {
    fact_id: crypto.randomUUID(),
    site_url: 'https://example.com',
    source_url: 'https://example.com/about',
    source_section: 'h2: Our Story',
    category: 'company_info',
    statement: 'Founded in 2019, headquartered in Austin, TX.',
    confidence: 'high',
    extracted_at: new Date().toISOString(),
    verbatim_support: 'Founded in 2019',
    ...overrides,
  };
}

const manifest: SiteManifest = {
  site_url: 'https://example.com',
  crawl_date: new Date().toISOString(),
  pages_crawled: 2,
  page_urls: ['https://example.com/', 'https://example.com/about'],
  site_category: 'corporate',
};

describe('buildSummaryDocPrompt', () => {
  it('numbers facts, includes metadata, and picks the category-specific section', () => {
    const facts = [makeFact(), makeFact({ statement: 'Offers consulting services.', category: 'product' })];
    const prompt = buildSummaryDocPrompt('Example Co', manifest, facts);

    expect(prompt).toContain('# Example Co — Summary');
    expect(prompt).toContain('[F1] (company_info, confidence: high) Founded in 2019');
    expect(prompt).toContain('[F2] (product, confidence: high) Offers consulting services.');
    expect(prompt).toContain('## Services'); // corporate → Services
    expect(prompt).toContain('https://example.com/about');
    expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});

describe('processCitations', () => {
  it('keeps valid citations and collects them sorted and deduped', () => {
    const { body, citedIndices } = processCitations('Claim one [F2]. Claim two [F1][F2].', 3);
    expect(body).toBe('Claim one [F2]. Claim two [F1][F2].');
    expect(citedIndices).toEqual([1, 2]);
  });

  it('strips citations pointing at nonexistent facts', () => {
    const { body, citedIndices } = processCitations('Real [F1]. Fake [F99].', 2);
    expect(body).toBe('Real [F1]. Fake .');
    expect(citedIndices).toEqual([1]);
  });
});

describe('buildSourcesSection', () => {
  it('lists only cited facts with statement, source_url, and confidence', () => {
    const facts = [makeFact(), makeFact({ statement: 'Uncited fact.', confidence: 'low' })];
    const sources = buildSourcesSection(facts, [1]);
    expect(sources).toContain('[F1] "Founded in 2019, headquartered in Austin, TX." — https://example.com/about (confidence: high)');
    expect(sources).not.toContain('Uncited fact.');
  });

  it('falls back to listing all facts when nothing was cited', () => {
    const facts = [makeFact(), makeFact({ statement: 'Second fact.' })];
    const sources = buildSourcesSection(facts, []);
    expect(sources).toContain('[F1]');
    expect(sources).toContain('[F2] "Second fact."');
  });
});

describe('generateSummaryDoc', () => {
  it('assembles body plus deterministic Sources, stripping fences and bad citations', async () => {
    const facts = [makeFact()];
    const generateFn = vi.fn().mockResolvedValue('```markdown\n# Example Co — Summary\n\n## Overview\nFounded in 2019 [F1]. Bogus [F9].\n```');

    const doc = await generateSummaryDoc({ siteName: 'Example Co', manifest, facts, generateFn });

    expect(doc).toContain('# Example Co — Summary');
    expect(doc).not.toContain('```');
    expect(doc).not.toContain('[F9]');
    expect(doc).toContain('## Sources');
    expect(doc).toContain('[F1] "Founded in 2019, headquartered in Austin, TX."');
  });
});
