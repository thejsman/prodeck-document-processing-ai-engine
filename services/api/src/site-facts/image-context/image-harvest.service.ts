// services/api/src/site-facts/image-context/image-harvest.service.ts
//
// Harvests real <img> URLs from the rendered DOM (not our own screenshots).
// Deterministic — no LLM here. Deduped by absolute URL across pages, capped
// to the most prominent images so the (expensive) captioning step that
// follows has a bounded amount of work to do.

import type { Browser } from 'puppeteer';
import type { SiteFactsLogger } from '../types.js';
import type { ImageAsset } from './types.js';
import { MAX_IMAGES, MIN_IMAGE_DIMENSION_PX } from './types.js';

const PAGE_TIMEOUT_MS = 30_000;

interface InPageImage {
  src: string;
  alt: string;
  width: number;
  height: number;
  isLogo: boolean;
}

/** Runs inside the browser via page.evaluate — must be fully self-contained. */
function harvestImagesInPage(): InPageImage[] {
  const results: InPageImage[] = [];
  const logoEls = new Set(
    Array.from(document.querySelectorAll('header img, nav img, a[href="/"] img')),
  );

  for (const el of Array.from(document.querySelectorAll('img'))) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const src = (el as HTMLImageElement).src; // browser-resolved absolute URL
    if (!src || src.startsWith('data:')) continue;

    const attrs = `${el.getAttribute('src') ?? ''} ${el.getAttribute('alt') ?? ''} ${el.getAttribute('class') ?? ''}`;
    const isLogo = logoEls.has(el) || /logo/i.test(attrs);

    results.push({
      src,
      alt: el.getAttribute('alt') ?? '',
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      isLogo,
    });
  }
  return results;
}

export async function harvestImages(browser: Browser, pageUrls: string[], log: SiteFactsLogger): Promise<ImageAsset[]> {
  const byUrl = new Map<string, ImageAsset>();

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);

  try {
    for (const pageUrl of pageUrls) {
      try {
        try {
          await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT_MS });
        } catch {
          await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
        }
        const images = (await page.evaluate(harvestImagesInPage)) as InPageImage[];
        for (const img of images) {
          if (Math.min(img.width, img.height) < MIN_IMAGE_DIMENSION_PX) continue;
          if (byUrl.has(img.src)) continue; // first occurrence wins
          byUrl.set(img.src, {
            url: img.src,
            alt: img.alt,
            width: img.width,
            height: img.height,
            role: img.isLogo ? 'logo' : 'content',
            description: null,
          });
        }
      } catch (err) {
        log.warn({ err, url: pageUrl }, '[image-context] failed to harvest images from page — skipping');
      }
    }
  } finally {
    await page.close();
  }

  // Logos first (small set, high value), then largest content images.
  const logos = [...byUrl.values()].filter((a) => a.role === 'logo');
  const content = [...byUrl.values()]
    .filter((a) => a.role === 'content')
    .sort((a, b) => b.width * b.height - a.width * a.height);

  return [...logos, ...content].slice(0, MAX_IMAGES);
}
