import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';

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
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
      } catch (err) {
        req.log.error({ err }, 'Puppeteer launch failed');
        return reply.code(500).send({ error: `Puppeteer launch failed: ${(err as Error).message}` });
      }

      try {
        const page = await browser.newPage();
        await page.setViewport({ width: vpW, height: vpH, deviceScaleFactor: 1 });

        // Strip CSS @import rules that point to external font CDNs.
        // Google Fonts' @import blocks DOMContentLoaded in headless Chrome when the
        // TLS/DNS handshake is slow; removing it lets Chrome use system-font fallbacks
        // and avoids Puppeteer's 30s navigation lifecycle timeout entirely.
        const exportHtml = html.replace(/@import\s+url\([^)]+\)\s*;/g, '');

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
          new Promise<void>((r) => setTimeout(r, 10_000)),
        ]);

        // Extra settle for web fonts and CSS transitions
        await new Promise<void>(r => setTimeout(r, 1500));

        // Hide fixed-position elements (nav bars, cookie banners) so they don't overlay
        // every slide screenshot — fixed elements follow scroll and land inside each section's
        // clip rect when Puppeteer scrolls the page before capturing.
        await page.evaluate(() => {
          document.querySelectorAll<HTMLElement>('*').forEach(el => {
            if (getComputedStyle(el).position === 'fixed') {
              el.style.setProperty('display', 'none', 'important');
            }
          });
        });

        // Expand viewport to the tallest section so content-dense slides render fully.
        // Without this, browser rendering culls off-screen content and screenshots
        // of sections taller than vpH capture blank space at the bottom.
        const maxSectionH = await page.evaluate(() => {
          const sections = document.querySelectorAll<HTMLElement>('section[data-section-id]');
          return sections.length > 0
            ? Math.max(...Array.from(sections).map(s => Math.ceil(s.getBoundingClientRect().height)))
            : 0;
        });
        if (maxSectionH > vpH) {
          await page.setViewport({ width: vpW, height: maxSectionH, deviceScaleFactor: 1 });
          await new Promise<void>(r => setTimeout(r, 400));
        }

        // Collect slide handles — match sections by data-section-id so the selector works
        // regardless of whether sections are direct <body> children or wrapped in a container div.
        const sectionHandles = await page.$$('section[data-section-id]');
        const handles = sectionHandles.length > 0
          ? sectionHandles
          : await page.$$('body > section').then(r => r.length ? r : page.$$('body'));

        if (handles.length === 0) {
          return reply.code(500).send({ error: 'No slide sections found in microsite' });
        }

        const pdfDoc = await PDFDocument.create();

        for (const handle of handles) {
          const screenshot = await handle.screenshot({ type: 'jpeg', quality: 92 }) as Buffer;
          const img = await pdfDoc.embedJpg(screenshot);
          // Derive PDF page height from actual screenshot aspect ratio so content-dense
          // slides (taller than 16:9) are never squished to fit a hardcoded page size.
          const scale = pdfW / img.width;
          const pageH = img.height * scale;
          const pdfPage = pdfDoc.addPage([pdfW, pageH]);
          pdfPage.drawImage(img, { x: 0, y: 0, width: pdfW, height: pageH });
        }

        const pdfBytes = await pdfDoc.save();

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
