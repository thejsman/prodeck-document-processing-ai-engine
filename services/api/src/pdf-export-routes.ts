import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import puppeteer from 'puppeteer';

// Fetch all external image URLs found in src attributes and CSS url() and replace
// them with base64 data URIs so Puppeteer never needs to make outbound requests.
// Node.js follows Unsplash redirects; Puppeteer in headless mode often drops them.
async function inlineExternalImages(html: string): Promise<string> {
  const urlSet = new Set<string>();

  const srcRe = /\bsrc=["']((https?:\/\/)[^"']+)["']/gi;
  const bgRe = /url\(['"]?((https?:\/\/)[^'")\s]+)['"]?\)/gi;
  let m: RegExpExecArray | null;
  while ((m = srcRe.exec(html)) !== null) urlSet.add(m[1]);
  while ((m = bgRe.exec(html)) !== null) urlSet.add(m[1]);

  if (urlSet.size === 0) return html;

  const replacements = new Map<string, string>();
  await Promise.all(
    Array.from(urlSet).map(async (url) => {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(12_000) });
        if (!resp.ok) return;
        const ct = resp.headers.get('content-type') ?? 'image/jpeg';
        const buf = await resp.arrayBuffer();
        replacements.set(url, `data:${ct.split(';')[0]};base64,${Buffer.from(buf).toString('base64')}`);
      } catch { /* skip unreachable images */ }
    }),
  );

  let result = html;
  for (const [url, dataUri] of replacements) {
    result = result.split(url).join(dataUri);
  }
  return result;
}

// Chrome UA so Google Fonts returns woff2 (smaller, embeds cleanly in the PDF).
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Replace `@import url('https://fonts.googleapis.com/...')` with a fully self-contained
// <style> block: fetch the remote Fonts CSS, then inline every referenced font file as a
// data: URI. This keeps the real fonts (correct typography + metrics) while removing all
// outbound requests — so DOMContentLoaded never stalls (the reason imports were stripped
// before) and the fonts embed into the exported PDF, keeping text editable in Acrobat/AI.
async function inlineGoogleFonts(html: string): Promise<string> {
  const importRe = /@import\s+url\((['"]?)(https:\/\/fonts\.googleapis\.com\/[^'")]+)\1\)\s*;/gi;
  const imports: Array<{ raw: string; url: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(html)) !== null) {
    imports.push({ raw: m[0], url: m[2] });
  }
  if (imports.length === 0) return html;

  let result = html;

  await Promise.all(
    imports.map(async ({ raw, url }) => {
      try {
        // 1. Fetch the Google Fonts stylesheet (woff2 variant via Chrome UA).
        const cssResp = await fetch(url, {
          headers: { 'User-Agent': CHROME_UA },
          signal: AbortSignal.timeout(12_000),
        });
        if (!cssResp.ok) {
          // Fall back to stripping so a broken font URL never stalls the render.
          result = result.split(raw).join('');
          return;
        }
        let css = await cssResp.text();

        // 2. Inline every font-file URL referenced in the stylesheet.
        const fontUrls = new Set<string>();
        const fontUrlRe = /url\((https:\/\/[^)]+\.woff2?)\)/gi;
        let fm: RegExpExecArray | null;
        while ((fm = fontUrlRe.exec(css)) !== null) fontUrls.add(fm[1]);

        await Promise.all(
          Array.from(fontUrls).map(async (fontUrl) => {
            try {
              const fResp = await fetch(fontUrl, { signal: AbortSignal.timeout(12_000) });
              if (!fResp.ok) return;
              const ct = fResp.headers.get('content-type') ?? 'font/woff2';
              const buf = await fResp.arrayBuffer();
              const dataUri = `data:${ct.split(';')[0]};base64,${Buffer.from(buf).toString('base64')}`;
              css = css.split(fontUrl).join(dataUri);
            } catch { /* skip unreachable font file */ }
          }),
        );

        // 3. Swap the @import line for the resolved @font-face CSS. The import lives inside
        //    an existing <style> block, so inject the raw CSS in place (no wrapper tags).
        result = result.split(raw).join(`\n${css}\n`);
      } catch {
        // Network failure — strip the import rather than hang.
        result = result.split(raw).join('');
      }
    }),
  );

  return result;
}

const DIMS = {
  landscape: { pdfW: 841.89, pdfH: 473.56, vpW: 1280, vpH: 720 },
  portrait:  { pdfW: 473.56, pdfH: 841.89, vpW: 720,  vpH: 1280 },
};

export function registerPdfExportRoutes(app: FastifyInstance, workdir: string): void {
  app.get<{ Params: { name: string; id: string }; Querystring: { orientation?: string } }>(
    '/super-clients/:name/microsites/:id/export-pdf',
    async (req, reply) => {
      const { name, id } = req.params;
      const orientation = req.query.orientation === 'portrait' ? 'portrait' : 'landscape';
      const { pdfW, vpW, vpH } = DIMS[orientation];

      const superClientsRoot = path.join(workdir, 'super-clients');
      const filePath = path.join(superClientsRoot, name, 'microsites', `${id}.json`);

      // Guard against path traversal
      if (!path.resolve(filePath).startsWith(path.resolve(superClientsRoot))) {
        return reply.code(400).send({ error: 'Invalid path' });
      }

      // Read microsite HTML
      let html: string;
      try {
        const raw = await readFile(filePath, 'utf-8');
        const ast = JSON.parse(raw) as { sections?: Array<{ customHtml?: string }> };
        html = (ast.sections?.[0]?.customHtml ?? '').trim();
      } catch {
        return reply.code(404).send({ error: 'Microsite not found' });
      }

      if (!html) {
        return reply.code(400).send({ error: 'Microsite has no HTML content' });
      }

      let browser;
      try {
        browser = await puppeteer.launch({
          headless: true,
          ...(process.env.PUPPETEER_EXECUTABLE_PATH
            ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
            : {}),
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
      } catch (err) {
        req.log.error({ err }, 'Puppeteer launch failed');
        return reply.code(500).send({ error: `Puppeteer launch failed: ${(err as Error).message}` });
      }

      try {
        const page = await browser.newPage();
        await page.setViewport({ width: vpW, height: vpH, deviceScaleFactor: 1 });

        // Pre-fetch all external images and embed as base64 data URIs so Puppeteer
        // never needs outbound requests. source.unsplash.com uses 302 redirects that
        // headless Chrome drops; Node.js fetch follows them reliably.
        // Also resolve Google Fonts @import rules into self-contained @font-face CSS with
        // data-URI font files — keeps correct typography/metrics, embeds fonts in the PDF
        // (so text stays editable), and removes the outbound request that could stall load.
        const withFonts = await inlineGoogleFonts(html);
        const exportHtml = await inlineExternalImages(withFonts);

        // Inject HTML via document.write() instead of page.setContent() to bypass
        // Puppeteer 24.x's navigation lifecycle tracking — setContent() can hang
        // for the full 30s timeout when HTML references slow external resources.
        await page.goto('about:blank', { waitUntil: 'load', timeout: 10000 });
        await page.evaluate((h: string) => {
          document.open('text/html', 'replace');
          document.write(h);
          document.close();
        }, exportHtml);

        // After DOM is ready, wait up to 10s for images to finish loading so screenshots
        // show real photos rather than broken placeholders. Errors are swallowed so a
        // single slow/missing image doesn't block the whole export.
        await Promise.race([
          page.evaluate(() =>
            Promise.all(
              Array.from(document.images)
                .filter((img) => !img.complete)
                .map((img) => new Promise<void>((resolve) => { img.onload = img.onerror = () => resolve(); }))
            )
          ).catch(() => {}),
          new Promise<void>((r) => setTimeout(r, 5_000)),
        ]);

        // Wait for the embedded (data-URI) fonts to finish loading so text is laid out with
        // correct metrics before capture. Timeout-raced so a font that never resolves can't hang.
        await Promise.race([
          page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready.then(() => {})).catch(() => {}),
          new Promise<void>((r) => setTimeout(r, 4_000)),
        ]);

        // Extra settle for web fonts and CSS transitions
        await new Promise<void>(r => setTimeout(r, 1500));

        // Kill animations and force all scroll-reveal elements visible before hiding
        // nav bars. LLM-generated HTML often starts elements at opacity:0 and only
        // reveals them on scroll (IntersectionObserver / scroll event). Puppeteer never
        // fires those events so content stays invisible → blank slide screenshots.
        await page.evaluate(() => {
          const style = document.createElement('style');
          style.innerHTML = [
            '*{animation-play-state:paused!important;animation-delay:0s!important;animation-duration:0.001s!important;transition:none!important;}',
            '.word,.reveal,.reveal-text,.reveal-item,.reveal-card,.reveal-image,',
            '.reveal-up,.reveal-down,.reveal-left,.reveal-right,',
            '.fade-in,.fade-up,.fade-down,.fade-left,.fade-right,',
            '.slide-in,.slide-up,.slide-down,.slide-left,.slide-right,',
            '.zoom-in,.zoom-out,.scale-in,.scale-up,',
            '[data-aos],[data-sal],[data-scroll],[data-motion],',
            '[class*="scroll-reveal"],[class*="js-reveal"],',
            '[class*="animate-"]{opacity:1!important;transform:none!important;visibility:visible!important;clip-path:none!important;}',
          ].join('');
          document.head.appendChild(style);
        });

        // Hide fixed-position elements (nav bars, cookie banners) so they don't overlay
        // every slide screenshot — fixed elements follow scroll and land inside each section's
        // clip rect when Puppeteer scrolls the page before capturing.
        // Also hide elements marked data-pdf-hide (e.g. portrait top/bottom nav bars that
        // are browser-only UI and should not appear in the exported PDF).
        await page.evaluate(() => {
          document.querySelectorAll<HTMLElement>('*').forEach(el => {
            if (getComputedStyle(el).position === 'fixed') {
              el.style.setProperty('display', 'none', 'important');
            }
          });
          document.querySelectorAll<HTMLElement>('[data-pdf-hide]').forEach(el => {
            el.style.setProperty('display', 'none', 'important');
          });
        });

        // Verify slides exist before generating
        const slideCount = await page.$eval('section[data-section-id]', () => null)
          .then(() => page.$$eval('section[data-section-id]', s => s.length))
          .catch(() => 0);
        if (slideCount === 0) {
          return reply.code(500).send({ error: 'No slide sections found in microsite' });
        }

        // Inject @page rules so each section becomes exactly one PDF page with no margins.
        // page.pdf() uses the browser's print engine — text stays real PDF text (selectable,
        // copyable) rather than rasterised JPEG. printBackground:true preserves colours/images.
        await page.evaluate((w, h) => {
          const style = document.createElement('style');
          style.textContent = [
            `@page { size: ${w}px ${h}px; margin: 0; }`,
            `body { margin: 0 !important; padding: 0 !important; width: ${w}px !important; }`,
            `section[data-section-id] {`,
            `  width: ${w}px !important; height: ${h}px !important;`,
            `  overflow: hidden !important; display: block !important;`,
            `  margin: 0 !important; padding: 0 !important;`,
            `  page-break-after: always !important; break-after: page !important;`,
            `}`,
            `section[data-section-id]:last-of-type {`,
            `  page-break-after: auto !important; break-after: auto !important;`,
            `}`,
          ].join('\n');
          document.head.appendChild(style);
        }, vpW, vpH);

        // Render with screen media so the PDF matches the on-screen design (page.pdf()
        // defaults to print media, which would apply any print-only CSS behavior).
        await page.emulateMediaType('screen');

        // pageRanges caps output at exactly one page per slide, so any sub-pixel overflow
        // can't emit trailing blank pages.
        const pdfBytes = await page.pdf({
          width: `${vpW}px`,
          height: `${vpH}px`,
          printBackground: true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
          pageRanges: `1-${slideCount}`,
        });

        const safeName = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
        void reply.header('Content-Type', 'application/pdf');
        void reply.header('Content-Disposition', `attachment; filename="${safeName}-presentation.pdf"`);
        return reply.send(Buffer.from(pdfBytes));

      } catch (err) {
        req.log.error({ err }, 'PDF export failed');
        return reply.code(500).send({ error: `PDF export failed: ${(err as Error).message}` });
      } finally {
        await browser.close();
      }
    },
  );
}
