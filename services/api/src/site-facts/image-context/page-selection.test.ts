import { describe, it, expect } from 'vitest';
import { selectImagePages } from './page-selection.js';
import type { SiteManifest } from '../types.js';

function makeManifest(pageUrls: string[]): SiteManifest {
  return {
    site_url: 'https://example.com/',
    crawl_date: new Date().toISOString(),
    pages_crawled: pageUrls.length,
    page_urls: pageUrls,
    site_category: 'corporate',
  };
}

describe('selectImagePages', () => {
  it('puts the homepage first', () => {
    const pages = selectImagePages(makeManifest(['https://example.com/about', 'https://example.com/']));
    expect(pages[0]).toBe('https://example.com/');
  });

  it('caps at 3 pages', () => {
    const pages = selectImagePages(
      makeManifest(['https://example.com/', 'https://example.com/a', 'https://example.com/b', 'https://example.com/c']),
    );
    expect(pages).toHaveLength(3);
  });

  it('handles an empty manifest', () => {
    expect(selectImagePages(makeManifest([]))).toEqual([]);
  });

  it('skips unparseable URLs without throwing', () => {
    expect(selectImagePages(makeManifest(['not a url', 'https://example.com/']))).toEqual(['https://example.com/']);
  });
});
