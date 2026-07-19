import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchDiscoveryUrls,
  isCrawlablePage,
  isPathAllowed,
  isSameDomain,
  isSitemapIndex,
  normalizeUrl,
  parseRobotsTxt,
  parseSitemapXml,
} from './discovery.js';

describe('normalizeUrl', () => {
  it('strips fragment, trailing slash, and tracking params', () => {
    expect(normalizeUrl('https://example.com/about/?utm_source=x&gclid=y#top')).toBe('https://example.com/about');
  });

  it('keeps the root path as a single slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('keeps non-tracking query params', () => {
    expect(normalizeUrl('https://example.com/search?q=shoes')).toBe('https://example.com/search?q=shoes');
  });

  it('lowercases the hostname', () => {
    expect(normalizeUrl('https://Example.COM/path')).toBe('https://example.com/path');
  });
});

describe('isSameDomain', () => {
  it('matches identical hostnames', () => {
    expect(isSameDomain('https://example.com/page', 'https://example.com')).toBe(true);
  });

  it('rejects different hostnames', () => {
    expect(isSameDomain('https://other.com/page', 'https://example.com')).toBe(false);
  });
});

describe('parseSitemapXml', () => {
  it('extracts loc entries', () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://example.com/</loc></url>
      <url><loc>https://example.com/about</loc></url>
    </urlset>`;
    expect(parseSitemapXml(xml)).toEqual(['https://example.com/', 'https://example.com/about']);
  });

  it('returns an empty array for malformed input', () => {
    expect(parseSitemapXml('not xml at all')).toEqual([]);
  });
});

describe('parseRobotsTxt', () => {
  it('reads the wildcard group and sitemap directives', () => {
    const text = `User-agent: *\nDisallow: /admin\nDisallow: /cart\n\nSitemap: https://example.com/sitemap.xml`;
    const rules = parseRobotsTxt(text);
    expect(rules.disallow).toEqual(['/admin', '/cart']);
    expect(rules.sitemaps).toEqual(['https://example.com/sitemap.xml']);
  });

  it('ignores non-wildcard groups when a wildcard group exists', () => {
    const text = `User-agent: Googlebot\nDisallow: /private\n\nUser-agent: *\nDisallow: /admin`;
    const rules = parseRobotsTxt(text);
    expect(rules.disallow).toEqual(['/admin']);
  });
});

describe('isPathAllowed', () => {
  it('disallows prefix matches', () => {
    expect(isPathAllowed('/admin/users', ['/admin'])).toBe(false);
    expect(isPathAllowed('/about', ['/admin'])).toBe(true);
  });

  it('matches a trailing-slash rule against a normalized (slash-stripped) path', () => {
    // normalizeUrl strips trailing slashes, so a crawled "/wp-admin" must still
    // be caught by a robots.txt rule written as "Disallow: /wp-admin/".
    expect(isPathAllowed('/wp-admin', ['/wp-admin/'])).toBe(false);
    expect(isPathAllowed('/wp-admin/users.php', ['/wp-admin/'])).toBe(false);
  });
});

describe('isCrawlablePage', () => {
  it('rejects common binary/media asset extensions', () => {
    expect(isCrawlablePage('https://example.com/gallery/photo.jpeg')).toBe(false);
    expect(isCrawlablePage('https://example.com/files/brochure.pdf')).toBe(false);
    expect(isCrawlablePage('https://example.com/wp-sitemap.xml')).toBe(false);
  });

  it('accepts ordinary content pages', () => {
    expect(isCrawlablePage('https://example.com/about-us')).toBe(true);
    expect(isCrawlablePage('https://example.com/blog/post-title')).toBe(true);
  });

  it('accepts paths with no extension-looking segment', () => {
    expect(isCrawlablePage('https://example.com/products/v1.2/overview')).toBe(true);
  });
});

describe('isSitemapIndex', () => {
  it('detects a sitemap index root element', () => {
    expect(isSitemapIndex('<?xml version="1.0"?><sitemapindex><sitemap><loc>x</loc></sitemap></sitemapindex>')).toBe(true);
  });

  it('does not flag a regular urlset as an index', () => {
    expect(isSitemapIndex('<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url></urlset>')).toBe(false);
  });
});

describe('fetchDiscoveryUrls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('recurses through a sitemap index to collect actual page URLs (WordPress-style /wp-sitemap.xml)', async () => {
    const robotsTxt = 'User-agent: *\nDisallow: /wp-admin\nSitemap: https://example.com/wp-sitemap.xml';
    const sitemapIndex = `<?xml version="1.0"?><sitemapindex>
      <sitemap><loc>https://example.com/wp-sitemap-posts-page-1.xml</loc></sitemap>
    </sitemapindex>`;
    const pageSitemap = `<?xml version="1.0"?><urlset>
      <url><loc>https://example.com/about-us/</loc></url>
      <url><loc>https://example.com/services/</loc></url>
    </urlset>`;

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) return { ok: true, text: async () => robotsTxt } as Response;
      if (url.endsWith('/wp-sitemap.xml')) return { ok: true, text: async () => sitemapIndex } as Response;
      if (url.endsWith('/wp-sitemap-posts-page-1.xml')) return { ok: true, text: async () => pageSitemap } as Response;
      return { ok: false, text: async () => '' } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const { seedUrls, disallow } = await fetchDiscoveryUrls('https://example.com');

    // The sitemap-index URL itself must never appear as a crawl target.
    expect(seedUrls).not.toContain('https://example.com/wp-sitemap-posts-page-1.xml');
    expect(seedUrls).toEqual(['https://example.com/about-us/', 'https://example.com/services/']);
    expect(disallow).toEqual(['/wp-admin']);
  });
});
