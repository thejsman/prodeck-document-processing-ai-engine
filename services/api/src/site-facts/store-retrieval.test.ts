import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFacts, readManifest, readRawPages, siteOutputDir, writeSiteFacts } from './store.js';
import { getFactStatements, getFactsForSite } from './retrieval.js';
import type { Fact, RawPageExtraction, SiteManifest } from './types.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'site-facts-test-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeFact(overrides: Partial<Fact> = {}): Fact {
  return {
    fact_id: crypto.randomUUID(),
    site_url: 'https://example.com',
    source_url: 'https://example.com/',
    source_section: '',
    category: 'company_info',
    statement: 'Example statement.',
    confidence: 'high',
    extracted_at: new Date().toISOString(),
    verbatim_support: 'Example statement.',
    ...overrides,
  };
}

const rawPage: RawPageExtraction = {
  url: 'https://example.com/',
  canonical_url: null,
  title: 'Home',
  meta_description: null,
  lang: 'en',
  headings: [],
  body_text: 'Welcome to Example.',
  json_ld: [],
  links: [],
  forms: [],
  images: [],
  contact: { emails: [], phones: [], addresses: [] },
  http_status: 200,
  redirect_chain: [],
  render_timestamp: new Date().toISOString(),
};

const manifest: SiteManifest = {
  site_url: 'https://example.com',
  crawl_date: new Date().toISOString(),
  pages_crawled: 1,
  page_urls: ['https://example.com/'],
  site_category: 'corporate',
};

describe('siteOutputDir', () => {
  it('derives a slug from the hostname and strips www', () => {
    expect(siteOutputDir('/root', 'https://www.Example.com/page')).toBe(path.join('/root', 'example.com'));
  });
});

describe('writeSiteFacts / read*', () => {
  it('round-trips manifest, facts, and raw pages', async () => {
    const dir = siteOutputDir(root, manifest.site_url);
    const facts = [makeFact()];
    await writeSiteFacts(dir, { manifest, facts, rawPages: [rawPage] });

    expect(await readManifest(dir)).toEqual(manifest);
    expect(await readFacts(dir)).toEqual(facts);
    expect(await readRawPages(dir)).toEqual([rawPage]);
  });

  it('writes an empty file (not invalid JSON) when there are no facts', async () => {
    const dir = siteOutputDir(root, manifest.site_url);
    await writeSiteFacts(dir, { manifest, facts: [], rawPages: [] });
    expect(await readFacts(dir)).toEqual([]);
  });
});

describe('retrieval', () => {
  it('filters facts by category and source_url', async () => {
    const dir = siteOutputDir(root, manifest.site_url);
    const facts = [
      makeFact({ category: 'contact', source_url: 'https://example.com/contact' }),
      makeFact({ category: 'product', source_url: 'https://example.com/' }),
    ];
    await writeSiteFacts(dir, { manifest, facts, rawPages: [rawPage] });

    expect(await getFactsForSite(dir, { category: 'contact' })).toHaveLength(1);
    expect(await getFactsForSite(dir, { sourceUrl: 'https://example.com/' })).toHaveLength(1);
  });

  it('flattens facts to statement/confidence/source_url', async () => {
    const dir = siteOutputDir(root, manifest.site_url);
    await writeSiteFacts(dir, { manifest, facts: [makeFact({ statement: 'Hello.' })], rawPages: [rawPage] });

    const statements = await getFactStatements(dir);
    expect(statements).toEqual([{ statement: 'Hello.', confidence: 'high', source_url: 'https://example.com/' }]);
  });
});
