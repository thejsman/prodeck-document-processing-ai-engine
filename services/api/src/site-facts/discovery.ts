// services/api/src/site-facts/discovery.ts
//
// URL discovery for the site-facts crawler: robots.txt / sitemap.xml
// parsing, URL normalization, and robots allow/deny checks. All functions
// here are pure (given raw text) except fetchDiscoveryUrls, which is the
// single network boundary.

const TRACKING_PARAM_PREFIXES = ['utm_'];
const TRACKING_PARAMS = new Set(['gclid', 'fbclid', 'ref', 'igshid', 'mc_cid', 'mc_eid']);

/** Normalize a URL for deduplication: strip fragment, tracking params, trailing slash. */
export function normalizeUrl(rawUrl: string): string {
  const u = new URL(rawUrl);
  u.hash = '';
  const keep = new URLSearchParams();
  for (const [key, value] of u.searchParams) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAMS.has(lower)) continue;
    if (TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p))) continue;
    keep.append(key, value);
  }
  keep.sort();
  u.search = keep.toString();
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.toString();
}

export function isSameDomain(url: string, origin: string): boolean {
  try {
    return new URL(url).hostname === new URL(origin).hostname;
  } catch {
    return false;
  }
}

/** Extract <loc> entries from a sitemap.xml (or sitemap index) body. */
export function parseSitemapXml(xml: string): string[] {
  const urls: string[] = [];
  const locRegex = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = locRegex.exec(xml)) !== null) {
    urls.push(match[1].trim());
  }
  return urls;
}

/**
 * A <sitemapindex> document's <loc> entries point to other sitemaps, not
 * pages — e.g. WordPress's /wp-sitemap.xml. Callers must resolve those
 * further (see resolveSitemapUrls) rather than treating them as crawl
 * targets, or the crawler ends up "crawling" XML sitemap files as if they
 * were content pages.
 */
export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

export interface RobotsRules {
  disallow: string[];
  sitemaps: string[];
}

/**
 * Minimal robots.txt parser: reads directives under `User-agent: *` (falling
 * back to any group if no wildcard group exists) plus top-level Sitemap
 * lines. Prefix-match only — good enough to respect an explicit opt-out,
 * not a full robots-spec implementation.
 */
export function parseRobotsTxt(text: string): RobotsRules {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const sitemaps: string[] = [];
  const groups: { agents: string[]; disallow: string[] }[] = [];
  let current: { agents: string[]; disallow: string[] } | null = null;

  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const [rawKey, ...rest] = line.split(':');
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (key === 'user-agent') {
      if (!current || current.disallow.length > 0) {
        current = { agents: [value.toLowerCase()], disallow: [] };
        groups.push(current);
      } else {
        current.agents.push(value.toLowerCase());
      }
      continue;
    }
    if (key === 'disallow' && current) {
      if (value) current.disallow.push(value);
      continue;
    }
  }

  const wildcard = groups.find((g) => g.agents.includes('*'));
  const disallow = wildcard ? wildcard.disallow : (groups[0]?.disallow ?? []);
  return { disallow, sitemaps };
}

export function isPathAllowed(pathname: string, disallow: string[]): boolean {
  // normalizeUrl strips trailing slashes from crawled paths, so a rule like
  // "/wp-admin/" must be compared without its trailing slash too — otherwise
  // "/wp-admin" (the normalized form) never matches "/wp-admin/" and the
  // disallow rule silently does nothing.
  return !disallow.some((rule) => {
    if (!rule) return false;
    const normalizedRule = rule.length > 1 && rule.endsWith('/') ? rule.slice(0, -1) : rule;
    return pathname.startsWith(normalizedRule);
  });
}

const NON_PAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', 'gz',
  'mp3', 'mp4', 'mov', 'avi', 'webm', 'wav',
  'css', 'js', 'json', 'xml', 'woff', 'woff2', 'ttf', 'eot',
]);

/**
 * A link pointing at a media/binary asset (e.g. a WordPress gallery linking
 * straight to its full-size JPEGs) is real per-page link data but must never
 * be enqueued as a page to render — Puppeteer "rendering" an image URL just
 * burns a crawl-budget slot and a browser navigation for zero extractable text.
 */
export function isCrawlablePage(url: string): boolean {
  const pathname = new URL(url).pathname.toLowerCase();
  const lastDot = pathname.lastIndexOf('.');
  if (lastDot === -1) return true;
  const ext = pathname.slice(lastDot + 1);
  return !NON_PAGE_EXTENSIONS.has(ext);
}

export interface DiscoveryResult {
  seedUrls: string[];
  disallow: string[];
}

const MAX_SITEMAP_FETCHES = 20;

/**
 * Resolve a sitemap URL to actual page URLs, recursing through sitemap
 * indexes (bounded by a total-fetch budget shared across the whole
 * discovery call, since some sites nest indexes several levels deep).
 */
async function resolveSitemapUrls(sitemapUrl: string, budget: { remaining: number }): Promise<string[]> {
  if (budget.remaining <= 0) return [];
  budget.remaining -= 1;

  try {
    const res = await fetch(sitemapUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const locs = parseSitemapXml(xml);
    if (!isSitemapIndex(xml)) return locs;

    const pageUrls: string[] = [];
    for (const nestedSitemapUrl of locs) {
      if (budget.remaining <= 0) break;
      pageUrls.push(...(await resolveSitemapUrls(nestedSitemapUrl, budget)));
    }
    return pageUrls;
  } catch {
    return [];
  }
}

/** Fetch robots.txt and any sitemap(s) it references (or the default /sitemap.xml). */
export async function fetchDiscoveryUrls(origin: string): Promise<DiscoveryResult> {
  const disallow: string[] = [];
  let sitemapUrls = [new URL('/sitemap.xml', origin).toString()];

  try {
    const res = await fetch(new URL('/robots.txt', origin).toString(), {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const rules = parseRobotsTxt(await res.text());
      disallow.push(...rules.disallow);
      if (rules.sitemaps.length > 0) sitemapUrls = rules.sitemaps;
    }
  } catch {
    /* robots.txt absent or unreachable — proceed without it */
  }

  const budget = { remaining: MAX_SITEMAP_FETCHES };
  const seedUrls: string[] = [];
  for (const sitemapUrl of sitemapUrls) {
    if (budget.remaining <= 0) break;
    seedUrls.push(...(await resolveSitemapUrls(sitemapUrl, budget)));
  }

  return { seedUrls, disallow };
}
