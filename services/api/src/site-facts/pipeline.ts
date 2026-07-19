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
import type { CrawlOptions, Fact, SiteFactsLogger, SiteManifest } from './types.js';

const FACT_EXTRACTION_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
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

  const pages = await crawlSite(siteUrl, { maxPages: opts.maxPages, maxDepth: opts.maxDepth, log: opts.log });

  const perPageFacts = await mapWithConcurrency(pages, FACT_EXTRACTION_CONCURRENCY, async (page) => {
    try {
      return await extractFactsForPage(page, siteUrl, opts.generateFn);
    } catch (err) {
      opts.log?.warn({ err, url: page.url }, '[site-facts] fact extraction failed for page — skipping');
      return [] as Fact[];
    }
  });

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
