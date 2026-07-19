// services/api/src/site-facts/image-context/vision-caption.service.ts
//
// One short, factual vision call per harvested image: "what does this
// depict" — never a design/layout critique, never invention. Images are
// captured by navigating Puppeteer directly to the image URL and
// screenshotting it as JPEG, which re-encodes whatever the source format
// was (PNG/WebP/GIF/etc.) into the one format the LLM bridge's vision path
// actually declares (media_type is hardcoded to image/jpeg) — this avoids
// sending mismatched bytes without needing a new image-processing dependency.

import type { Browser } from 'puppeteer';
import type { GenerateFn } from '@ai-engine/planner';
import type { SiteFactsLogger } from '../types.js';
import type { ImageAsset } from './types.js';

const IMAGE_LOAD_TIMEOUT_MS = 15_000;
const MAX_BASE64_LENGTH = 4_000_000;
const MAX_DESCRIPTION_CHARS = 300;

export const IMAGE_CAPTION_PROMPT = `Describe ONLY what is visibly depicted in this image, in one or two short factual sentences (max ${MAX_DESCRIPTION_CHARS} characters).

Rules:
1. Describe only what you can see — no guessing at brand intent, no design commentary, no recommendations.
2. If the image is a logo or wordmark, say so plainly (e.g. "Company wordmark logo in dark green.").
3. Return ONLY the description text — no JSON, no preamble, no quotes.`;

/** Prefixes the DESIGN_IMAGE: marker the LLM bridge's vision path expects. */
function makeVisionGenerateFn(generateFn: GenerateFn): (base64Jpeg: string) => Promise<string> {
  return (base64Jpeg) => generateFn(`DESIGN_IMAGE:${base64Jpeg}\n\n${IMAGE_CAPTION_PROMPT}`);
}

/** Adds a `description` to each asset in place (returns a new array); captioning failures leave description null and are never thrown. */
export async function captionImages(
  browser: Browser,
  assets: ImageAsset[],
  generateFn: GenerateFn,
  log: SiteFactsLogger,
): Promise<ImageAsset[]> {
  const visionFn = makeVisionGenerateFn(generateFn);
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 800, deviceScaleFactor: 1 });

  const results: ImageAsset[] = [];
  try {
    for (const asset of assets) {
      try {
        await page.goto(asset.url, { waitUntil: 'load', timeout: IMAGE_LOAD_TIMEOUT_MS });
        const buffer = (await page.screenshot({ type: 'jpeg', quality: 70, fullPage: true })) as Buffer;
        const base64 = buffer.toString('base64');
        if (base64.length > MAX_BASE64_LENGTH) {
          log.warn({ url: asset.url, bytes: buffer.length }, '[image-context] image too large for vision bridge — skipping caption');
          results.push(asset);
          continue;
        }
        const raw = await visionFn(base64);
        const description = raw.trim().slice(0, MAX_DESCRIPTION_CHARS) || null;
        results.push({ ...asset, description });
      } catch (err) {
        log.warn({ err, url: asset.url }, '[image-context] captioning failed for image — leaving uncaptioned');
        results.push(asset);
      }
    }
  } finally {
    await page.close();
  }
  return results;
}
