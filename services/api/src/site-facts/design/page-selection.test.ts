import { describe, it, expect } from 'vitest';
import { notFoundProbeUrl, selectDesignPages } from './page-selection.js';
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

describe('selectDesignPages', () => {
  it('picks homepage, listing with children, detail child, and form page', () => {
    const pages = selectDesignPages(
      makeManifest([
        'https://example.com/',
        'https://example.com/blog',
        'https://example.com/blog/post-one',
        'https://example.com/blog/post-two',
        'https://example.com/contact-us',
        'https://example.com/about',
      ]),
    );
    const byRole = Object.fromEntries(pages.map((p) => [p.role, p.url]));
    expect(byRole.homepage).toBe('https://example.com/');
    expect(byRole.listing).toBe('https://example.com/blog');
    expect(byRole.detail).toBe('https://example.com/blog/post-one');
    expect(byRole.form).toBe('https://example.com/contact-us');
  });

  it('always appends the deterministic 404 probe within the page cap', () => {
    const pages = selectDesignPages(makeManifest(['https://example.com/']));
    expect(pages.some((p) => p.role === 'notfound' && p.url === notFoundProbeUrl('https://example.com/'))).toBe(true);
    expect(pages.length).toBeLessThanOrEqual(5);
  });

  it('falls back to deepest path for detail when no listing exists', () => {
    const pages = selectDesignPages(
      makeManifest(['https://example.com/', 'https://example.com/a', 'https://example.com/a/b/c']),
    );
    const detail = pages.find((p) => p.role === 'detail');
    expect(detail?.url).toBe('https://example.com/a/b/c');
  });

  it('never selects the same URL for two roles', () => {
    const pages = selectDesignPages(makeManifest(['https://example.com/', 'https://example.com/contact']));
    const urls = pages.map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('handles an empty manifest', () => {
    expect(selectDesignPages(makeManifest([]))).toEqual([]);
  });

  it('caps at 5 pages', () => {
    const pages = selectDesignPages(
      makeManifest([
        'https://example.com/',
        'https://example.com/blog',
        'https://example.com/blog/a',
        'https://example.com/blog/b',
        'https://example.com/contact',
        'https://example.com/about',
        'https://example.com/team',
      ]),
    );
    expect(pages.length).toBeLessThanOrEqual(5);
  });

  it('is deterministic for the same input', () => {
    const manifest = makeManifest([
      'https://example.com/',
      'https://example.com/services',
      'https://example.com/services/roofing',
      'https://example.com/services/siding',
      'https://example.com/contact-us',
    ]);
    expect(selectDesignPages(manifest)).toEqual(selectDesignPages(manifest));
  });
});
