// services/api/src/site-facts/design/pipeline.ts
//
// Orchestrates design-system extraction: manifest → page selection →
// computed-style capture → deterministic clustering → DTCG tokens →
// screenshots → layout-vision analysis → one design-system.md (tokens
// embedded as JSON). Decoupled from fact extraction (only
// site_manifest.json is shared) and from the separate image-context module
// (this module's vision pass describes page layout/composition; it never
// captions individual image assets — that's image-context's job).
// Vision failures degrade to a tokens-only doc; they never fail the
// pipeline. Screenshots are held in memory only, never persisted to disk.

import puppeteer from 'puppeteer';
import type { GenerateFn } from '@ai-engine/planner';
import { readManifest } from '../store.js';
import type { SiteFactsLogger } from '../types.js';
import { selectDesignPages } from './page-selection.js';
import { captureComputedStyles } from './style-capture.service.js';
import { captureScreenshots } from './screenshot.service.js';
import { buildClusteredTokens } from './clustering.js';
import { buildDesignTokens, flattenTokenPaths } from './dtcg.js';
import { analyzeScreenshots, makeVisionGenerateFn, type VisionGenerateFn } from './vision-analysis.service.js';
import { generateDesignSystemDoc } from './design-doc.service.js';
import { writeDesignSystemDoc } from './design-store.js';

export { makeVisionGenerateFn };

export interface ExtractDesignSystemOptions {
  /** .../site-facts/{hostname} — where site_manifest.json lives. */
  siteFactsOutputDir: string;
  siteName: string;
  /** Absolute path to write design-system.md to (caller decides placement). */
  outputFilePath: string;
  generateFn: GenerateFn;
  visionGenerateFn?: VisionGenerateFn;
  log: SiteFactsLogger;
}

export interface ExtractDesignSystemResult {
  pagesAnalyzed: number;
  tokenCount: number;
  screenshotCount: number;
  visionSucceeded: boolean;
  docMarkdown: string;
}

export async function extractDesignSystem(opts: ExtractDesignSystemOptions): Promise<ExtractDesignSystemResult> {
  const manifest = await readManifest(opts.siteFactsOutputDir);
  const pages = selectDesignPages(manifest);
  if (pages.length === 0) {
    throw new Error('design extraction: manifest contains no usable page URLs');
  }

  const visionFn = opts.visionGenerateFn ?? makeVisionGenerateFn(opts.generateFn);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  let raw;
  let screenshots;
  try {
    const capture = await captureComputedStyles(browser, pages, manifest.site_url, opts.log);
    raw = capture.raw;
    screenshots = await captureScreenshots(browser, pages, opts.log);
  } finally {
    await browser.close();
  }

  const clustered = buildClusteredTokens(raw);
  const tokens = buildDesignTokens(clustered, { siteUrl: manifest.site_url, capturedAt: raw.captured_at });

  const vision = await analyzeScreenshots(screenshots, visionFn, opts.log);
  const visionSucceeded = vision.screenshots.length > 0;

  const docMarkdown = await generateDesignSystemDoc({
    siteName: opts.siteName,
    tokens,
    vision: visionSucceeded ? vision : null,
    screenshots,
    generateFn: opts.generateFn,
  });

  await writeDesignSystemDoc(opts.outputFilePath, docMarkdown);

  return {
    pagesAnalyzed: raw.pages.length,
    tokenCount: flattenTokenPaths(tokens).length,
    screenshotCount: screenshots.length,
    visionSucceeded,
    docMarkdown,
  };
}
