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
}

export interface CapturePDFResult {
  success: boolean;
  error?: string;
}

/** Copy all CSS custom properties (--foo: bar) from `from` to `to`. */
function copyCustomProps(from: HTMLElement, to: HTMLElement) {
  const computed = window.getComputedStyle(from);
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
  const { title = 'Microsite', quality = 0.90, onProgress } = options;
  const progress = (pct: number, message: string) => onProgress?.({ pct, message });

  try {
    progress(2, 'Finding sections…');

    // [data-section-id] is set by AnimatedSection for every section regardless of type.
    // Typed React sections render inner <section> elements; design-skill microsites use
    // customHtml which renders <div class="ms-cv"> — no <section> tag at all.
    const sections = Array.from(contentEl.querySelectorAll<HTMLElement>('[data-section-id]'));
    if (sections.length === 0) {
      return { success: false, error: 'No sections found in the microsite.' };
    }

    // getComputedStyle returns rgba(0,0,0,0) when root uses a CSS gradient background.
    // In that case fall back to the hard-coded dark theme colour.
    const _rawBg = window.getComputedStyle(rootEl).backgroundColor;
    const rootBg = (!_rawBg || _rawBg === 'rgba(0, 0, 0, 0)' || _rawBg === 'transparent')
      ? '#0d1117'
      : _rawBg;

    // ── Off-screen host — very tall so nothing clips during measurement ───────
    const host = document.createElement('div');
    host.style.cssText = [
      `position:fixed`,
      `left:-${CAPTURE_W + 200}px`,
      `top:0`,
      `width:${CAPTURE_W}px`,
      `height:9999px`,
      `overflow:visible`,
      `pointer-events:none`,
      `z-index:-1`,
    ].join(';');
    copyCustomProps(rootEl, host);
    document.body.appendChild(host);

    const pdf = new JsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: [PDF_W_PT, PDF_H_PT],
      compress: true,
    });
    pdf.setProperties({ title, creator: 'Prodeck' });

    try {
      for (let i = 0; i < sections.length; i++) {
        progress(
          Math.round(5 + (i / sections.length) * 90),
          `Preparing section ${i + 1} of ${sections.length}…`,
        );

        // ── Step 1: Clone with auto height to measure natural size ────────────
        // Check if the section has a real image background (url(...)) BEFORE cloning
        // so we can preserve it. Pure CSS gradients (no url) are stripped — they
        // caused a coloured rectangle above the heading in earlier captures.
        //
        // [data-section-id] wrappers hold the background on their inner <section>
        // child (typed React components). customHtml sections manage backgrounds
        // via scoped CSS — no inline style to detect, so sectionHasImageBg stays false
        // and the rendered content handles its own background.
        const bgEl = sections[i].querySelector<HTMLElement>('section') ?? sections[i];
        const origBg = bgEl.style.background + ' ' + bgEl.style.backgroundImage;
        const sectionHasImageBg = origBg.includes('url(');
        const sectionHasCssGradient = !sectionHasImageBg && origBg.includes('gradient');

        const clone = sections[i].cloneNode(true) as HTMLElement;
        clone.style.cssText = [
          `width:${CAPTURE_W}px`,
          `height:auto`,
          `min-height:0`,
          `max-height:none`,
          `overflow:visible`,
          `box-sizing:border-box`,
          `position:relative`,
          `inset:auto`,
          `margin:0`,
          `opacity:1`,
          `transform:none`,
          `transition:none`,
          `animation:none`,
          // Only override to rootBg when section uses a CSS gradient (no real image).
          // If it has a real image URL we preserve it so the photo shows in the PDF.
          ...(!sectionHasImageBg ? [`background:${rootBg}`] : []),
        ].join(';');

        // Restore the image background on the clone when the section has one.
        // For [data-section-id] wrappers the background lives on the inner <section>;
        // cloneNode(true) already preserved those inline styles, so we only need to
        // re-apply when bgEl is the wrapper itself (cssText reset cleared it).
        if (sectionHasImageBg && bgEl === sections[i]) {
          if (bgEl.style.background) clone.style.background = bgEl.style.background;
          if (bgEl.style.backgroundImage) clone.style.backgroundImage = bgEl.style.backgroundImage;
          clone.style.backgroundSize = bgEl.style.backgroundSize || 'cover';
          clone.style.backgroundPosition = bgEl.style.backgroundPosition || 'center center';
          clone.style.backgroundRepeat = bgEl.style.backgroundRepeat || 'no-repeat';
        }

        // ── Strip decorative elements using INLINE style checks ──────────────
        // IMPORTANT: clone is not in the DOM yet so getComputedStyle returns defaults.
        // React sets all component styles inline, so el.style.xxx is reliable here.
        clone.querySelectorAll<HTMLElement>('*').forEach(el => {
          const inlinePos = el.style.position;
          const inlineBg  = el.style.background + ' ' + el.style.backgroundImage;
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

          // Hide absolute/fixed overlays with no text (scrim div, noise SVG, parallax bg).
          // Keep the scrim when the section has a real image — it provides text legibility.
          const isScrim = (inlinePos === 'absolute' || inlinePos === 'fixed') && !el.textContent?.trim();
          if (isScrim && !sectionHasImageBg) {
            el.style.display = 'none';
            return;
          }

          // Strip CSS gradient backgrounds from child elements (decorative gradient boxes).
          // Preserve url() backgrounds — those are real content images.
          if (inlineBg.includes('gradient') && !inlineBg.includes('url(')) {
            el.style.background = 'transparent';
            el.style.backgroundImage = 'none';
          }

          // Strip pure CSS gradient on the section itself if it had one (already handled
          // via cssText, but belt-and-suspenders for backgroundImage property).
          if (sectionHasCssGradient && el === clone) {
            el.style.background = rootBg;
            el.style.backgroundImage = 'none';
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
            const img = document.createElement('img');
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
        // per side = 200px wasted). Tighten to 40px top/bottom for slide capture.
        clone.style.paddingTop = '40px';
        clone.style.paddingBottom = '40px';


        const measureWrapper = document.createElement('div');
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

        // ── Margin-tightening AFTER DOM insertion so getComputedStyle is accurate ──
        clone.querySelectorAll<HTMLElement>('*').forEach(el => {
          const mt = parseFloat(getComputedStyle(el).marginTop);
          if (mt > 40) el.style.marginTop = '24px';
          const mb = parseFloat(getComputedStyle(el).marginBottom);
          if (mb > 40) el.style.marginBottom = '16px';
        });

        // ── Fix CSS-class gradient text (bg-clip-text / text-transparent) ─────────
        // The inline-style pass above catches React inline styles. This computed pass
        // catches Tailwind/CSS-class-based gradient text where computed color resolves
        // to transparent — without this fix those headings are invisible in the PDF.
        clone.querySelectorAll<HTMLElement>('*').forEach(el => {
          const computed = getComputedStyle(el);
          const c = computed.color;
          if (c === 'rgba(0, 0, 0, 0)' || c === 'transparent') {
            el.style.color = '#e6edf3';
            el.style.backgroundClip = '';
            el.style.webkitBackgroundClip = '';
            (el.style as unknown as Record<string, string>).webkitTextFillColor = '';
          }
        });

        // Measure from the clone itself (not wrapper) so SVG/diagram children are included.
        // scrollHeight misses SVG height; getBoundingClientRect is reliable for rendered height.
        const cloneRect = clone.getBoundingClientRect();
        const naturalH = Math.max(
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
          const topPad = sectionHasImageBg ? 0 : Math.round((CAPTURE_H - naturalH) * 0.25);
          const wrapper = document.createElement('div');
          wrapper.style.cssText = [
            `width:${CAPTURE_W}px`,
            `height:${CAPTURE_H}px`,
            `display:flex`,
            `flex-direction:column`,
            `justify-content:flex-start`,
            `padding-top:${topPad}px`,
            `overflow:hidden`,
            `background:${sectionHasImageBg ? 'transparent' : rootBg}`,
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
          const wrapper = document.createElement('div');
          wrapper.style.cssText = [
            `width:${CAPTURE_W}px`,
            `height:${captureH}px`,
            `overflow:visible`,
            `background:${sectionHasImageBg ? 'transparent' : rootBg}`,
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
          const wrapper = document.createElement('div');
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
      document.body.removeChild(host);
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
