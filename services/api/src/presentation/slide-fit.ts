/**
 * slide-fit.ts — deterministic fit verification for fixed-ratio PDF slide decks.
 *
 * The LLM cannot measure rendered text, so "all content fits the 9:16 page" can
 * only be guaranteed after the fact: render the generated deck headlessly,
 * detect pages whose text (or imagery) crosses the page boundary, and hand each
 * overfull page back to the LLM to redistribute across more pages.
 *
 * Detection is text-first on purpose: decorative shapes deliberately bleeding
 * off a page edge (clipped by overflow:hidden) are a normal design technique
 * and must not be flagged. Clipped text is always a defect; an image is only
 * flagged when most of it is hidden (a half-bleed photo is intentional).
 */

import puppeteer from 'puppeteer';

export interface SlideOverflow {
  id: string;
  overflowPx: number;
}

/** Text clipped beyond this many px counts as overflow (sub-pixel/rounding tolerance). */
const TEXT_TOLERANCE_PX = 4;
/** An <img> counts as clipped only when more than this fraction of it is hidden. */
const IMG_HIDDEN_FRACTION = 0.4;

/**
 * Byte bounds of `<section … data-section-id="{id}" …>…</section>` in `html`,
 * nesting-aware. Returns null when the section is not found or is unterminated.
 */
export function findSectionBounds(html: string, sectionId: string): { start: number; end: number } | null {
  const escaped = sectionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = new RegExp(`<section\\b[^>]*\\bdata-section-id="${escaped}"[^>]*>`, 'i').exec(html);
  if (!open) return null;
  let depth = 1;
  let i = open.index + open[0].length;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf('<section', i);
    const nextClose = html.indexOf('</section>', i);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + '<section'.length;
    } else {
      depth--;
      i = nextClose + '</section>'.length;
    }
  }
  return depth === 0 ? { start: open.index, end: i } : null;
}

/**
 * Pull the replacement `<section>` block(s) out of an LLM reflow reply.
 * Strips markdown fences and any prose around the markup. Returns null when the
 * reply has no usable sections or tries to smuggle in document-level tags.
 */
export function extractSectionBlocks(reply: string): string | null {
  const cleaned = reply.replace(/```(?:html)?/gi, '').trim();
  const start = cleaned.search(/<section\b/i);
  const end = cleaned.toLowerCase().lastIndexOf('</section>');
  if (start === -1 || end === -1 || end < start) return null;
  const block = cleaned.slice(start, end + '</section>'.length);
  if (!/\bdata-section-id="/i.test(block)) return null;
  if (/<(?:html|head|body)\b/i.test(block)) return null;
  return block;
}

/**
 * Prompt asking the LLM to reflow one overfull page. Content must be preserved
 * — the page count grows instead. Added pages get derived ids so they stay
 * unique without renumbering the rest of the deck.
 */
export function buildReflowPrompt(sectionId: string, overflowPx: number, sectionHtml: string): string {
  return `One page of a 9:16 PDF presentation is overfull: its content extends ~${overflowPx}px past the page boundary and would be clipped in the exported PDF. Clipped content is never acceptable.

HARD FACTS (immutable):
- The page canvas is EXACTLY 540×960 CSS px (9:16 portrait).
- All content must sit fully inside the canvas — nothing may touch or cross the boundary.

Rewrite this ONE <section> so everything fits comfortably. Prefer redistributing the content across TWO OR MORE consecutive pages of the exact same format over shrinking type or spacing — never cram, never drop or truncate any text. Keep the page's visual language (palette, typography, styling) unchanged.

Technical frame for every page (unchanged): <section data-section-id="..." id="..." style="aspect-ratio:9/16;overflow:hidden;position:relative;width:100%;max-width:540px;box-sizing:border-box;margin:0 auto 12px">. Keep id "${sectionId}" for the first page; name added pages "${sectionId}-2", "${sectionId}-3", … (data-section-id and id identical). Static output only, px font sizes only.

Output ONLY the replacement <section> element(s) — no commentary, no markdown fences, no <html>/<head>/<body>.

CURRENT SECTION:
${sectionHtml}`;
}

/**
 * Render the deck headlessly and return the pages whose text (or mostly-hidden
 * imagery) crosses their own 9:16 boundary. `html` must already contain the
 * portrait constraint CSS so pages are measured at their locked size.
 */
export async function findOverflowingSlides(html: string): Promise<SlideOverflow[]> {
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 720, height: 1280, deviceScaleFactor: 1 });

    // document.write() instead of setContent() — same rationale as the PDF export:
    // setContent() can hang on slow external resources under Puppeteer 24.x.
    await page.goto('about:blank', { waitUntil: 'load', timeout: 10_000 });
    await page.evaluate((h: string) => {
      document.open('text/html', 'replace');
      document.write(h);
      document.close();
    }, html);

    // Fonts change text metrics, images can change flow height — wait briefly,
    // but never let a stalled resource block the fit check.
    await Promise.race([
      page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready.then(() => {})).catch(() => {}),
      new Promise<void>((r) => setTimeout(r, 4_000)),
    ]);
    await Promise.race([
      page.evaluate(() =>
        Promise.all(
          Array.from(document.images)
            .filter((img) => !img.complete)
            .map((img) => new Promise<void>((resolve) => { img.onload = img.onerror = () => resolve(); }))
        )
      ).catch(() => {}),
      new Promise<void>((r) => setTimeout(r, 4_000)),
    ]);

    // Freeze animations so mid-transition positions can't skew measurements.
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = '*{animation:none!important;transition:none!important;}';
      document.head.appendChild(style);
    });

    return await page.evaluate(
      (textTolerance: number, imgHiddenFraction: number) => {
        const out: Array<{ id: string; overflowPx: number }> = [];
        document.querySelectorAll<HTMLElement>('section[data-section-id]').forEach((sec) => {
          const sr = sec.getBoundingClientRect();
          if (!sr.width || !sr.height) return;
          let maxOver = 0;

          const walker = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!node.textContent || !node.textContent.trim()) continue;
            const el = node.parentElement;
            if (el) {
              const cs = getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
            }
            const range = document.createRange();
            range.selectNodeContents(node);
            const r = range.getBoundingClientRect();
            if (!r.width && !r.height) continue;
            const over = Math.max(r.bottom - sr.bottom, sr.top - r.top, r.right - sr.right, sr.left - r.left);
            if (over > maxOver) maxOver = over;
          }

          sec.querySelectorAll('img').forEach((img) => {
            const r = img.getBoundingClientRect();
            if (r.height <= 0) return;
            const hidden =
              Math.max(0, r.bottom - sr.bottom) + Math.max(0, sr.top - r.top);
            if (hidden / r.height > imgHiddenFraction) {
              maxOver = Math.max(maxOver, hidden);
            }
          });

          if (maxOver > textTolerance) {
            out.push({ id: sec.getAttribute('data-section-id') ?? '', overflowPx: Math.round(maxOver) });
          }
        });
        return out;
      },
      TEXT_TOLERANCE_PX,
      IMG_HIDDEN_FRACTION,
    );
  } finally {
    await browser.close();
  }
}
