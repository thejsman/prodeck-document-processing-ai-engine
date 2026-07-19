// services/api/src/site-facts/design/style-capture.service.ts
//
// Deterministic computed-style extraction. Renders each selected page at
// three viewports (mobile/tablet/desktop) and samples getComputedStyle over
// a broad element set. No LLM involvement; output is the raw, ungrouped
// RawComputedStyles that clustering consumes. Image URL harvesting lives
// entirely in the separate image-context module, not here.

import type { Browser, Page } from 'puppeteer';
import type { SiteFactsLogger } from '../types.js';
import type {
  ElementSample,
  ImageSample,
  RawComputedStyles,
  RawPageStyles,
  RawViewportStyles,
  SelectedPage,
} from './types.js';
import { DESIGN_VIEWPORTS } from './types.js';

const PAGE_TIMEOUT_MS = 30_000;
const SETTLE_DELAY_MS = 500;

export interface PageCaptureFailure {
  url: string;
  viewport: string;
  error: string;
}

export interface StyleCaptureResult {
  raw: RawComputedStyles;
  failures: PageCaptureFailure[];
}

interface InPageResult {
  element_samples: ElementSample[];
  image_samples: ImageSample[];
  icon_summary: { svg_count: number; raster_count: number };
}

/**
 * Runs inside the browser via page.evaluate — must be fully self-contained
 * (no closures over module scope). Samples computed styles per element
 * group, deduping by style tuple with counts.
 */
function runStyleSampler(): InPageResult {
  const GROUP_SELECTORS: [string, string][] = [
    ['h1', 'h1'], ['h2', 'h2'], ['h3', 'h3'], ['h4', 'h4'], ['h5', 'h5'], ['h6', 'h6'],
    ['p', 'p'],
    ['a', 'a[href]'],
    ['button', 'button, [role="button"], input[type="submit"], a[class*="btn" i], a[class*="button" i]'],
    ['input', 'input:not([type=hidden]), select, textarea'],
    ['label', 'label'],
    ['container', 'header, nav, footer, main, section, article, aside'],
    ['card', '[class*="card" i]'],
  ];
  const MAX_SCANNED = 200;
  const MAX_UNIQUE = 40;

  const samples: ElementSample[] = [];

  for (const [group, selector] of GROUP_SELECTORS) {
    const seen = new Map<string, ElementSample>();
    let scanned = 0;
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (scanned >= MAX_SCANNED) break;
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || rect.width === 0 || rect.height === 0) continue;
      scanned += 1;

      const sample: ElementSample = {
        group: group as ElementSample['group'],
        tag: el.tagName.toLowerCase(),
        count: 1,
        color: cs.color,
        background_color: cs.backgroundColor,
        border_color: cs.borderTopColor,
        font_family: cs.fontFamily,
        font_size: cs.fontSize,
        font_weight: cs.fontWeight,
        line_height: cs.lineHeight,
        letter_spacing: cs.letterSpacing,
        margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft],
        padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
        gap: cs.gap,
        border_radius: cs.borderRadius,
        box_shadow: cs.boxShadow,
      };
      const key = JSON.stringify([
        sample.color, sample.background_color, sample.border_color,
        sample.font_family, sample.font_size, sample.font_weight,
        sample.margin, sample.padding, sample.gap, sample.border_radius, sample.box_shadow,
      ]);
      const existing = seen.get(key);
      if (existing) {
        existing.count += 1;
      } else if (seen.size < MAX_UNIQUE) {
        seen.set(key, sample);
      }
    }
    samples.push(...seen.values());
  }

  const imageSamples: ImageSample[] = [];
  let svgCount = 0;
  let rasterCount = 0;
  const ICON_MAX_PX = 48;

  let imagesScanned = 0;
  for (const el of Array.from(document.querySelectorAll('img, svg'))) {
    if (imagesScanned >= 100) break;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    imagesScanned += 1;
    const isSvg = el.tagName.toLowerCase() === 'svg';
    if (Math.max(rect.width, rect.height) <= ICON_MAX_PX) {
      if (isSvg) svgCount += 1;
      else rasterCount += 1;
    } else {
      imageSamples.push({
        kind: isSvg ? 'svg' : 'img',
        rendered_w: Math.round(rect.width),
        rendered_h: Math.round(rect.height),
        aspect_ratio: rect.height > 0 ? Math.round((rect.width / rect.height) * 100) / 100 : 0,
      });
    }
  }

  return { element_samples: samples, image_samples: imageSamples, icon_summary: { svg_count: svgCount, raster_count: rasterCount } };
}

async function settle(page: Page): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
  void page;
}

/**
 * Capture computed styles for all selected pages at all design viewports.
 * Per-viewport failures are recorded and skipped, never thrown; the whole
 * capture only throws if the homepage itself never rendered at any viewport.
 */
export async function captureComputedStyles(
  browser: Browser,
  pages: SelectedPage[],
  siteUrl: string,
  log: SiteFactsLogger,
): Promise<StyleCaptureResult> {
  const failures: PageCaptureFailure[] = [];
  const capturedPages: RawPageStyles[] = [];

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);

  try {
    for (const selected of pages) {
      const viewports: RawViewportStyles[] = [];
      let notFoundVerified = selected.role !== 'notfound';

      for (const vp of DESIGN_VIEWPORTS) {
        try {
          await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
          let response;
          try {
            response = await page.goto(selected.url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT_MS });
          } catch {
            response = await page.goto(selected.url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
          }
          if (selected.role === 'notfound') {
            if (response?.status() !== 404) break; // soft-404 site — drop the probe entirely
            notFoundVerified = true;
          }
          await settle(page);
          const result = (await page.evaluate(runStyleSampler)) as InPageResult;
          viewports.push({ viewport: vp.name, width: vp.width, ...result });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          failures.push({ url: selected.url, viewport: vp.name, error });
          log.warn({ err, url: selected.url, viewport: vp.name }, '[design] viewport capture failed — skipping');
        }
      }

      if (viewports.length > 0 && notFoundVerified) {
        capturedPages.push({ url: selected.url, role: selected.role, viewports });
      }
    }
  } finally {
    await page.close();
  }

  if (!capturedPages.some((p) => p.role === 'homepage')) {
    throw new Error('design capture failed: homepage did not render at any viewport');
  }

  return {
    raw: { site_url: siteUrl, captured_at: new Date().toISOString(), pages: capturedPages },
    failures,
  };
}
