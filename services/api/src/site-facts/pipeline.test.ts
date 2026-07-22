import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Fact, RawPageExtraction, SiteCategory } from './types.js';

const mockPage = (url: string): RawPageExtraction => ({
  url,
  canonical_url: null,
  title: url,
  meta_description: null,
  lang: 'en',
  headings: [],
  body_text: `body for ${url}`,
  json_ld: [],
  links: [],
  forms: [],
  images: [],
  contact: { emails: [], phones: [], addresses: [] },
  http_status: 200,
  redirect_chain: [],
  render_timestamp: new Date().toISOString(),
});

const mockFact = (url: string): Fact => ({
  fact_id: `fact-${url}`,
  site_url: 'https://example.com',
  source_url: url,
  source_section: 'body',
  category: 'other',
  statement: `fact for ${url}`,
  confidence: 'high',
  extracted_at: new Date().toISOString(),
  verbatim_support: `body for ${url}`,
});

// crawlSite is mocked to emit pages one at a time via onPage, with a delay,
// so the test can assert extraction actually starts before the crawl (as a
// whole) finishes — proving the overlap, not just that both eventually run.
const crawlSiteMock = vi.fn();
vi.mock('./crawler.service.js', () => ({
  crawlSite: (...args: unknown[]) => crawlSiteMock(...args),
}));

const extractFactsForPageMock = vi.fn();
vi.mock('./fact-extraction.service.js', async () => {
  const actual = await vi.importActual<typeof import('./fact-extraction.service.js')>('./fact-extraction.service.js');
  return {
    ...actual,
    extractFactsForPage: (...args: unknown[]) => extractFactsForPageMock(...args),
  };
});

vi.mock('./site-classification.service.js', () => ({
  classifySite: vi.fn(async () => 'corporate' as SiteCategory),
}));

const writeSiteFactsMock = vi.fn(async () => {});
vi.mock('./store.js', () => ({
  siteOutputDir: (_root: string, url: string) => `/tmp/${url}`,
  writeSiteFacts: (...args: unknown[]) => writeSiteFactsMock(...args),
}));

const { extractSiteFacts } = await import('./pipeline.js');

describe('extractSiteFacts', () => {
  beforeEach(() => {
    crawlSiteMock.mockReset();
    extractFactsForPageMock.mockReset();
    writeSiteFactsMock.mockClear();
  });

  it('starts extracting a page before the crawl as a whole finishes (overlap)', async () => {
    const urls = ['https://example.com/', 'https://example.com/about', 'https://example.com/contact'];
    const extractionStartOrder: string[] = [];
    let crawlFinished = false;

    crawlSiteMock.mockImplementation(async (_siteUrl: string, opts: { onPage: (p: RawPageExtraction) => void }) => {
      const pages: RawPageExtraction[] = [];
      for (const url of urls) {
        await new Promise((r) => setTimeout(r, 5));
        const page = mockPage(url);
        pages.push(page);
        opts.onPage(page);
      }
      crawlFinished = true;
      return pages;
    });

    extractFactsForPageMock.mockImplementation(async (page: RawPageExtraction) => {
      // Record whether extraction for this page started while the crawl loop
      // (as a whole) was still running — this is only possible if extraction
      // is overlapped with crawling rather than gated behind it.
      if (!crawlFinished) extractionStartOrder.push(page.url);
      return [mockFact(page.url)];
    });

    const result = await extractSiteFacts('https://example.com', {
      workdir: '/tmp/workdir',
      generateFn: vi.fn(),
      maxPages: 10,
      maxDepth: 1,
    });

    expect(extractionStartOrder.length).toBeGreaterThan(0);
    expect(result.pagesCrawled).toBe(3);
    expect(result.factsCount).toBe(3);
    expect(writeSiteFactsMock).toHaveBeenCalledTimes(1);
  });

  it('skips a page whose extraction fails without dropping the others', async () => {
    const urls = ['https://example.com/', 'https://example.com/broken'];

    crawlSiteMock.mockImplementation(async (_siteUrl: string, opts: { onPage: (p: RawPageExtraction) => void }) => {
      const pages = urls.map(mockPage);
      for (const page of pages) opts.onPage(page);
      return pages;
    });

    extractFactsForPageMock.mockImplementation(async (page: RawPageExtraction) => {
      if (page.url.endsWith('/broken')) throw new Error('extraction failed');
      return [mockFact(page.url)];
    });

    const result = await extractSiteFacts('https://example.com', {
      workdir: '/tmp/workdir',
      generateFn: vi.fn(),
    });

    expect(result.pagesCrawled).toBe(2);
    expect(result.factsCount).toBe(1);
  });

  it('propagates a crawl failure instead of hanging', async () => {
    crawlSiteMock.mockImplementation(async () => {
      throw new Error('crawl failed');
    });

    await expect(
      extractSiteFacts('https://example.com', { workdir: '/tmp/workdir', generateFn: vi.fn() }),
    ).rejects.toThrow('crawl failed');
  });
});
