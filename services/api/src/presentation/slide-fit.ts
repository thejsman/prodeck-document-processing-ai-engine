/**
 * slide-fit.ts — deterministic design QA for fixed-ratio PDF slide decks.
 *
 * The LLM cannot measure its own rendered output, so "this page fits, nothing
 * overlaps, all text is legible, and no stray code leaked onto the page" can
 * only be verified after the fact: render the generated deck headlessly in a
 * real browser, audit it, and hand any offending page back to the LLM to fix.
 *
 * Detection is text-first on purpose: decorative shapes deliberately bleeding
 * off a page edge (clipped by overflow:hidden) or layered under text are a
 * normal design technique and must not be flagged. Clipped/overlapping/
 * illegible TEXT is always a defect; an image is only flagged when most of it
 * is hidden (a half-bleed photo is intentional).
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
/** Any non-decorative visible text below this size is flagged as illegible. Kept as a
 *  single absolute floor (not per-role) to minimize false positives on legitimate small
 *  captions — the generation prompt separately asks for much more generous sizes. */
const LEGIBILITY_FLOOR_PX = 11;
/** Two distinct text blocks count as "overlapping" once their intersection covers this
 *  fraction of the smaller block's area — tolerates minor anti-aliasing/kerning touch. */
const OVERLAP_AREA_FRACTION = 0.3;
/** WCAG contrast ratio floor below which text is flagged as effectively invisible. Real
 *  WCAG AA (4.5:1) would flag plenty of legitimate muted/secondary design text, so this is
 *  set low on purpose — it only catches near-invisible text (e.g. white-on-white from an
 *  incompletely-overridden shared CSS class), not merely low-contrast stylistic choices. */
const CONTRAST_RATIO_FLOOR = 2;
/** Under-fill (content clumped at the top, large blank band at the bottom of the fixed
 *  16:9 page) is flagged only when BOTH hold: content starts within the top band AND the
 *  empty band at the bottom exceeds the fraction below. Requiring "starts at top" avoids
 *  flagging deliberately centered/distributed airy layouts — it targets only the
 *  top-clumped-with-dead-bottom pattern users read as unfinished. */
const UNDERFILL_TOP_MAX_FRACTION = 0.15;
const UNDERFILL_EMPTY_BOTTOM_FRACTION = 0.15;

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

export type SlideOrientation = 'portrait' | 'landscape';

/**
 * Strips a dangling, unterminated tag fragment from the end of `html` (e.g. a
 * generation cut off mid-attribute: `...color:#b8956a;">3</div` with no closing
 * `>`). Appending trusted markup right after such a fragment merges it into the
 * tokenizer's in-progress tag/attribute parse, so the browser never recognises
 * the appended markup as real elements — it renders as literal visible text
 * instead. Call this on any raw/possibly-truncated HTML before appending or
 * splicing in more markup, so the splice point is always a clean tag boundary.
 */
export function closeDanglingTag(html: string): string {
  return html.replace(/<\/?[a-zA-Z][^>]*$/, '');
}

/**
 * Prompt asking the LLM to reflow one overfull page. Content must be preserved
 * — the page count grows instead. Added pages get derived ids so they stay
 * unique without renumbering the rest of the deck.
 */
export function buildReflowPrompt(
  sectionId: string,
  overflowPx: number,
  sectionHtml: string,
  orientation: SlideOrientation = 'portrait',
): string {
  const ratio = orientation === 'portrait' ? '9:16' : '16:9';
  const canvas = orientation === 'portrait' ? '540×960 CSS px (9:16 portrait)' : '1280×720 CSS px (16:9 landscape)';
  const template =
    orientation === 'portrait'
      ? '<section data-section-id="..." id="..." style="aspect-ratio:9/16;overflow:hidden;position:relative;width:100%;max-width:540px;box-sizing:border-box;margin:0 auto 12px">'
      : '<section data-section-id="..." id="..." style="aspect-ratio:16/9;overflow:hidden;position:relative;width:100%;box-sizing:border-box;margin:0 0 12px">';
  return `One page of a ${ratio} PDF presentation is overfull: its content extends ~${overflowPx}px past the page boundary and would be clipped in the exported PDF. Clipped content is never acceptable.

HARD FACTS (immutable):
- The page canvas is EXACTLY ${canvas}.
- All content must sit fully inside the canvas — nothing may touch or cross the boundary.

Rewrite this ONE <section> so everything fits comfortably. Prefer redistributing the content across TWO OR MORE consecutive pages of the exact same format over shrinking type or spacing — never cram, never drop or truncate any text. Keep the page's visual language (palette, typography, styling) unchanged. Each resulting page must still read as a finished, deliberately-composed page that FILLS its canvas — aim for each to occupy roughly 90–98% of the ${canvas} (well-filled, edge to edge) without any element crossing the boundary. Do not split so aggressively that a page is left mostly empty.

Technical frame for every page (unchanged): ${template}. Keep id "${sectionId}" for the first page; name added pages "${sectionId}-2", "${sectionId}-3", … (data-section-id and id identical). Static output only, px font sizes only.

Output ONLY the replacement <section> element(s) — no commentary, no markdown fences, no <html>/<head>/<body>.

CURRENT SECTION:
${sectionHtml}`;
}

export type SlideIssueKind = 'overflow' | 'overlap' | 'legibility' | 'brokenMarkup' | 'contrast' | 'underfill' | 'empty';

export interface SlideIssue {
  id: string;
  kind: SlideIssueKind;
  /** Human-readable description of the specific defect, used in the fix prompt. */
  detail: string;
  /** Only set for kind === 'overflow' — kept for buildReflowPrompt compatibility. */
  overflowPx?: number;
}

/**
 * Prompt asking the LLM to fix one flagged design defect on a page. Overflow
 * reuses buildReflowPrompt verbatim (unchanged prompt/behavior); the other
 * kinds share the same HARD FACTS framing with an issue-specific PROBLEM
 * statement and are always asked to fix ONLY the described defect while
 * preserving content and visual language.
 */
export function buildIssueFixPrompt(
  issue: SlideIssue,
  sectionHtml: string,
  orientation: SlideOrientation = 'portrait',
): string {
  if (issue.kind === 'overflow') {
    return buildReflowPrompt(issue.id, issue.overflowPx ?? 0, sectionHtml, orientation);
  }
  const ratio = orientation === 'portrait' ? '9:16' : '16:9';
  const canvas = orientation === 'portrait' ? '540×960 CSS px (9:16 portrait)' : '1280×720 CSS px (16:9 landscape)';
  const template =
    orientation === 'portrait'
      ? '<section data-section-id="..." id="..." style="aspect-ratio:9/16;overflow:hidden;position:relative;width:100%;max-width:540px;box-sizing:border-box;margin:0 auto 12px">'
      : '<section data-section-id="..." id="..." style="aspect-ratio:16/9;overflow:hidden;position:relative;width:100%;box-sizing:border-box;margin:0 0 12px">';
  const problem =
    issue.kind === 'overlap'
      ? `Two elements on this page visually overlap: ${issue.detail}. Overlapping text is never acceptable on a finished page — rework the layout so nothing collides.`
      : issue.kind === 'legibility'
        ? `This page has text below the legibility floor: ${issue.detail}. Increase it to at least the stated minimum.`
        : issue.kind === 'contrast'
          ? `This page has text that is nearly invisible against its own background: ${issue.detail}. This is almost always caused by reusing a CSS class name (or a shared/global base style) across differently-themed pages without fully overriding every color-critical property for this specific page — e.g. a class styled for a light card elsewhere keeps its light background here while only its text color got the dark-page treatment, or vice versa. Fix it by giving the affected element(s) an explicit, correct background AND text color scoped to this page — do not rely on any shared/global rule for either property.`
          : issue.kind === 'underfill'
            ? `This page is under-filled — ${issue.detail}. A fixed ${ratio} page with a large dead band reads as unfinished; a real designer would never ship it. Redesign the page so its content occupies the FULL ${canvas} edge to edge — aim to fill roughly 90–98% of the canvas. Give the content a genuinely fuller composition: a larger hero/headline, a supporting stat or proof point, a simple CSS/SVG chart, a full-height image column, or better distribution across the whole height (outermost container width:100%;height:100% with a flex column using justify-content:space-between, or a full-height grid). Prefer real substance and a deliberate layout — do NOT merely inflate margins, stretch gaps, or zoom a sparse composition. It must look intentionally composed to fill the page, professional and print-quality, never padded.`
            : `This page's own markup is corrupted — some of its CSS/code is rendering as literal visible text instead of being applied as a stylesheet: ${issue.detail}. The section HTML below is broken; rewrite it from scratch as clean, well-formed HTML with the same content and visual language.`;
  return `One page of a ${ratio} PDF presentation has a design defect that must be fixed.

PROBLEM:
${problem}

HARD FACTS (immutable):
- The page canvas is EXACTLY ${canvas}.
- All content must sit fully inside the canvas — nothing may touch or cross the boundary.
- No two elements holding readable text may overlap.
- Body copy must be at least 16px, captions/labels at least 12px, headlines at least 30px.
- Every element's text color and background color must be explicitly set together and scoped to this specific page — never rely on a shared/global class default for either.

Rewrite this ONE <section> so the defect is fixed. Preserve the page's content and visual language (palette, typography, styling) — change only what's needed to correct the specific problem above. Never truncate or drop content. HTML-escape any literal "<", ">", or "&" that appears in copy text (&lt;, &gt;, &amp;).

Technical frame for every page (unchanged): ${template}. Keep id "${issue.id}" unless the fix requires splitting content across more pages, in which case name added pages "${issue.id}-2", "${issue.id}-3", … (data-section-id and id identical). Static output only, px font sizes only.

Output ONLY the replacement <section> element(s) — no commentary, no markdown fences, no <html>/<head>/<body>.

CURRENT SECTION:
${sectionHtml}`;
}

export interface AuditResult {
  /** The document, serialized from the browser's own parsed DOM after the constraint
   *  style was injected via a real DOM API call — immune to any pre-existing malformed
   *  tag elsewhere in the document corrupting that injection (unlike a string splice). */
  html: string;
  /** At most one issue per section per pass (worst-first: brokenMarkup > overflow >
   *  overlap > legibility), so a section needing multiple fixes isn't reflowed twice
   *  redundantly in the same pass — a later pass re-audits and catches anything left. */
  issues: SlideIssue[];
}

/**
 * Render the deck headlessly, inject the orientation's hard CSS constraints via
 * a real DOM API (not a string splice — see closeDanglingTag's doc comment for
 * why a splice can be corrupted by pre-existing malformed markup), and audit
 * every page for overflow, text-on-text overlap, illegible text, and markup
 * that's rendering as literal visible text instead of being applied as CSS/JS.
 *
 * `html` should be the LLM's raw (already tag-repaired) output — it must NOT
 * already contain the constraint style; this function is the only place that
 * injects it. Default viewport is the portrait canvas (720×1280); landscape
 * callers pass 1280×720 so full-width 16:9 pages resolve to their authored size.
 */
export async function auditSlides(
  html: string,
  viewport: { width: number; height: number },
  constraintCss: string,
): Promise<AuditResult> {
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });

    // document.write() instead of setContent() — same rationale as the PDF export:
    // setContent() can hang on slow external resources under Puppeteer 24.x.
    await page.goto('about:blank', { waitUntil: 'load', timeout: 10_000 });
    await page.evaluate((h: string) => {
      document.open('text/html', 'replace');
      document.write(h);
      document.close();
    }, html);

    // Fonts change text metrics, images can change flow height — wait briefly,
    // but never let a stalled resource block the audit.
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

    // Inject the hard CSS constraints via a real DOM API call — this element
    // cannot be corrupted by any pre-existing malformed tag in the LLM's own
    // markup, unlike the string-splice this replaces. `html` may already carry
    // one from a prior pass (auditSlides re-renders its own previous output on
    // pass 2+) — remove it first so passes never accumulate duplicates.
    await page.evaluate((css: string) => {
      document.getElementById('__pdf-slide-constraints__')?.remove();
      const style = document.createElement('style');
      style.id = '__pdf-slide-constraints__';
      style.textContent = css;
      document.head.appendChild(style);
    }, constraintCss);

    const issues = await page.evaluate(
      (textTolerance: number, imgHiddenFraction: number, legibilityFloor: number, overlapFraction: number, contrastFloor: number, underfillTopMax: number, underfillEmptyBottom: number) => {
        const found: Array<{ id: string; kind: string; detail: string; overflowPx?: number }> = [];
        const isVisible = (el: Element | null): boolean => {
          if (!el) return true;
          const cs = getComputedStyle(el);
          return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) !== 0;
        };

        // ── Contrast helpers (WCAG relative-luminance formula) ──────────────
        const parseRgb = (str: string): { r: number; g: number; b: number; a: number } | null => {
          const m = str.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/);
          if (!m) return null;
          return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
        };
        const relLuminance = (c: { r: number; g: number; b: number }): number => {
          const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
          return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
        };
        const contrastRatio = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number => {
          const la = relLuminance(a);
          const lb = relLuminance(b);
          const lighter = Math.max(la, lb);
          const darker = Math.min(la, lb);
          return (lighter + 0.05) / (darker + 0.05);
        };
        /** Walk up from `el` to find the nearest actual painted background color. Returns
         *  null (skip contrast check) whenever the real background can't be determined from
         *  computed styles alone: a CSS background-image anywhere in the chain, OR reaching
         *  the document root with no explicit background found at all — the latter usually
         *  means a photo is providing the backdrop via a separate sibling <img> (a very
         *  common pattern: an absolutely-positioned <img> behind a text-overlay div), which
         *  this walk (ancestors only) can't see. Only returns a color when a real ancestor
         *  explicitly painted one — never guesses, since a guess here is worse than skipping
         *  (a wrong "white" guess flags perfectly legible photo-backed text as broken). */
        const findEffectiveBg = (el: Element): { r: number; g: number; b: number } | null => {
          // Common hero/photo-panel pattern: a position:relative wrapper containing an
          // <img> plus a text-container div, both as SIBLINGS one or more levels below
          // the wrapper (not ancestors of the text itself) — often with a scrim overlay
          // also as a sibling. An ancestor-only background walk can't see any of that, so
          // it would otherwise fall through to an unrelated background several levels
          // further up. Bail out (skip — can't reliably judge) whenever any positioned
          // ancestor within a capped climb contains an <img> anywhere among its
          // descendants, regardless of which level is positioned vs which level holds
          // the image.
          let posNode: Element | null = el;
          for (let i = 0; i < 5 && posNode; i++) {
            const pos = getComputedStyle(posNode).position;
            if ((pos === 'relative' || pos === 'absolute' || pos === 'fixed') && posNode.querySelector('img')) {
              return null;
            }
            posNode = posNode.parentElement;
          }
          let node: Element | null = el;
          while (node) {
            const cs = getComputedStyle(node);
            if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
            const bg = parseRgb(cs.backgroundColor);
            if (bg && bg.a > 0.5) return bg;
            node = node.parentElement;
          }
          return null; // fell off the top with no explicit background — can't reliably judge
        };

        // ── Broken markup: our own injected style must survive as a real STYLE
        // element (depth-defense — a regression elsewhere could reintroduce a
        // string splice), and no visible text anywhere should look like raw
        // CSS/code that leaked out of a malformed tag.
        const styleEl = document.getElementById('__pdf-slide-constraints__');
        const styleSurvived = !!styleEl && styleEl.tagName === 'STYLE';
        const CODE_LEAK_PATTERNS = [/!important/, /data-section-id\s*=/, /^\s*(html|body|section|div)\s*\{/, /<\/[a-z][a-z0-9]*>/i];
        const sectionsList = Array.from(document.querySelectorAll<HTMLElement>('section[data-section-id]'));
        const idOf = (sec: Element) => sec.getAttribute('data-section-id') ?? '';
        const flaggedBroken = new Set<string>();

        if (!styleSurvived) {
          const firstId = sectionsList[0] ? idOf(sectionsList[0]) : '';
          if (firstId) {
            flaggedBroken.add(firstId);
            found.push({ id: firstId, kind: 'brokenMarkup', detail: 'the page\'s injected layout stylesheet failed to apply and its raw CSS text is at risk of rendering as visible content' });
          }
        }

        const bodyWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (bodyWalker.nextNode()) {
          const node = bodyWalker.currentNode;
          const text = node.textContent || '';
          if (text.trim().length < 20) continue;
          if (!CODE_LEAK_PATTERNS.some((p) => p.test(text))) continue;
          const el = node.parentElement;
          if (!isVisible(el)) continue;
          const owner = el ? el.closest('[data-section-id]') : null;
          const id = owner ? idOf(owner) : sectionsList[0] ? idOf(sectionsList[0]) : '';
          if (id && !flaggedBroken.has(id)) {
            flaggedBroken.add(id);
            found.push({ id, kind: 'brokenMarkup', detail: `visible text reads like raw code: "${text.trim().slice(0, 100)}"` });
          }
        }

        // ── Per-section: overflow, legibility, overlap
        sectionsList.forEach((sec) => {
          const id = idOf(sec);
          if (flaggedBroken.has(id)) return; // already getting a full rewrite this pass

          // ── Empty page: a section with a background but NO actual content —
          // typically a trailing section truncated mid-generation (token cutoff)
          // whose content elements were never written, leaving only a <style>.
          // It renders as a blank colored page and slips past the fill checks
          // (no text/img to measure → neither overflow nor underfill). Flagged
          // for deterministic removal (an empty page is never wanted).
          const contentEls = sec.querySelectorAll(':scope *:not(style):not(script):not(link):not(meta)');
          let sectionText = '';
          const tw0 = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
          while (tw0.nextNode()) {
            const p = tw0.currentNode.parentElement;
            if (p && p.tagName !== 'STYLE' && p.tagName !== 'SCRIPT') sectionText += tw0.currentNode.textContent;
          }
          if (contentEls.length === 0 && !sectionText.trim()) {
            found.push({ id, kind: 'empty', detail: 'section has a background but no content (likely truncated mid-generation) — remove it' });
            return;
          }

          const sr = sec.getBoundingClientRect();
          if (!sr.width || !sr.height) return;

          let maxOver = 0;
          // Union vertical extent of real informational content (text + images),
          // relative to the section top, for the under-fill check.
          let contentTop = Infinity;
          let contentBottom = -Infinity;
          const textBlocks: Array<{ el: Element; rect: DOMRect }> = [];
          const seenBlocks = new Set<Element>();

          const walker = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!node.textContent || !node.textContent.trim()) continue;
            const el = node.parentElement;
            if (!isVisible(el)) continue;

            const range = document.createRange();
            range.selectNodeContents(node);
            const r = range.getBoundingClientRect();
            if (!r.width && !r.height) continue;

            if (r.top - sr.top < contentTop) contentTop = r.top - sr.top;
            if (r.bottom - sr.top > contentBottom) contentBottom = r.bottom - sr.top;

            const over = Math.max(r.bottom - sr.bottom, sr.top - r.top, r.right - sr.right, sr.left - r.left);
            if (over > maxOver) maxOver = over;

            if (el) {
              // SVG text is painted via `fill` (often with gradients) and its font-size
              // is in unscaled user units, so getComputedStyle's `color`/`fontSize` don't
              // reflect what's actually rendered — skip legibility + contrast for it. SVG
              // charts are a deliberate, encouraged design element; judging them here only
              // produces false positives (e.g. a white-filled donut label read as black).
              const inSvg = !!(el.closest && el.closest('svg'));
              const elCs = getComputedStyle(el);
              const fs = parseFloat(elCs.fontSize);
              if (!inSvg && fs && fs < legibilityFloor) {
                found.push({
                  id,
                  kind: 'legibility',
                  detail: `text "${node.textContent.trim().slice(0, 60)}" renders at ${Math.round(fs)}px, below the ${legibilityFloor}px minimum`,
                });
              }
              const fg = inSvg ? null : parseRgb(elCs.color);
              const bg = fg ? findEffectiveBg(el) : null;
              if (fg && bg) {
                const ratio = contrastRatio(fg, bg);
                if (ratio < contrastFloor) {
                  found.push({
                    id,
                    kind: 'contrast',
                    detail: `text "${node.textContent.trim().slice(0, 60)}" (color ${elCs.color}) is nearly invisible against its background (${elCs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? elCs.backgroundColor : 'inherited background'}) — contrast ratio ${ratio.toFixed(2)}:1`,
                  });
                }
              }
              // Only real prose blocks participate in overlap detection — a single
              // decorative glyph (an oversized quotation mark or step numeral layered
              // behind text) or any SVG text is intentional design, not a collision.
              const trimmed = (node.textContent || '').trim();
              const isDecorative = inSvg || trimmed.length <= 2 || !/[a-z0-9]/i.test(trimmed);
              const block = (el.closest('p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption') as Element | null) ?? el;
              if (!isDecorative && !seenBlocks.has(block)) {
                seenBlocks.add(block);
                const br = block.getBoundingClientRect();
                if (br.width > 4 && br.height > 4) textBlocks.push({ el: block, rect: br });
              }
            }
          }

          sec.querySelectorAll('img').forEach((img) => {
            const r = img.getBoundingClientRect();
            if (r.height <= 0) return;
            // An image counts as content for the fill check (bounded to the section).
            if (r.width > 4) {
              contentTop = Math.min(contentTop, Math.max(0, r.top - sr.top));
              contentBottom = Math.max(contentBottom, Math.min(sr.height, r.bottom - sr.top));
            }
            const hidden = Math.max(0, r.bottom - sr.bottom) + Math.max(0, sr.top - r.top);
            if (hidden / r.height > imgHiddenFraction && hidden > maxOver) maxOver = hidden;
          });

          if (maxOver > textTolerance) {
            found.push({ id, kind: 'overflow', detail: `overflows ~${Math.round(maxOver)}px past the page edge`, overflowPx: Math.round(maxOver) });
          }

          // ── Under-fill: content clumped at the top with a large blank band at the
          // bottom. Only flagged when content starts near the top AND the empty band
          // exceeds the threshold — deliberately centered/distributed airy layouts
          // (which start lower) are left alone.
          if (contentBottom > 0 && Number.isFinite(contentTop)) {
            const topFrac = Math.max(0, contentTop) / sr.height;
            const emptyBottomFrac = (sr.height - contentBottom) / sr.height;
            if (topFrac < underfillTopMax && emptyBottomFrac > underfillEmptyBottom) {
              found.push({
                id,
                kind: 'underfill',
                detail: `content fills only the top ${Math.round((contentBottom / sr.height) * 100)}% of the page, leaving the bottom ${Math.round(emptyBottomFrac * 100)}% blank`,
              });
            }
          }

          for (let i = 0; i < textBlocks.length; i++) {
            for (let j = i + 1; j < textBlocks.length; j++) {
              const a = textBlocks[i];
              const b = textBlocks[j];
              if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
              const ra = a.rect;
              const rb = b.rect;
              const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
              const iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
              const overlapArea = ix * iy;
              const smallerArea = Math.min(ra.width * ra.height, rb.width * rb.height);
              if (smallerArea > 0 && overlapArea / smallerArea > overlapFraction) {
                found.push({
                  id,
                  kind: 'overlap',
                  detail: `two text blocks overlap ("${(a.el.textContent || '').trim().slice(0, 40)}" and "${(b.el.textContent || '').trim().slice(0, 40)}")`,
                });
              }
            }
          }
        });

        // Dedupe to at most one issue per section id, worst-first. Fill defects
        // (overflow, underfill) lead — they are the structural "does this page fill
        // its canvas" defects — with underfill just under contrast (invisible text
        // still outranks a merely-sparse page).
        const priority: Record<string, number> = { empty: 0, brokenMarkup: 1, overflow: 2, contrast: 3, underfill: 4, overlap: 5, legibility: 6 };
        const bySection = new Map<string, (typeof found)[number]>();
        for (const issue of found) {
          const existing = bySection.get(issue.id);
          if (!existing || priority[issue.kind] < priority[existing.kind]) bySection.set(issue.id, issue);
        }
        return Array.from(bySection.values());
      },
      TEXT_TOLERANCE_PX,
      IMG_HIDDEN_FRACTION,
      LEGIBILITY_FLOOR_PX,
      OVERLAP_AREA_FRACTION,
      CONTRAST_RATIO_FLOOR,
      UNDERFILL_TOP_MAX_FRACTION,
      UNDERFILL_EMPTY_BOTTOM_FRACTION,
    );

    const outerHtml = await page.evaluate(() => document.documentElement.outerHTML);
    return { html: `<!DOCTYPE html>\n${outerHtml}`, issues: issues as SlideIssue[] };
  } finally {
    await browser.close();
  }
}

/** Overflow beyond this many px (rounding tolerance) triggers the scale-to-fit backstop. */
const FIT_TOLERANCE_PX = 6;

/**
 * Deterministic no-crop backstop, run ONCE after the LLM reflow passes. The LLM
 * can't measure its own output and doesn't always converge within the reflow
 * budget, so this guarantees a page is never clipped: render the deck at the
 * native canvas, and for any `[data-section-id]` whose content still overflows
 * its fixed height, wrap that section's content in a `<div data-fit-wrap>` and
 * uniformly `transform: scale(canvasH/contentH)` it down so everything fits.
 *
 * Baked into the returned HTML (unlike the view-time slide-scaler) because the
 * fit ratio is fixed (not viewport-dependent) and the PDF export — which reads
 * the saved customHtml raw and forces the section to its native fixed size —
 * must render the fitted content un-cropped too. Composes cleanly with the
 * outer view-time slide-scaler (nested transforms) and the PDF export.
 *
 * Uniform scaling of content that already fills the width leaves a small
 * right/bottom margin on the rare pages this fires on (the section's own
 * background fills it, reading as extra padding). That is the accepted
 * last-resort tradeoff: whole-but-slightly-smaller beats clipped. Never
 * distorts (uniform), never crops. A no-op on pages that already fit.
 */
export async function fitOverflowingSections(
  html: string,
  viewport: { width: number; height: number },
  constraintCss: string,
): Promise<string> {
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });

    await page.goto('about:blank', { waitUntil: 'load', timeout: 10_000 });
    await page.evaluate((h: string) => {
      document.open('text/html', 'replace');
      document.write(h);
      document.close();
    }, html);

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
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = '*{animation:none!important;transition:none!important;}';
      document.head.appendChild(style);
    });
    await page.evaluate((css: string) => {
      document.getElementById('__pdf-slide-constraints__')?.remove();
      const style = document.createElement('style');
      style.id = '__pdf-slide-constraints__';
      style.textContent = css;
      document.head.appendChild(style);
    }, constraintCss);

    const fittedCount = await page.evaluate((tolerance: number) => {
      let fitted = 0;
      document.querySelectorAll<HTMLElement>('section[data-section-id]').forEach((sec) => {
        if (sec.querySelector(':scope > [data-fit-wrap]')) return; // already wrapped
        const boxH = sec.clientHeight;
        if (!boxH) return;
        // scrollHeight reflects the true content height including the part clipped by
        // the section's overflow:hidden — the actual overflow we must scale away.
        const contentH = sec.scrollHeight;
        if (contentH <= boxH + tolerance) return; // fits — leave untouched

        const s = boxH / contentH;
        const W = sec.clientWidth;
        // Move only the section's real content into the wrapper; leave <style>/<script>/
        // <link> at the section level so stylesheets are not scaled or displaced.
        const wrap = document.createElement('div');
        wrap.setAttribute('data-fit-wrap', '');
        wrap.style.cssText = `position:relative;width:${W}px;height:${contentH}px;transform-origin:top left;transform:scale(${s.toFixed(4)});`;
        const kept: Node[] = [];
        while (sec.firstChild) {
          const node = sec.firstChild;
          const tag = node.nodeType === 1 ? (node as Element).tagName : '';
          if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'LINK') {
            kept.push(node);
            sec.removeChild(node);
          } else {
            wrap.appendChild(node);
          }
        }
        for (const k of kept) sec.appendChild(k);
        sec.appendChild(wrap);
        fitted++;
      });
      return fitted;
    }, FIT_TOLERANCE_PX);

    if (fittedCount === 0) return html; // nothing overflowed — return input unchanged

    const outerHtml = await page.evaluate(() => document.documentElement.outerHTML);
    return `<!DOCTYPE html>\n${outerHtml}`;
  } finally {
    await browser.close();
  }
}
