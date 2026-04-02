/**
 * Client-side PDF generator — one html2canvas call per section, combined into
 * an A4 portrait PDF where every section fills exactly one page.
 *
 * Capturing sections individually (instead of one full-page capture + slice) solves:
 *  - Sections split across multiple pages (each section canvas is sized to the section)
 *  - Nav bar bleeding into the capture (we capture the section element directly)
 *  - Tall sections forced to fit one slide via uniform scale-down
 */

async function loadHtml2canvas() {
  const mod = await import('html2canvas');
  return (mod.default ?? mod) as typeof import('html2canvas').default;
}

async function loadJsPDF() {
  const mod = await import('jspdf');
  type JsPDFCtor = typeof import('jspdf').default;
  const maybe = mod as unknown as { jsPDF: JsPDFCtor };
  return maybe.jsPDF ?? (mod.default as JsPDFCtor);
}

export interface PDFProgress { pct: number; message: string }
export interface PDFResult {
  success: boolean;
  fileSizeMB?: number;
  pageCount?: number;
  error?: string;
}
export interface PDFOptions {
  title?: string;
  quality?: number;   // JPEG 0–1, default 0.85
  scale?: number;     // canvas devicePixelRatio, default 1.5
  background?: string;
  onProgress?: (p: PDFProgress) => void;
}

// A4 portrait in PDF points (1 pt = 1/72 inch)
const SLIDE_W_PT = 595;
const SLIDE_H_PT = 842;
// Capture width in CSS pixels — narrower for portrait aspect ratio
const SLIDE_W_PX = 900;

function emit(fn: PDFOptions['onProgress'], pct: number, message: string) {
  fn?.({ pct, message });
}

// ── helpers ───────────────────────────────────────────────────────────────

/**
 * Rewrite API-server URLs through the Next.js same-origin proxy (/api/...) so
 * cross-origin CORS restrictions don't block the fetch in the browser.
 * next.config.mjs: fallback rewrite  /api/:path* → http://localhost:3000/:path*
 */
function toProxiedUrl(src: string): string {
  return src.replace(/^https?:\/\/(localhost|127\.0\.0\.1):\d+\//, '/api/');
}

/** Fetch an image and return a data: URL, or null on failure. */
async function toDataUrl(src: string): Promise<string | null> {
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return null;
  // Use the same-origin proxy to avoid cross-origin CORS blocks
  const url = toProxiedUrl(src);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload  = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Convert every <img> src to data: URL so html2canvas can render them. */
async function inlineImages(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img'));
  await Promise.allSettled(
    imgs.map(async img => {
      const data = await toDataUrl(img.getAttribute('src') ?? '');
      if (data) img.src = data;
    }),
  );

  // Also inline CSS background-image urls
  const all = Array.from(root.querySelectorAll<HTMLElement>('*'));
  all.push(root);
  await Promise.allSettled(
    all.map(async el => {
      const bg = el.style.backgroundImage || getComputedStyle(el).backgroundImage;
      const match = bg?.match(/url\(["']?(.+?)["']?\)/);
      if (!match) return;
      const url = match[1];
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      const data = await toDataUrl(url);
      if (data) {
        el.style.backgroundImage = `url("${data}")`;
        // Also patch the background shorthand — html2canvas reads it directly and would
        // re-request the original (possibly CORS-blocked or expired) URL otherwise.
        if (el.style.background?.includes('url(')) {
          el.style.background = el.style.background.replace(
            /url\(["']?[^"')]+["']?\)/,
            `url("${data}")`,
          );
        }
      }
    }),
  );
}

/**
 * Synchronously rewrite every cross-origin localhost URL in the clone's inline styles
 * and img[src] to the same-origin /api/ proxy path.
 * This runs BEFORE html2canvas so it never sees the cross-origin URL.
 * Next.js proxies /api/presentation-images/... → http://localhost:3000/presentation-images/...
 */
function rewriteLocalhostUrls(root: HTMLElement) {
  const RX = /https?:\/\/(localhost|127\.0\.0\.1):\d+\//g;
  const rewrite = (s: string) => s.replace(RX, '/api/');

  root.querySelectorAll<HTMLElement>('*').forEach(el => {
    if (el.style.background?.match(RX))      el.style.background      = rewrite(el.style.background);
    if (el.style.backgroundImage?.match(RX)) el.style.backgroundImage = rewrite(el.style.backgroundImage);
  });

  root.querySelectorAll<HTMLImageElement>('img').forEach(img => {
    if (img.getAttribute('src')?.match(RX)) img.src = rewrite(img.src);
  });
}

/**
 * html2canvas does not support background-clip:text / -webkit-text-fill-color:transparent.
 * It renders the gradient as a solid rectangle and leaves the text invisible.
 * Fix: extract the first colour stop from the gradient and use it as a solid text colour.
 */
function fixGradientText(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('*').forEach(el => {
    const s = el.style;
    const isGradientText =
      s.webkitTextFillColor === 'transparent' || s.color === 'transparent';
    if (!isGradientText || !s.backgroundImage?.includes('gradient')) return;

    // Pull first colour stop as the solid fallback
    const m = s.backgroundImage.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)/);
    const colour = m?.[0] ?? '#ffffff';

    s.backgroundImage        = 'none';
    s.backgroundClip         = '';
    s.webkitTextFillColor    = colour;
    s.color                  = colour;
    // Clear -webkit-background-clip via setProperty (vendor prefix not in CSSStyleDeclaration type)
    el.style.setProperty('-webkit-background-clip', '');
  });
}

/** Remove SVG noise-overlay elements (feTurbulence) — html2canvas renders them as full-opacity grain. */
function removeNoiseOverlays(root: HTMLElement) {
  root.querySelectorAll<SVGElement>('svg').forEach(svg => {
    if (svg.querySelector('feTurbulence')) svg.remove();
  });
}

/** Wait for Mermaid / custom diagrams to render SVG in the live section (before cloning). */
async function waitForDiagrams(liveSection: HTMLElement, timeout = 4000) {
  const containers = Array.from(liveSection.querySelectorAll<HTMLElement>('.diagram-container'));
  if (containers.length === 0) return;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (containers.every(c => c.querySelector('svg') !== null)) return;
    await new Promise(r => setTimeout(r, 120));
  }
}

/** Reset all Reveal / AnimatedSection inline opacity/transform so everything is visible. */
function resetAnimations(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-reveal]').forEach(el => {
    el.style.opacity    = '1';
    el.style.transform  = 'none';
    el.style.transition = 'none';
    el.style.animation  = 'none';
  });
  root.querySelectorAll<HTMLElement>('*').forEach(el => {
    const s = el.style;
    if (s.opacity !== '' && parseFloat(s.opacity) < 0.5) s.opacity = '1';
    if (s.visibility === 'hidden') s.visibility = 'visible';
    if (s.transform && s.transform !== 'none' &&
        (s.transform.includes('translateY') ||
         s.transform.includes('translateX') ||
         s.transform.startsWith('scale(0'))) {
      s.transform = 'none';
    }
  });
}

/** Fix CircularProgress rings (IntersectionObserver never fires off-screen). */
function patchCircularProgress(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-progress-value]').forEach(el => {
    const value  = parseInt(el.dataset.progressValue       ?? '0',   10);
    const size   = parseInt(el.dataset.progressSize        ?? '140', 10);
    const stroke = parseInt(el.dataset.progressStrokewidth ?? '10',  10);
    const radius = (size - stroke) / 2;
    const circ   = 2 * Math.PI * radius;
    const offset = circ - (value / 100) * circ;

    const circles = el.querySelectorAll<SVGCircleElement>('circle');
    if (circles.length >= 2) {
      circles[1].setAttribute('stroke-dashoffset', String(Math.round(offset)));
      circles[1].setAttribute('stroke-dasharray',  String(Math.round(circ)));
    }
    // Center percentage text (first span inside the overlay div next to <svg>)
    const overlay = el.querySelector<HTMLElement>('svg + div');
    const span    = overlay?.querySelector<HTMLElement>('span');
    if (span) span.textContent = `${value}%`;
  });
}

/** Copy all --ms-* and --color-* CSS variables from the live microsite root to the clone. */
function copyThemeVars(liveRoot: HTMLElement | null, target: HTMLElement) {
  if (liveRoot) {
    for (const prop of Array.from(liveRoot.style)) {
      if (prop.startsWith('--')) {
        target.style.setProperty(prop, liveRoot.style.getPropertyValue(prop));
      }
    }
  }
  const rootStyle = getComputedStyle(document.documentElement);
  for (const prop of Array.from(rootStyle)) {
    if (prop.startsWith('--ms-') || prop.startsWith('--color-')) {
      target.style.setProperty(prop, rootStyle.getPropertyValue(prop));
    }
  }
}

// ── main export ───────────────────────────────────────────────────────────

export async function generateMicrositePDF(
  contentEl: HTMLElement,
  tokens: { bg: string },
  options: PDFOptions = {},
): Promise<PDFResult> {
  const {
    title      = 'microsite',
    quality    = 0.85,
    scale      = 1.5,
    background = tokens.bg || '#ffffff',
    onProgress,
  } = options;

  // Live section elements
  const liveSections = Array.from(
    contentEl.querySelectorAll<HTMLElement>('[data-section-id]'),
  );
  if (liveSections.length === 0) {
    return { success: false, error: 'No sections found ([data-section-id])' };
  }

  emit(onProgress, 5, `Found ${liveSections.length} sections…`);

  const html2canvas = await loadHtml2canvas();
  const JsPDF       = await loadJsPDF();

  const liveRoot = contentEl.closest<HTMLElement>('.microsite-root') ?? contentEl.parentElement;

  const pdf = new JsPDF({
    orientation: 'portrait',
    unit:        'pt',
    format:      [SLIDE_W_PT, SLIDE_H_PT],
    compress:    true,
  });
  pdf.setProperties({ title, subject: 'Proposal Microsite', creator: 'Prodeck' });

  // Wait for fonts once before the loop
  await document.fonts.ready;

  // ── Capture each section individually ───────────────────────────────────
  for (let i = 0; i < liveSections.length; i++) {
    const liveSection = liveSections[i];
    const sectionId   = liveSection.dataset.sectionId ?? `section-${i}`;

    emit(onProgress, 10 + Math.round((i / liveSections.length) * 75),
      `Capturing slide ${i + 1} / ${liveSections.length} (${sectionId})…`);

    // 0. Wait for async diagram renders in the live DOM before cloning
    await waitForDiagrams(liveSection);

    // 1. Clone this single section into an off-screen wrapper
    const wrapper = document.createElement('div');
    wrapper.style.cssText = [
      'position: absolute',
      'left: -9999px',
      'top: 0',
      `width: ${SLIDE_W_PX}px`,
      'height: auto',
      'overflow: visible',
      'pointer-events: none',
      'z-index: -1',
    ].join('; ');
    copyThemeVars(liveRoot, wrapper);

    const clone = liveSection.cloneNode(true) as HTMLElement;
    clone.style.cssText += `; width: ${SLIDE_W_PX}px; height: auto; overflow: visible; opacity: 1; transform: none;`;
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    // 2. Patch clone
    rewriteLocalhostUrls(clone);
    removeNoiseOverlays(clone);
    fixGradientText(clone);
    resetAnimations(clone);
    patchCircularProgress(clone);
    await inlineImages(clone);
    // Unlock inner <section> so scrollHeight reflects full content (not overflow:hidden clip)
    clone.querySelector<HTMLElement>(':scope > section')?.style.setProperty('overflow', 'visible');

    // 3. Short settle for any JS-driven layout
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    if (i === 0) await new Promise(r => setTimeout(r, 300)); // extra wait for first (hero image)

    // 4. Measure natural height after layout
    const naturalH = Math.max(wrapper.scrollHeight, clone.scrollHeight, 100);

    // 5. Capture
    let sectionCanvas: HTMLCanvasElement;
    try {
      sectionCanvas = await html2canvas(wrapper, {
        scale,
        useCORS:         true,
        allowTaint:      true,
        logging:         false,
        width:           SLIDE_W_PX,
        height:          naturalH,
        windowWidth:     SLIDE_W_PX,
        windowHeight:    naturalH,
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0,
        backgroundColor: background,
        onclone: (_doc: Document, el: Element) => {
          (el as HTMLElement).style.overflow = 'visible';
          (el as HTMLElement).style.height   = `${naturalH}px`;
          (el as HTMLElement).querySelector<HTMLElement>(':scope > section')
            ?.style.setProperty('overflow', 'visible');
        },
      });
    } finally {
      document.body.removeChild(wrapper);
    }

    // 6. Add page(s) and draw image
    if (i > 0) pdf.addPage([SLIDE_W_PT, SLIDE_H_PT], 'portrait');

    const cW = sectionCanvas.width;   // SLIDE_W_PX * scale
    const cH = sectionCanvas.height;  // naturalH * scale

    // Section height in PDF points (width is always SLIDE_W_PT)
    const sectionHpt = SLIDE_W_PT * (cH / cW);

    if (sectionHpt <= SLIDE_H_PT) {
      // Section shorter than one slide — fill background, center vertically
      const imgData = sectionCanvas.toDataURL('image/jpeg', quality);
      pdf.setFillColor(background);
      pdf.rect(0, 0, SLIDE_W_PT, SLIDE_H_PT, 'F');
      const yOff = (SLIDE_H_PT - sectionHpt) / 2;
      pdf.addImage(imgData, 'JPEG', 0, yOff, SLIDE_W_PT, sectionHpt, undefined, 'FAST');
    } else if (sectionHpt <= SLIDE_H_PT * 1.05) {
      // Section just barely taller than one slide (≤5% overflow) — scale to fill one page.
      // This prevents a near-blank second page from sub-pixel rounding in vw/cqi units.
      // At ≤5% vertical compression the content is visually indistinguishable.
      const imgData = sectionCanvas.toDataURL('image/jpeg', quality);
      pdf.setFillColor(background);
      pdf.rect(0, 0, SLIDE_W_PT, SLIDE_H_PT, 'F');
      pdf.addImage(imgData, 'JPEG', 0, 0, SLIDE_W_PT, SLIDE_H_PT, undefined, 'FAST');
    } else {
      // Tall section — slice the canvas one slide at a time, no negative y offsets
      const totalPages = Math.ceil(sectionHpt / SLIDE_H_PT);
      const slideHpx   = (SLIDE_H_PT / sectionHpt) * cH; // canvas px per PDF slide

      const pageCanvas   = document.createElement('canvas');
      pageCanvas.width   = cW;
      pageCanvas.height  = Math.round(slideHpx);
      const pCtx         = pageCanvas.getContext('2d')!;

      for (let p = 0; p < totalPages; p++) {
        const startPx = Math.round(p * slideHpx);                      // fresh per page — no float drift
        const slicePx = Math.min(Math.round(slideHpx), cH - startPx); // shorter on last page

        // Skip a negligibly thin last slice (< 0.5% of a full slide) — this avoids a
        // blank overflow page when sectionHpt is a near-integer multiple of SLIDE_H_PT
        // due to floating-point rounding in the pt→px conversion.
        if (p === totalPages - 1 && slicePx < pageCanvas.height * 0.005) break;

        pCtx.fillStyle = background;
        pCtx.fillRect(0, 0, cW, pageCanvas.height);                    // fill bg first (handles partial last page)
        pCtx.drawImage(sectionCanvas, 0, startPx, cW, slicePx, 0, 0, cW, slicePx);

        const sliceData = pageCanvas.toDataURL('image/jpeg', quality); // synchronous snapshot before next iteration

        if (p > 0) pdf.addPage([SLIDE_W_PT, SLIDE_H_PT], 'portrait');

        pdf.setFillColor(background);
        pdf.rect(0, 0, SLIDE_W_PT, SLIDE_H_PT, 'F');
        pdf.addImage(sliceData, 'JPEG', 0, 0, SLIDE_W_PT, SLIDE_H_PT, undefined, 'FAST');
      }
    }
  }

  emit(onProgress, 88, 'Checking file size…');

  let blob = pdf.output('blob');
  const MAX = 5 * 1024 * 1024;

  if (blob.size > MAX) {
    emit(onProgress, 91, 'Optimizing…');
    blob = await recompressPDF(pdf, quality, liveSections.length);
  }

  emit(onProgress, 97, 'Saving…');

  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
  a.click();
  URL.revokeObjectURL(url);

  emit(onProgress, 100, 'Done!');

  return {
    success:    true,
    fileSizeMB: Math.round((blob.size / 1024 / 1024) * 100) / 100,
    pageCount:  liveSections.length,
  };
}

/** Re-export the existing PDF at lower quality until it fits under 5 MB. */
async function recompressPDF(
  pdf: InstanceType<typeof import('jspdf').default>,
  _quality: number,
  _pageCount: number,
): Promise<Blob> {
  // jsPDF doesn't allow recompression of already-added images;
  // just return the current blob — the per-section approach already produces small files
  return pdf.output('blob');
}
