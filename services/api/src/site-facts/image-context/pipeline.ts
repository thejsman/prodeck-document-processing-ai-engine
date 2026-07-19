// services/api/src/site-facts/image-context/pipeline.ts
//
// Orchestrates image-context extraction: manifest → page selection →
// harvest real image URLs from the DOM → caption each with one vision call
// → one image-context.md. Fully disjoint from design/ (no shared code) and
// from fact-extraction (only site_manifest.json is shared).

import puppeteer from 'puppeteer';
import type { GenerateFn } from '@ai-engine/planner';
import { readManifest } from '../store.js';
import type { SiteFactsLogger } from '../types.js';
import { selectImagePages } from './page-selection.js';
import { harvestImages } from './image-harvest.service.js';
import { captionImages } from './vision-caption.service.js';
import { buildImageContextDoc } from './image-context-doc.service.js';
import { writeImageContextDoc } from './store.js';

export interface ExtractImageContextOptions {
  /** .../site-facts/{hostname} — where site_manifest.json lives. */
  siteFactsOutputDir: string;
  /** Absolute path to write image-context.md to (caller decides placement). */
  outputFilePath: string;
  generateFn: GenerateFn;
  log: SiteFactsLogger;
}

export interface ExtractImageContextResult {
  imageCount: number;
  docMarkdown: string;
}

export async function extractImageContext(opts: ExtractImageContextOptions): Promise<ExtractImageContextResult> {
  const manifest = await readManifest(opts.siteFactsOutputDir);
  const pageUrls = selectImagePages(manifest);
  if (pageUrls.length === 0) {
    throw new Error('image-context extraction: manifest contains no usable page URLs');
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  let assets;
  try {
    const harvested = await harvestImages(browser, pageUrls, opts.log);
    assets = await captionImages(browser, harvested, opts.generateFn, opts.log);
  } finally {
    await browser.close();
  }

  const docMarkdown = buildImageContextDoc(manifest.site_url, assets);
  await writeImageContextDoc(opts.outputFilePath, docMarkdown);

  return { imageCount: assets.length, docMarkdown };
}
