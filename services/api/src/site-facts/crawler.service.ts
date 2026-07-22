// services/api/src/site-facts/crawler.service.ts
//
// Playwright was requested by the original spec, but this repo already
// depends on Puppeteer (used elsewhere in this file's package for PDF/
// screenshot rendering) and has none of Playwright installed — reusing it
// avoids a second headless-browser dependency and matches the existing
// Chrome-launch convention (see document-exporter.ts). Behaviorally
// equivalent for this use case: render, wait for network idle, read the DOM.
//
// Breadth-first crawl of a single site: seed from sitemap.xml (or the
// homepage if absent), render every page with a real browser so JS-rendered
// sites (SPAs, WordPress/Laravel JS themes) extract identically to static
// HTML, and hand each rendered page to the deterministic DOM extractor.

import puppeteer from 'puppeteer';
import { fetchDiscoveryUrls, isCrawlablePage, isLowValuePage, isPathAllowed, isSameDomain, normalizeUrl } from './discovery.js';
import { extractContactFromHrefs, extractContactInfo, resolveLinks, runBrowserExtraction } from './dom-extraction.js';
import type { CrawlOptions, RawPageExtraction, SiteFactsLogger } from './types.js';
import { DEFAULT_MAX_DEPTH, DEFAULT_MAX_PAGES } from './types.js';

const PAGE_TIMEOUT_MS = 20_000;

export interface CrawlSiteOptions extends CrawlOptions {
  log?: SiteFactsLogger;
  // Fired synchronously the moment each page finishes rendering, in addition
  // to that page landing in the array this function eventually returns. Lets
  // a caller (pipeline.ts) start fact-extracting a page immediately instead
  // of waiting for the whole crawl to finish before extraction begins.
  onPage?: (page: RawPageExtraction) => void;
}

export async function crawlSite(startUrl: string, opts: CrawlSiteOptions = {}): Promise<RawPageExtraction[]> {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;

  const normalizedStart = normalizeUrl(startUrl);
  const origin = new URL(normalizedStart).origin;

  const { seedUrls, disallow } = await fetchDiscoveryUrls(origin);

  const queue: { url: string; depth: number }[] = [{ url: normalizedStart, depth: 0 }];
  const seen = new Set<string>([normalizedStart]);
  for (const raw of seedUrls) {
    try {
      const normalized = normalizeUrl(raw);
      if (!isSameDomain(normalized, origin) || seen.has(normalized)) continue;
      if (!isPathAllowed(new URL(normalized).pathname, disallow)) continue;
      if (!isCrawlablePage(normalized) || isLowValuePage(normalized)) continue;
      seen.add(normalized);
      queue.push({ url: normalized, depth: 1 });
    } catch {
      /* malformed sitemap entry — skip */
    }
  }

  const pages: RawPageExtraction[] = [];
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
    await page.setUserAgent('Mozilla/5.0 (compatible; ProDeck-SiteFacts/1.0; +https://prodeck.ai)');

    while (queue.length > 0 && pages.length < maxPages) {
      const next = queue.shift();
      if (!next) break;
      const { url, depth } = next;

      try {
        // networkidle0 (zero connections for 500ms) almost never fires on real sites —
        // WordPress heartbeat polling, chat widgets, and analytics beacons keep at least
        // one connection open indefinitely, so every page timed out and got skipped.
        // networkidle2 tolerates that background chatter; domcontentloaded is a fallback
        // for the rare page where even that never settles, so we still get *something*
        // instead of silently producing zero facts for the whole site.
        let response;
        try {
          response = await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT_MS });
        } catch (navErr) {
          opts.log?.warn({ err: navErr, url }, '[site-facts] networkidle2 wait timed out — retrying with domcontentloaded');
          response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
        }
        const httpStatus = response?.status() ?? 0;
        const redirectChain = response
          ? response.request().redirectChain().map((r) => r.url())
          : [];

        const extraction = await page.evaluate(runBrowserExtraction);
        const links = resolveLinks(url, extraction.raw_links);
        const hrefContact = extractContactFromHrefs(extraction.raw_links);
        const textContact = extractContactInfo(extraction.body_text);

        const page_: RawPageExtraction = {
          url,
          canonical_url: extraction.canonical_url,
          title: extraction.title,
          meta_description: extraction.meta_description,
          lang: extraction.lang,
          headings: extraction.headings,
          body_text: extraction.body_text,
          json_ld: extraction.json_ld,
          links,
          forms: extraction.forms,
          images: extraction.images,
          contact: {
            emails: [...new Set([...textContact.emails, ...hrefContact.emails])],
            phones: [...new Set([...textContact.phones, ...hrefContact.phones])],
            addresses: textContact.addresses,
          },
          http_status: httpStatus,
          redirect_chain: redirectChain,
          render_timestamp: new Date().toISOString(),
        };
        pages.push(page_);
        opts.onPage?.(page_);

        if (depth < maxDepth) {
          for (const link of links) {
            if (!link.internal) continue;
            let normalized: string;
            try {
              normalized = normalizeUrl(link.href);
            } catch {
              continue;
            }
            if (seen.has(normalized)) continue;
            if (!isPathAllowed(new URL(normalized).pathname, disallow)) continue;
            if (!isCrawlablePage(normalized) || isLowValuePage(normalized)) continue;
            seen.add(normalized);
            queue.push({ url: normalized, depth: depth + 1 });
          }
        }
      } catch (err) {
        opts.log?.warn({ err, url }, '[site-facts] failed to crawl page — skipping');
      }
    }
  } finally {
    await browser.close();
  }

  return pages;
}
