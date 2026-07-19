// services/api/src/site-facts/design/screenshot.service.ts
//
// Screenshot capture feeding the layout-vision pass: full pages at desktop +
// mobile plus targeted component crops via deterministic selectors. JPEG
// only — the LLM bridge's vision path hardcodes image/jpeg. Screenshots are
// held in memory only (base64) and never written to disk — this module's
// only durable output is design-system.md.

import type { Browser } from 'puppeteer';
import type { SiteFactsLogger } from '../types.js';
import type { CapturedScreenshot, ScreenshotSpec, SelectedPage } from './types.js';
import { DESIGN_VIEWPORTS } from './types.js';

const JPEG_QUALITY = 70;
const FULLPAGE_MAX_HEIGHT = 4000;
const PAGE_TIMEOUT_MS = 30_000;

const CROP_SELECTORS: Record<string, string> = {
  'crop-header': 'header, nav',
  'crop-hero': 'main > section, main > div, section',
  'crop-cards': '[class*="card" i], ul, .grid',
  'crop-footer': 'footer',
  'crop-form': 'form',
};

/**
 * Plan which screenshots to take from the selected pages. Pure and
 * deterministic — crops whose selector matches nothing are skipped silently
 * at capture time.
 */
export function planScreenshots(pages: SelectedPage[]): ScreenshotSpec[] {
  const roles = new Set(pages.map((p) => p.role));
  const specs: ScreenshotSpec[] = [
    { id: 'homepage-desktop', kind: 'fullpage', pageRole: 'homepage', viewport: 'desktop' },
    { id: 'homepage-mobile', kind: 'fullpage', pageRole: 'homepage', viewport: 'mobile' },
  ];

  if (roles.has('detail')) {
    specs.push({ id: 'detail-desktop', kind: 'fullpage', pageRole: 'detail', viewport: 'desktop' });
  } else if (roles.has('listing')) {
    specs.push({ id: 'listing-desktop', kind: 'fullpage', pageRole: 'listing', viewport: 'desktop' });
  }

  const cardsRole = roles.has('listing') ? 'listing' : 'homepage';
  specs.push(
    { id: 'crop-header', kind: 'crop', pageRole: 'homepage', viewport: 'desktop', cropSelector: CROP_SELECTORS['crop-header'] },
    { id: 'crop-hero', kind: 'crop', pageRole: 'homepage', viewport: 'desktop', cropSelector: CROP_SELECTORS['crop-hero'] },
    { id: 'crop-cards', kind: 'crop', pageRole: cardsRole, viewport: 'desktop', cropSelector: CROP_SELECTORS['crop-cards'] },
    { id: 'crop-footer', kind: 'crop', pageRole: 'homepage', viewport: 'desktop', cropSelector: CROP_SELECTORS['crop-footer'] },
  );
  if (roles.has('form')) {
    specs.push({ id: 'crop-form', kind: 'crop', pageRole: 'form', viewport: 'desktop', cropSelector: CROP_SELECTORS['crop-form'] });
  }
  return specs;
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Runs in-page: bounding rect of the first visible, reasonably-sized match. */
function findCropRect(selector: string, minHeight: number): CropRect | null {
  for (const el of Array.from(document.querySelectorAll(selector))) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 100 || rect.height < minHeight) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    return {
      x: Math.max(0, rect.x + window.scrollX),
      y: Math.max(0, rect.y + window.scrollY),
      width: Math.round(rect.width),
      height: Math.min(Math.round(rect.height), 2000),
    };
  }
  return null;
}

export async function captureScreenshots(
  browser: Browser,
  pages: SelectedPage[],
  log: SiteFactsLogger,
): Promise<CapturedScreenshot[]> {
  const specs = planScreenshots(pages);
  const byRole = new Map(pages.map((p) => [p.role, p]));
  const captured: CapturedScreenshot[] = [];

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);

  // Group specs by (pageRole, viewport) to avoid redundant navigations.
  let currentKey = '';
  try {
    for (const spec of specs) {
      const target = byRole.get(spec.pageRole);
      if (!target) continue;
      const vp = DESIGN_VIEWPORTS.find((v) => v.name === spec.viewport)!;
      const key = `${target.url}|${vp.name}`;

      try {
        if (key !== currentKey) {
          await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
          try {
            await page.goto(target.url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT_MS });
          } catch {
            await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          currentKey = key;
        }

        let base64Jpeg: string;
        if (spec.kind === 'fullpage') {
          const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
          const buffer = (await page.screenshot({
            type: 'jpeg',
            quality: JPEG_QUALITY,
            clip: { x: 0, y: 0, width: vp.width, height: Math.min(bodyHeight, FULLPAGE_MAX_HEIGHT) },
          })) as Buffer;
          base64Jpeg = buffer.toString('base64');
        } else {
          const minHeight = spec.id === 'crop-header' || spec.id === 'crop-footer' ? 40 : 200;
          const rect = (await page.evaluate(findCropRect, spec.cropSelector!, minHeight)) as CropRect | null;
          if (!rect) continue; // selector matched nothing — skip silently per plan
          const buffer = (await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY, clip: rect })) as Buffer;
          base64Jpeg = buffer.toString('base64');
        }

        captured.push({ id: spec.id, pageUrl: target.url, viewport: spec.viewport, kind: spec.kind, base64Jpeg });
      } catch (err) {
        log.warn({ err, id: spec.id, url: target.url }, '[design] screenshot capture failed — skipping');
      }
    }
  } finally {
    await page.close();
  }

  return captured;
}
