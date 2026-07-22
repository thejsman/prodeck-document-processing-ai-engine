// services/api/src/site-facts/pipeline.ts
//
// Orchestrates the full site-facts pipeline: crawl -> per-page fact
// extraction -> dedupe -> site classification -> storage. This is the only
// entry point most callers need (CLI, super-client creation route, future
// consumers). It deliberately stops at producing the fact base — no
// narrative generation happens here.

import type { GenerateFn } from '@ai-engine/planner';
import { crawlSite } from './crawler.service.js';
import { dedupeFacts, extractFactsForPage } from './fact-extraction.service.js';
import { classifySite } from './site-classification.service.js';
import { siteOutputDir, writeSiteFacts } from './store.js';
import { normalizeUrl } from './discovery.js';
import type { CrawlOptions, Fact, RawPageExtraction, SiteFactsLogger, SiteManifest } from './types.js';

const FACT_EXTRACTION_CONCURRENCY = 5;

// Minimal async producer/consumer queue. Lets fact-extraction start on page 1
// the moment it's crawled, instead of waiting for the entire site to finish
// crawling before extraction begins — crawling is single-page-at-a-time
// (one headless browser tab, network-idle wait per page) so on a 15-page
// crawl that dead time was previously added on top of extraction time rather
// than overlapping with it.
const QUEUE_DONE = Symbol('queue-done');
class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<(value: T | typeof QUEUE_DONE) => void> = [];
  private closed = false;

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) this.waiters.shift()!(QUEUE_DONE);
  }

  next(): Promise<T | typeof QUEUE_DONE> {
    if (this.items.length > 0) return Promise.resolve(this.items.shift() as T);
    if (this.closed) return Promise.resolve(QUEUE_DONE);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

export interface ExtractSiteFactsOptions extends CrawlOptions {
  workdir: string;
  generateFn: GenerateFn;
  log?: SiteFactsLogger;
}

export interface ExtractSiteFactsResult {
  outputDir: string;
  manifest: SiteManifest;
  factsCount: number;
  pagesCrawled: number;
}

export async function extractSiteFacts(rawUrl: string, opts: ExtractSiteFactsOptions): Promise<ExtractSiteFactsResult> {
  const siteUrl = normalizeUrl(rawUrl.trim().startsWith('http') ? rawUrl.trim() : `https://${rawUrl.trim()}`);

  const queue = new AsyncQueue<RawPageExtraction>();
  const perPageFacts: Fact[][] = [];

  const crawlPromise = crawlSite(siteUrl, {
    maxPages: opts.maxPages,
    maxDepth: opts.maxDepth,
    log: opts.log,
    onPage: (page) => queue.push(page),
  }).finally(() => queue.close());

  async function extractionWorker(): Promise<void> {
    for (;;) {
      const page = await queue.next();
      if (page === QUEUE_DONE) return;
      try {
        perPageFacts.push(await extractFactsForPage(page, siteUrl, opts.generateFn));
      } catch (err) {
        opts.log?.warn({ err, url: page.url }, '[site-facts] fact extraction failed for page — skipping');
      }
    }
  }

  const [pages] = await Promise.all([
    crawlPromise,
    ...Array.from({ length: FACT_EXTRACTION_CONCURRENCY }, () => extractionWorker()),
  ]);

  const facts = dedupeFacts(perPageFacts.flat());
  const siteCategory = await classifySite(siteUrl, pages, opts.generateFn);

  const manifest: SiteManifest = {
    site_url: siteUrl,
    crawl_date: new Date().toISOString(),
    pages_crawled: pages.length,
    page_urls: pages.map((p) => p.url),
    site_category: siteCategory,
  };

  const outputDir = siteOutputDir(opts.workdir, siteUrl);
  await writeSiteFacts(outputDir, { manifest, facts, rawPages: pages });

  return { outputDir, manifest, factsCount: facts.length, pagesCrawled: pages.length };
}
