/**
 * pdfCaptureRenderer.ts
 *
 * PDF generation approach B: "page-aware capture mode".
 *
 * Each live <section> is cloned off-screen. We measure its natural height first,
 * then decide:
 *   - Section fits in 720px  → capture at natural height, center vertically in slide
 *   - Section taller than 720px → capture full height, scale down with drawImage (no clipping)
 *
 * This eliminates both the "content clipped" and "large empty space" problems.
 */

import h2canvas from 'html2canvas';
import JsPDF from 'jspdf';

// 16:9 landscape slide dimensions
const CAPTURE_W = 1280;
const CAPTURE_H = 720;

// jsPDF page size in pt (maps 1280×720 px → these pt dimensions preserving ratio)
const PDF_W_PT = 841.89;
const PDF_H_PT = 473.56; // 841.89 × (720/1280)

export interface CapturePDFOptions {
  title?: string;
  quality?: number;
  onProgress?: (p: { pct: number; message: string }) => void;
  /** When set, each [data-section-id] section is capped to this pixel height (PDF slide mode). */
  slideModeHeight?: number;
}

export interface CapturePDFResult {
  success: boolean;
  error?: string;
}

/** Copy all CSS custom properties (--foo: bar) from `from` to `to`. */
function copyCustomProps(from: HTMLElement, to: HTMLElement, win: Window) {
  const computed = win.getComputedStyle(from);
  for (const prop of Array.from(computed)) {
    if (prop.startsWith('--')) {
      to.style.setProperty(prop, computed.getPropertyValue(prop).trim());
    }
  }
}

/** Two rAF ticks — lets the browser finish layout + paint before measuring. */
function nextFrame(): Promise<void> {
  return new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

/**
 * Convert an image URL to a same-origin fetchable URL.
 * External URLs (http/https) are routed through the /api/proxy-image route
 * so the server fetches them without CORS restrictions.
 * Local /presentation-images/ paths are rewritten to /api/presentation-images/.
 */
function toProxyUrl(src: string): string {
  if (src.startsWith('data:')) return src; // already a data URL
  if (src.startsWith('/presentation-images/')) return `/api${src}`;
  if (src.startsWith('http://') || src.startsWith('https://'))
    return `/api/proxy-image?url=${encodeURIComponent(src)}`;
  return src;
}

/**
 * Find every <img> in the cloned element whose src is a cross-origin URL,
 * fetch it through the proxy, and replace the src with a data URL so
 * html2canvas can draw it without CORS errors.
 * Also handles lazy-loaded images where src is empty but data-src / data-lazy-src holds the URL.
 */
async function inlineCloneImages(clone: HTMLElement): Promise<void> {
  const imgs = Array.from(clone.querySelectorAll<HTMLImageElement>('img'));
  if (imgs.length === 0) return;

  await Promise.allSettled(
    imgs.map(async img => {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
      if (!src || src.startsWith('data:')) return; // nothing to do
      // Ensure the resolved src is actually set on the element
      if (!img.getAttribute('src') || img.getAttribute('src') !== src) img.src = src;

      try {
        const proxyUrl = toProxyUrl(src);
        const res  = await fetch(proxyUrl);
        if (!res.ok) return;
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        img.src = dataUrl;
        img.removeAttribute('crossorigin');
        img.removeAttribute('crossOrigin');
      } catch {
        // Leave image as-is if proxy fails — better than crashing
      }
    }),
  );
}

// Scale threshold: if the section's natural height * FIT_THRESHOLD ≤ CAPTURE_H, it fits
// scaled on one page. Sections taller than CAPTURE_H / FIT_THRESHOLD get sliced.
// Keep this LOW (0.28) so nearly all sections — including tall generic/stepped variants
// with 6+ items — scale-to-fit on one slide rather than being pixel-sliced mid-card.
// Only truly extreme sections (> ~2570px) will slice, and even those get sliced cleanly.
const FIT_THRESHOLD = 0.28;

/**
 * Scale `src` canvas into a CAPTURE_W×CAPTURE_H slide canvas when it fits.
 * Used only when naturalH <= CAPTURE_H / FIT_THRESHOLD (i.e. content fits on one page).
 */
function scaleToSlide(src: HTMLCanvasElement, rootBg: string): HTMLCanvasElement {
  const slideW = Math.round(CAPTURE_W * 1.5);
  const slideH = Math.round(CAPTURE_H * 1.5);
  const out = document.createElement('canvas');
  out.width = slideW;
  out.height = slideH;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = rootBg;
  ctx.fillRect(0, 0, slideW, slideH);
  // Scale to fit within the slide (fit-contain: respect both W and H)
  const ratioH = slideH / src.height;
  const ratioW = slideW / src.width;
  const ratio = Math.min(ratioH, ratioW);
  const dw = Math.round(src.width * ratio);
  const dh = Math.round(src.height * ratio);
  const dx = Math.round((slideW - dw) / 2);
  const dy = Math.round((slideH - dh) / 2);
  ctx.drawImage(src, dx, dy, dw, dh);
  return out;
}

/**
 * Parse a CSS color string (rgb/rgba/hex) into [r, g, b] components.
 */
function parseBgColor(color: string): [number, number, number] {
  const rgba = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgba) return [parseInt(rgba[1]), parseInt(rgba[2]), parseInt(rgba[3])];
  const hex = color.replace('#', '');
  if (hex.length === 3) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  if (hex.length >= 6) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  return [13, 17, 23]; // dark fallback
}

/**
 * Check if a horizontal pixel row in the canvas is "background-like":
 * at least 85% of pixels are within ±30 of the rootBg color.
 * Used to find natural gap rows between cards for smart page breaks.
 */
function isBackgroundRow(data: Uint8ClampedArray, y: number, width: number, bg: [number, number, number]): boolean {
  const [br, bg2, bb] = bg;
  let matches = 0;
  const step = Math.max(1, Math.floor(width / 80)); // sample ~80 pixels per row
  let sampled = 0;
  for (let x = 0; x < width; x += step) {
    const idx = (y * width + x) * 4;
    const dr = Math.abs(data[idx] - br);
    const dg = Math.abs(data[idx + 1] - bg2);
    const db = Math.abs(data[idx + 2] - bb);
    if (dr + dg + db < 90) matches++;
    sampled++;
  }
  return matches / sampled >= 0.85;
}

/**
 * Find the best row to cut at, starting from `nominalY` and scanning ±SEARCH_PX
 * for a background-like row. Returns `nominalY` if no better row found.
 */
function findCutRow(
  data: Uint8ClampedArray,
  nominalY: number,
  width: number,
  height: number,
  bg: [number, number, number],
): number {
  const SEARCH_PX = 120; // scan ±120px from nominal cut point
  const lo = Math.max(0, nominalY - SEARCH_PX);
  const hi = Math.min(height - 1, nominalY + SEARCH_PX);

  // Prefer rows closest to nominalY — spiral outward from center
  for (let delta = 0; delta <= SEARCH_PX; delta++) {
    const above = nominalY - delta;
    const below = nominalY + delta;
    if (above >= lo && isBackgroundRow(data, above, width, bg)) return above;
    if (below <= hi && below !== above && isBackgroundRow(data, below, width, bg)) return below;
  }
  return nominalY;
}

/**
 * Slice a tall full-height canvas into CAPTURE_H-tall page chunks.
 * Smart slicing: instead of cutting at fixed pixel intervals, scans ±120px
 * around each nominal cut point to find a background-colored row (gap between
 * cards), so cuts never land mid-element.
 */
function sliceIntoPages(src: HTMLCanvasElement, rootBg: string): HTMLCanvasElement[] {
  const slideW = Math.round(CAPTURE_W * 1.5);
  const slideH = Math.round(CAPTURE_H * 1.5);
  const bg = parseBgColor(rootBg);

  // Read pixel data once for cut-point detection
  const scanCanvas = document.createElement('canvas');
  scanCanvas.width = src.width;
  scanCanvas.height = src.height;
  const scanCtx = scanCanvas.getContext('2d')!;
  scanCtx.drawImage(src, 0, 0);
  const pixelData = scanCtx.getImageData(0, 0, src.width, src.height).data;

  const pages: HTMLCanvasElement[] = [];
  let sy = 0;

  while (sy < src.height) {
    const nominalEnd = sy + slideH;
    // Find the best cut row near the nominal end of this page
    const cutY = nominalEnd >= src.height
      ? src.height
      : findCutRow(pixelData, nominalEnd, src.width, src.height, bg);

    const chunkH = Math.min(cutY - sy, src.height - sy);
    if (chunkH <= 0) break;

    const out = document.createElement('canvas');
    out.width = slideW;
    out.height = slideH;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = rootBg;
    ctx.fillRect(0, 0, slideW, slideH);

    // Scale this chunk to fill the slide width, anchored at top
    const scaleRatio = slideW / src.width;
    const destH = Math.round(chunkH * scaleRatio);
    const destY = 0; // top-aligned on slide
    ctx.drawImage(src, 0, sy, src.width, chunkH, 0, destY, slideW, destH);

    pages.push(out);
    sy = cutY;
  }

  return pages;
}

export async function generateCapturePDF(
  contentEl: HTMLElement,
  rootEl: HTMLElement,
  options: CapturePDFOptions = {},
): Promise<CapturePDFResult> {
  const { title = 'Microsite', quality = 0.90, onProgress, slideModeHeight } = options;
  const progress = (pct: number, message: string) => onProgress?.({ pct, message });

  // Derive document and window from the passed element.
  // When contentEl comes from an iframe, this gives us that iframe's document/window
  // so all CSS class styles apply to clones without polluting the parent app.
  const captureDoc = contentEl.ownerDocument;
  const captureWin = (captureDoc.defaultView ?? window) as Window & typeof globalThis;

  try {
    progress(2, 'Finding sections…');

    // [data-section-id] is set by AnimatedSection for every section regardless of type.
    // Typed React sections render inner <section> elements; design-skill microsites use
    // customHtml which renders <div class="ms-cv"> — no <section> tag at all.
    // Prefer explicit slide markers; fall back to any <section> elements for microsites
    // where the LLM generated valid structure but skipped the data-section-id attribute.
    let sections = Array.from(contentEl.querySelectorAll<HTMLElement>('[data-section-id]'));
    if (sections.length === 0) sections = Array.from(contentEl.querySelectorAll<HTMLElement>('section'));
    if (sections.length === 0) {
      return { success: false, error: 'No sections found in the microsite HTML.' };
    }

    // getComputedStyle returns rgba(0,0,0,0) when root uses a CSS gradient background.
    // In that case fall back to the hard-coded dark theme colour.
    const _rawBg = captureWin.getComputedStyle(rootEl).backgroundColor;
    const rootBg = (!_rawBg || _rawBg === 'rgba(0, 0, 0, 0)' || _rawBg === 'transparent')
      ? '#0d1117'
      : _rawBg;

    // ── Off-screen host — very tall so nothing clips during measurement ───────
    // Appended to captureDoc (the iframe's document) so iframe CSS applies to clones.
    const host = captureDoc.createElement('div');
    host.style.cssText = [
      `position:fixed`,
      `left:0`,
      `top:0`,
      `width:${CAPTURE_W}px`,
      `height:9999px`,
      `overflow:visible`,
      `pointer-events:none`,
      `z-index:99999`,
    ].join(';');
    copyCustomProps(rootEl, host, captureWin);
    captureDoc.body.appendChild(host);

    // Wait for all web fonts declared in the document to finish loading.
    // Without this, fonts that aren't yet decoded at capture time fall back to
    // the system sans-serif, giving wrong text rendering in the PDF.
    try { await (captureDoc as Document & { fonts?: FontFaceSet }).fonts?.ready; } catch { /* ignore */ }

    // Inject global capture-time overrides:
    //   1. Pause animations (pseudo-element glitch text is frozen mid-frame without this).
    //   2. Remove backdrop-filter globally — html2canvas has zero support for it; keeping it
    //      causes glass cards to render as broken opaque rectangles. CSS-class backdrop-filters
    //      can't be removed per-element via inline style, so a global rule is needed.
    //   3. Hooks ([data-pdf-nb]/[data-pdf-na]) hide detected glitch pseudo-elements.
    const glitchFixStyle = captureDoc.createElement('style');
    glitchFixStyle.id = 'pdf-capture-glitch-fix';
    glitchFixStyle.textContent = [
      '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }',
      '* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }',
      // Single AND doubled selectors for html2canvas compatibility.
      // content:"" clears attr(data-text) clones even when opacity/display are overridden by higher-specificity rules.
      '[data-pdf-nb]::before, [data-pdf-nb][data-pdf-nb]::before { content: "" !important; opacity: 0 !important; display: none !important; visibility: hidden !important; }',
      '[data-pdf-na]::after,  [data-pdf-na][data-pdf-na]::after  { content: "" !important; opacity: 0 !important; display: none !important; visibility: hidden !important; }',
    ].join('\n');
    captureDoc.head.appendChild(glitchFixStyle);

    // PDF slide mode: the server injects height:calc(100vw * 9/16)!important on
    // [data-section-id] elements. At capture time 100vw = the iframe's panel viewport
    // width (~800px), not the 1280px capture width — so every slide is ~450px tall
    // instead of 720px. Override with a fixed pixel height so slides fill the canvas.
    if (slideModeHeight && slideModeHeight > 0) {
      const slideSizeStyle = captureDoc.createElement('style');
      slideSizeStyle.id = 'pdf-capture-slide-size';
      // justify-content/align-content: center keeps content vertically centred when
      // the LLM-generated section used flex/grid with content in the lower portion.
      slideSizeStyle.textContent = `[data-section-id]{height:${slideModeHeight}px!important;max-height:${slideModeHeight}px!important;min-height:${slideModeHeight}px!important;justify-content:center!important;align-content:center!important;}`;
      captureDoc.head.appendChild(slideSizeStyle);
    }

    const pdf = new JsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: [PDF_W_PT, PDF_H_PT],
      compress: true,
    });
    pdf.setProperties({ title, creator: 'Prodeck' });

    // Temporarily widen the host iframe to CAPTURE_W so that vw-based CSS (font-sizes,
    // padding, max-widths, etc.) resolves at 1280 px during all DOM measurements.
    // Without this the panel's ~800 px display width produces smaller computed font
    // sizes in the captureWin — the word-span fix then incorrectly classifies headings
    // as single-line and skips them. In html2canvas's internal 1280 px clone those same
    // headings wrap, producing multi-line text nodes whose lines all land at y=0
    // (the heading container top), causing the visible overlap.
    const captureIframe = captureWin.frameElement as HTMLElement | null;
    const savedIframeWidth = captureIframe?.style.width ?? '';

    try {
      if (captureIframe && captureWin.innerWidth < CAPTURE_W) {
        captureIframe.style.width = `${CAPTURE_W}px`;
        await nextFrame();
      }
      // After the iframe-widening attempt: if viewport is STILL narrower than CAPTURE_W
      // (no parent iframe, or iframe unavailable), vw-based font-sizes during DOM
      // measurement will be too small. Heading heights will read as single-line, the
      // word-span fix skips them, and html2canvas (which renders at windowWidth=1280)
      // wraps them — putting every line at y=0 = the visible text-overlap bug.
      // Solution: scale heading font-sizes by (1280 / current viewport width) before
      // measuring, so the word-span fix sees the same wrap behaviour as html2canvas.
      const viewportScaleFactor = captureWin.innerWidth < CAPTURE_W
        ? CAPTURE_W / captureWin.innerWidth
        : 1;
      for (let i = 0; i < sections.length; i++) {
        progress(
          Math.round(5 + (i / sections.length) * 90),
          `Preparing section ${i + 1} of ${sections.length}…`,
        );

        // ── Step 1: Clone with auto height to measure natural size ────────────
        // Check section background BEFORE cloning while bgEl is still in the live DOM.
        // We need BOTH inline style checks (for typed React sections that set backgrounds
        // via style=) AND computed style checks (for HTML microsites that use CSS classes).
        const bgEl = sections[i].querySelector<HTMLElement>('section') ?? sections[i];
        const origBg = bgEl.style.background + ' ' + bgEl.style.backgroundImage;
        const sectionHasImageBg = origBg.includes('url(');

        // Computed check: catches CSS-class gradients and solid colors that don't appear
        // in inline styles. bgEl is still in the live DOM here, so getComputedStyle is real.
        const bgComp = captureWin.getComputedStyle(bgEl);
        const sectionHasRealBg =
          sectionHasImageBg ||
          (bgComp.backgroundImage !== 'none') ||
          (bgComp.backgroundColor !== 'rgba(0, 0, 0, 0)' && bgComp.backgroundColor !== 'transparent');

        // In PDF slide mode the caller passes slideModeHeight; each section is captured
        // at that fixed height so decorative overflows don't bleed into adjacent pages.
        // For regular web microsites slideModeHeight is undefined → original behaviour.
        const clipH = slideModeHeight ?? 0;
        const isSlideMode = clipH > 0;

        const clone = sections[i].cloneNode(true) as HTMLElement;
        clone.style.cssText = [
          `width:${CAPTURE_W}px`,
          isSlideMode ? `height:${clipH}px` : `height:auto`,
          `min-height:0`,
          isSlideMode ? `max-height:${clipH}px` : `max-height:none`,
          isSlideMode ? `overflow:hidden` : `overflow:visible`,
          `box-sizing:border-box`,
          `position:relative`,
          `inset:auto`,
          `margin:0`,
          `opacity:1`,
          `transform:none`,
          `transition:none`,
          `animation:none`,
          // Only inject rootBg when the section has NO real background at all.
          // CSS-class gradients/colors are detected via sectionHasRealBg (computed style).
          ...(!sectionHasRealBg ? [`background:${rootBg}`] : []),
        ].join(';');

        // ── Force computed background from original onto the clone ──────────────
        // We read bgComp from the live DOM BEFORE cloning, so it reflects the true
        // background (whether set via inline style, CSS class, or CSS variable).
        // After cloning and cssText reset, the clone is placed in an off-screen host
        // where ancestor-dependent CSS selectors (e.g. "body > section") no longer
        // match. Setting the computed value as an explicit inline style guarantees
        // the correct background is rendered regardless of DOM context.
        if (bgEl === sections[i]) {
          const cBgImg = bgComp.backgroundImage;
          const cBgColor = bgComp.backgroundColor;
          if (cBgImg && cBgImg !== 'none') {
            clone.style.backgroundImage = cBgImg;
            const bsz = bgComp.backgroundSize;
            const bpos = bgComp.backgroundPosition;
            const brep = bgComp.backgroundRepeat;
            if (bsz && bsz !== 'auto') clone.style.backgroundSize = bsz;
            if (bpos && bpos !== '0% 0%') clone.style.backgroundPosition = bpos;
            if (brep && brep !== 'repeat') clone.style.backgroundRepeat = brep;
          }
          if (cBgColor && cBgColor !== 'rgba(0, 0, 0, 0)' && cBgColor !== 'transparent') {
            clone.style.backgroundColor = cBgColor;
          }
        }

        // Also restore any inline background shorthand that cssText reset cleared.
        // (Computed copy above uses expanded properties; this preserves the original
        // shorthand for inline-styled sections so the intent is exactly preserved.)
        if (bgEl === sections[i]) {
          if (bgEl.style.background) clone.style.background = bgEl.style.background;
          if (bgEl.style.backgroundImage) clone.style.backgroundImage = bgEl.style.backgroundImage;
          if (bgEl.style.backgroundColor) clone.style.backgroundColor = bgEl.style.backgroundColor;
          if (bgEl.style.backgroundSize) clone.style.backgroundSize = bgEl.style.backgroundSize;
          else if (sectionHasImageBg) clone.style.backgroundSize = 'cover';
          if (bgEl.style.backgroundPosition) clone.style.backgroundPosition = bgEl.style.backgroundPosition;
          else if (sectionHasImageBg) clone.style.backgroundPosition = 'center center';
          if (bgEl.style.backgroundRepeat) clone.style.backgroundRepeat = bgEl.style.backgroundRepeat;
        }

        // ── Strip decorative elements using INLINE style checks ──────────────
        // IMPORTANT: clone is not in the DOM yet so getComputedStyle returns defaults.
        // React sets all component styles inline, so el.style.xxx is reliable here.
        clone.querySelectorAll<HTMLElement>('*').forEach(el => {
          const inlinePos = el.style.position;
          const isGradientText =
            (el.style.webkitBackgroundClip === 'text' || el.style.backgroundClip === 'text') &&
            (el.style.color === 'transparent' || (el.style as unknown as Record<string,string>).webkitTextFillColor === 'transparent');

          // ── Gradient TEXT (heading colour effect) — convert to solid colour ──
          // html2canvas doesn't support background-clip:text. Without fixing this,
          // stripping backgroundImage leaves color:transparent → invisible heading.
          if (isGradientText) {
            const grad = el.style.backgroundImage || el.style.background;
            const firstHex  = grad.match(/#[0-9a-fA-F]{3,8}/)?.[0];
            const firstRgb  = grad.match(/rgba?\([^)]+\)/)?.[0];
            const solidColor = firstHex ?? firstRgb ?? '#e6edf3';
            el.style.color = solidColor;
            el.style.backgroundImage = 'none';
            el.style.background = 'transparent';
            el.style.backgroundClip = '';
            el.style.webkitBackgroundClip = '';
            (el.style as unknown as Record<string,string>).webkitTextFillColor = '';
            return;
          }

          // Hide absolute/fixed overlays that have NO text AND no inline background AND
          // no image descendants. Elements with <img> children are photo panels or content
          // assets, not decorative scrims — hiding them removes real slide imagery.
          const isScrim = (inlinePos === 'absolute' || inlinePos === 'fixed') &&
            !el.textContent?.trim() &&
            !el.querySelector('img') &&
            !el.style.background && !el.style.backgroundImage && !el.style.backgroundColor;
          if (isScrim && !sectionHasImageBg) {
            el.style.display = 'none';
            return;
          }

          // Neutralise backdrop-filter — html2canvas doesn't support it and it
          // causes the glass card to render as an opaque coloured rectangle.
          el.style.backdropFilter = 'none';
          (el.style as unknown as Record<string, string>).webkitBackdropFilter = 'none';
        });

        clone.querySelectorAll<HTMLElement>('[data-reveal]').forEach(el => {
          el.style.opacity = '1';
          el.style.transform = 'none';
          el.style.transition = 'none';
          el.style.animation = 'none';
        });

        // Replace <canvas> elements with static <img> snapshots — html2canvas skips canvas
        // elements, leaving white boxes for charts/diagrams. Capturing toDataURL first
        // preserves the rendered content.
        clone.querySelectorAll<HTMLCanvasElement>('canvas').forEach(c => {
          try {
            const img = captureDoc.createElement('img') as HTMLImageElement;
            img.src = c.toDataURL('image/png');
            img.style.cssText = c.style.cssText;
            img.style.display = 'block';
            img.width = c.width;
            img.height = c.height;
            c.parentNode?.replaceChild(img, c);
          } catch { /* tainted canvas (cross-origin data) — leave as-is */ }
        });

        // Replace all <img> src with data URLs fetched via proxy — eliminates CORS errors
        await inlineCloneImages(clone);

        // Reduce excessive section padding (microsite uses clamp(4rem,8vw,7rem) ≈ 100px
        // per side = 200px wasted). Only in web (non-slide) mode — slide mode preserves
        // the original padding so the design layout is not altered.
        if (!isSlideMode) {
          clone.style.paddingTop = '40px';
          clone.style.paddingBottom = '40px';
        }

        // html2canvas 1.4.x does not advance the y-cursor after <br> — every line after
        // the first renders at y=0 and visually overlaps the preceding text. Replace each
        // direct-child <br> with a block-level <div> so html2canvas sees proper block
        // boundaries and positions each line at the correct y-offset.
        clone.querySelectorAll<HTMLElement>('*').forEach(el => {
          const children = Array.from(el.childNodes);
          if (!children.some(n => n.nodeName === 'BR')) return;
          const lines: Node[][] = [[]];
          children.forEach(n => {
            if (n.nodeName === 'BR') lines.push([]);
            else lines[lines.length - 1].push(n);
          });
          if (lines.length < 2) return;
          el.innerHTML = '';
          lines.forEach(lineNodes => {
            const div = captureDoc.createElement('div');
            div.style.cssText = 'display:block;margin:0;padding:0';
            lineNodes.forEach(n => {
              // Wrap bare text nodes in spans so html2canvas uses each span's
              // getBoundingClientRect for y-placement (text nodes have no position).
              if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim()) {
                const sp = captureDoc.createElement('span');
                sp.style.display = 'inline';
                sp.textContent = n.textContent;
                div.appendChild(sp);
              } else {
                div.appendChild(n);
              }
            });
            el.appendChild(div);
          });
        });


        const measureWrapper = captureDoc.createElement('div');
        measureWrapper.style.cssText = [
          `width:${CAPTURE_W}px`,
          `height:auto`,
          `overflow:visible`,
          `background:${rootBg}`,
          `position:relative`,
        ].join(';');
        measureWrapper.appendChild(clone);
        host.innerHTML = '';
        host.appendChild(measureWrapper);

        await nextFrame();

        // ── Detect glitch pseudo-elements ──────────────────────────────────────────
        // LLM-generated microsites create duplicate text overlays via ::before/::after
        // pseudo-elements that are position:absolute with content (e.g. attr(data-text)).
        // html2canvas freezes these at their current paint state — without hiding them
        // every headline gets doubled/tripled glitch copies in the PDF.
        // Trigger: (position absolute/fixed AND non-empty content/animation)
        //       OR content uses attr() — the canonical glitch-text pattern regardless of position.
        clone.querySelectorAll<HTMLElement>('*').forEach(el => {
          try {
            const bCs = captureWin.getComputedStyle(el, '::before');
            const bContent = bCs.content;
            const bHasContent = bContent && bContent !== 'none' && bContent !== '""' && bContent !== "''";
            const bUsesAttr = typeof bContent === 'string' && bContent.includes('attr(');
            const bAbsolute = bCs.position === 'absolute' || bCs.position === 'fixed';
            const bHasAnim = bCs.animationName && bCs.animationName !== 'none';
            if (bUsesAttr || (bAbsolute && (bHasContent || bHasAnim))) el.setAttribute('data-pdf-nb', '');

            const aCs = captureWin.getComputedStyle(el, '::after');
            const aContent = aCs.content;
            const aHasContent = aContent && aContent !== 'none' && aContent !== '""' && aContent !== "''";
            const aUsesAttr = typeof aContent === 'string' && aContent.includes('attr(');
            const aAbsolute = aCs.position === 'absolute' || aCs.position === 'fixed';
            const aHasAnim = aCs.animationName && aCs.animationName !== 'none';
            if (aUsesAttr || (aAbsolute && (aHasContent || aHasAnim))) el.setAttribute('data-pdf-na', '');
          } catch { /* ignore – getComputedStyle can fail on some nodes */ }
        });

        // ── Margin/padding/minHeight tightening ──────────────────────────────────────
        clone.querySelectorAll<HTMLElement>('*').forEach(el => {
          const cs = captureWin.getComputedStyle(el);
          const mt = parseFloat(cs.marginTop);
          if (mt > 40) el.style.marginTop = '24px';
          const mb = parseFloat(cs.marginBottom);
          if (mb > 40) el.style.marginBottom = '16px';
          if (!isSlideMode) {
            const pt = parseFloat(cs.paddingTop);
            if (pt > 60) el.style.paddingTop = '32px';
            const mh = parseFloat(cs.minHeight);
            if (mh > 100) el.style.minHeight = '0';
          } else {
            // Slide mode: only strip extreme top padding (> 200px) — these come from
            // scroll-reveal designs that push content below the visible viewport fold,
            // leaving a large empty black area at the top of the captured slide.
            const pt = parseFloat(cs.paddingTop);
            if (pt > 200) el.style.paddingTop = '48px';
          }
        });

        // ── Fix CSS-class gradient text (bg-clip-text / text-transparent) ─────────
        // The inline-style pass above catches React inline styles. This computed pass
        // catches Tailwind/CSS-class-based gradient text where computed color resolves
        // to transparent — without this fix those headings are invisible in the PDF.
        clone.querySelectorAll<HTMLElement>('*').forEach(el => {
          const computed = captureWin.getComputedStyle(el);
          const c = computed.color;
          if (c === 'rgba(0, 0, 0, 0)' || c === 'transparent') {
            // Try to pick the first real color from the gradient rather than a fixed fallback
            const bgImg = computed.backgroundImage;
            const solidColor =
              (bgImg && bgImg !== 'none')
                ? (bgImg.match(/#[0-9a-fA-F]{3,8}/)?.[0] ?? bgImg.match(/rgba?\([^)]+\)/)?.[0] ?? '#e6edf3')
                : '#e6edf3';
            el.style.color = solidColor;
            el.style.backgroundClip = '';
            el.style.webkitBackgroundClip = '';
            (el.style as unknown as Record<string, string>).webkitTextFillColor = '';
          }
        });

        // ── Simulate 1280px viewport for heading measurement when viewport is narrow ──
        // When the captureWin viewport is narrower than CAPTURE_W (e.g. standalone view
        // with no parent iframe to widen), vw-based font-sizes resolve too small. This
        // makes headings appear single-line during measurement → the word-span fix below
        // skips them → html2canvas renders at windowWidth=1280 where they wrap → all
        // wrapped lines land at y=0 = the visible text-overlap bug.
        // Fix: temporarily inline-scale heading font-sizes to (computed × CAPTURE_W/viewport),
        // let the word-span fix detect and split them correctly, then restore before capture
        // so html2canvas uses its own internal vw resolution.
        interface FontRestore { el: HTMLElement; savedFs: string }
        const fontRestores: FontRestore[] = [];
        if (viewportScaleFactor > 1) {
          clone.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach(h => {
            const fsPx = parseFloat(captureWin.getComputedStyle(h).fontSize);
            if (!isNaN(fsPx) && fsPx > 0) {
              fontRestores.push({ el: h, savedFs: h.style.fontSize });
              h.style.fontSize = `${fsPx * viewportScaleFactor}px`;
            }
          });
          if (fontRestores.length > 0) await nextFrame();
        }

        // ── Absolute-position heading line divs for html2canvas ──────────────────
        // The <br>-split fix (above, before DOM placement) creates display:block divs
        // inside headings. Html2canvas may compute those divs' height as 0 when they
        // contain inline spans (its block-layout engine doesn't measure inline content
        // height correctly), causing ALL lines to land at y=0 and overlap.
        // Fix: convert each block div to position:absolute with an explicit top value
        // measured from the live DOM, bypassing html2canvas's block-stacking entirely.
        clone.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach(heading => {
          const blockDivs = Array.from(heading.children).filter(
            c => (c as HTMLElement).style.display === 'block'
          ) as HTMLElement[];
          if (blockDivs.length < 2) return;

          const headingRect = heading.getBoundingClientRect();
          if (!headingRect.height) return;

          // Replace each block div's inline-span content with a direct text node.
          // html2canvas computes block div height as 0 when children are inline spans;
          // a text node forces it to derive height from font metrics instead, so the
          // next sibling div is placed below (not at the same y).
          blockDivs.forEach(div => {
            const lineText = (div.textContent ?? '').trimEnd();
            div.innerHTML = '';
            div.textContent = lineText;
            div.style.overflow = 'visible';
            div.style.whiteSpace = 'nowrap';
          });
        });

        // ── Fix multi-line headings: html2canvas uses the parent element's top y-offset
        // for every text node it encounters, so text from line 2 renders at y=0 (same as
        // line 1) causing all wrapped lines to visually overlap. Slide 1 works only because
        // its second visual line is in a <span> element with its own getBoundingClientRect.
        // Fix: after DOM placement, detect headings that wrap, split their text into
        // per-word spans, group words by y-position, then rebuild as per-line block <div>s
        // so html2canvas sees one element per line with the correct y-coordinate.
        clone.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach(heading => {
          // Skip headings already split into block lines by the <br> fix above
          if (Array.from(heading.children).some(c =>
            captureWin.getComputedStyle(c).display === 'block')) return;

          const hcs = captureWin.getComputedStyle(heading);
          let lineH = parseFloat(hcs.lineHeight);
          if (!lineH || isNaN(lineH)) lineH = parseFloat(hcs.fontSize) * 1.2;
          if (!lineH || isNaN(lineH)) return;

          const headingH = heading.getBoundingClientRect().height;
          if (headingH <= lineH * 1.3) return; // single-line heading, nothing to fix

          // Save original child nodes before we begin measuring
          const origNodes = Array.from(heading.childNodes);
          heading.innerHTML = '';

          // Convert text nodes to per-word spans for y-position measurement;
          // keep element children (e.g. <span class="hi">) intact as single units.
          type WordItem = { span: HTMLElement; isText: boolean; text: string };
          const items: WordItem[] = [];

          origNodes.forEach(n => {
            if (n.nodeType === Node.TEXT_NODE) {
              (n.textContent ?? '').split(/\s+/).filter(Boolean).forEach(word => {
                const sp = captureDoc.createElement('span');
                sp.style.display = 'inline';
                sp.textContent = word + ' ';
                heading.appendChild(sp);
                items.push({ span: sp, isText: true, text: word + ' ' });
              });
            } else if (n.nodeType === Node.ELEMENT_NODE) {
              const el = n as HTMLElement;
              heading.appendChild(el);
              items.push({ span: el, isText: false, text: '' });
            }
          });

          if (!items.length) {
            heading.innerHTML = '';
            origNodes.forEach(n => heading.appendChild(n));
            return;
          }

          // Group word spans by visual line (same getBoundingClientRect().top = same line)
          const lines: WordItem[][] = [[]];
          let lastTop = items[0].span.getBoundingClientRect().top;
          items.forEach(item => {
            const t = item.span.getBoundingClientRect().top;
            if (Math.abs(t - lastTop) > lineH * 0.4) { lines.push([]); lastTop = t; }
            lines[lines.length - 1].push(item);
          });

          if (lines.length < 2) {
            // Turned out single-line — restore and skip
            heading.innerHTML = '';
            origNodes.forEach(n => heading.appendChild(n));
            return;
          }

          // Measure each line's y-offset BEFORE clearing the DOM.
          // Use absolute positioning — html2canvas may compute display:block div heights as 0
          // for inline content, collapsing all lines to y=0. Explicit position:absolute+top
          // bypasses html2canvas's block-layout engine entirely.
          //
          // Use the first visible line's top as the reference (not the heading's own rect.top)
          // so that line[0] is always at offset 0 and no line gets a negative top value,
          // which could be clipped by html2canvas's element bounds.
          const firstLineTop = lines[0]?.[0]?.span.getBoundingClientRect().top
            ?? heading.getBoundingClientRect().top;
          const lastLineItems = lines[lines.length - 1];
          const lastLineBottom = lastLineItems.length
            ? Math.max(...lastLineItems.map(i => i.span.getBoundingClientRect().bottom))
            : firstLineTop + lineH;
          const headingAbsH = lastLineBottom - firstLineTop;
          const lineTopOffsets = lines.map(lineItems =>
            lineItems.length ? lineItems[0].span.getBoundingClientRect().top - firstLineTop : 0
          );
          const lineHeights = lines.map(lineItems => {
            if (!lineItems.length) return lineH;
            const bots = lineItems.map(item => item.span.getBoundingClientRect().bottom);
            const tops = lineItems.map(item => item.span.getBoundingClientRect().top);
            return Math.max(...bots) - Math.min(...tops);
          });

          heading.innerHTML = '';
          // Block-flow divs with DIRECT TEXT NODES.
          // html2canvas ignores explicit CSS `height` when computing where to place
          // the next sibling block — it uses its own content-height, which it computes
          // as 0 for divs whose only children are inline <span> elements.
          // A text node (no sub-element) forces html2canvas to compute height from the
          // inherited font metrics (font-size × line-height), which gives the correct
          // non-zero value, so div[1] is placed below div[0] rather than on top of it.
          lines.forEach((lineItems) => {
            const div = captureDoc.createElement('div');
            div.style.cssText = [
              `display:block`,
              `overflow:visible`,
              `margin:0`,
              `padding:0`,
              `white-space:nowrap`,
            ].join(';');
            // Reconstruct line text; each item.span.textContent is "word " (with trailing space)
            div.textContent = lineItems.map(item => (item.span.textContent ?? '')).join('').trimEnd();
            heading.appendChild(div);
          });
        });

        // Restore original heading font-sizes — html2canvas resolves vw units internally
        // via windowWidth:CAPTURE_W, so inline px overrides must be removed before capture.
        fontRestores.forEach(({ el, savedFs }) => el.style.fontSize = savedFs);

        // Measure from the clone itself (not wrapper) so SVG/diagram children are included.
        // scrollHeight misses SVG height; getBoundingClientRect is reliable for rendered height.
        const cloneRect = clone.getBoundingClientRect();
        // In PDF slide mode, trust clipH directly — scrollHeight would include overflowing
        // SVGs and cause multi-page slicing of a single slide. Regular microsite captures
        // always use the natural measured height (slideModeHeight not set → isSlideMode false).
        const naturalH = isSlideMode
          ? clipH
          : Math.max(
              cloneRect.height,
              clone.scrollHeight,
              measureWrapper.scrollHeight,
              100,
            );

        // When the section has a real image background and is shorter than the slide,
        // stretch it to fill the full slide height so the photo covers the entire
        // canvas with no rootBg gap below.
        if (sectionHasImageBg && naturalH < CAPTURE_H) {
          clone.style.minHeight = `${CAPTURE_H}px`;
          clone.style.backgroundSize = 'cover';
          clone.style.backgroundPosition = 'center center';
        }

        // Three cases by natural height:
        //   A. naturalH ≤ CAPTURE_H           → short: one page, vertically padded
        //   B. CAPTURE_H < naturalH ≤ MAX_FIT  → medium: capture full height, scale to fit one page
        //   C. naturalH > MAX_FIT              → tall: capture full height, slice into multiple pages
        // MAX_FIT = CAPTURE_H / FIT_THRESHOLD ≈ 1241px
        const MAX_FIT = CAPTURE_H / FIT_THRESHOLD;

        if (naturalH <= CAPTURE_H) {
          // ── Case A: short section — one page with breathing room ─────────────
          // In slide mode or when section has its own real background, don't add extra top-padding —
          // the section already handles its own vertical rhythm.
          const topPad = (sectionHasImageBg || sectionHasRealBg || isSlideMode) ? 0 : Math.round((CAPTURE_H - naturalH) * 0.25);
          const wrapper = captureDoc.createElement('div');
          wrapper.style.cssText = [
            `width:${CAPTURE_W}px`,
            `height:${CAPTURE_H}px`,
            `display:flex`,
            `flex-direction:column`,
            `justify-content:flex-start`,
            `padding-top:${topPad}px`,
            `overflow:hidden`,
            `background:${rootBg}`,
            `position:relative`,
            `box-sizing:border-box`,
          ].join(';');
          wrapper.appendChild(clone);
          host.innerHTML = '';
          host.appendChild(wrapper);
          await nextFrame();

          const pageCanvas = await h2canvas(wrapper, {
            scale: 1.5,
            width: CAPTURE_W,
            height: CAPTURE_H,
            windowWidth: CAPTURE_W,
            windowHeight: CAPTURE_H,
            scrollX: 0,
            scrollY: 0,
            useCORS: true,
            logging: false,
            backgroundColor: rootBg,
          });
          const imgData = pageCanvas.toDataURL('image/jpeg', quality);
          if (i > 0) pdf.addPage([PDF_W_PT, PDF_H_PT], 'landscape');
          pdf.addImage(imgData, 'JPEG', 0, 0, PDF_W_PT, PDF_H_PT, '', 'FAST');

        } else if (naturalH <= MAX_FIT) {
          // ── Case B: medium section — capture full height, scale down to one page ─
          // Content fits when scaled, text remains readable (ratio ≥ FIT_THRESHOLD).
          const captureH = Math.ceil(naturalH);
          const wrapper = captureDoc.createElement('div');
          wrapper.style.cssText = [
            `width:${CAPTURE_W}px`,
            `height:${captureH}px`,
            `overflow:visible`,
            `background:${rootBg}`,
            `position:relative`,
          ].join(';');
          wrapper.appendChild(clone);
          host.innerHTML = '';
          host.appendChild(wrapper);
          await nextFrame();

          const fullCanvas = await h2canvas(wrapper, {
            scale: 1.5,
            width: CAPTURE_W,
            height: captureH,
            windowWidth: CAPTURE_W,
            windowHeight: captureH,
            scrollX: 0,
            scrollY: 0,
            useCORS: true,
            logging: false,
            backgroundColor: rootBg,
          });
          const scaled = scaleToSlide(fullCanvas, rootBg);
          const imgData = scaled.toDataURL('image/jpeg', quality);
          if (i > 0) pdf.addPage([PDF_W_PT, PDF_H_PT], 'landscape');
          pdf.addImage(imgData, 'JPEG', 0, 0, PDF_W_PT, PDF_H_PT, '', 'FAST');

        } else {
          // ── Case C: tall section — capture full height, slice into clean pages ──
          // Each page is a 1:1 crop at full resolution — no scaling, no clipping.
          // A 4px pixel overlap between pages prevents cuts at element boundaries.
          const captureH = Math.ceil(naturalH);
          const wrapper = captureDoc.createElement('div');
          wrapper.style.cssText = [
            `width:${CAPTURE_W}px`,
            `height:${captureH}px`,
            `overflow:visible`,
            `background:${rootBg}`,
            `position:relative`,
          ].join(';');
          wrapper.appendChild(clone);
          host.innerHTML = '';
          host.appendChild(wrapper);
          await nextFrame();

          const fullCanvas = await h2canvas(wrapper, {
            scale: 1.5,
            width: CAPTURE_W,
            height: captureH,
            windowWidth: CAPTURE_W,
            windowHeight: captureH,
            scrollX: 0,
            scrollY: 0,
            useCORS: true,
            logging: false,
            backgroundColor: rootBg,
          });

          const pages = sliceIntoPages(fullCanvas, rootBg);
          for (let p = 0; p < pages.length; p++) {
            const imgData = pages[p].toDataURL('image/jpeg', quality);
            if (i > 0 || p > 0) pdf.addPage([PDF_W_PT, PDF_H_PT], 'landscape');
            pdf.addImage(imgData, 'JPEG', 0, 0, PDF_W_PT, PDF_H_PT, '', 'FAST');
          }
        }
      }
    } finally {
      captureDoc.body.removeChild(host);
      captureDoc.getElementById('pdf-capture-glitch-fix')?.remove();
      captureDoc.getElementById('pdf-capture-slide-size')?.remove();
      if (captureIframe) captureIframe.style.width = savedIframeWidth;
    }

    progress(98, 'Saving PDF…');
    const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    pdf.save(`${safeTitle}.pdf`);

    progress(100, 'Done');
    return { success: true };

  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
