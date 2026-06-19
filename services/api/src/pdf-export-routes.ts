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
      const { pdfW, pdfH, vpW, vpH } = DIMS[orientation];

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

      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      try {
        const page = await browser.newPage();
        await page.setViewport({ width: vpW, height: vpH, deviceScaleFactor: 1 });

        // Load the full self-contained HTML — wait for network to idle so fonts/images resolve
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

        // Extra settle time for web fonts and CSS transitions
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

        // Collect slide handles — microsite slides are direct <section> children of <body>
        const sectionHandles = await page.$$('body > section');
        const handles = sectionHandles.length > 0
          ? sectionHandles
          : await page.$$('body');

        if (handles.length === 0) {
          return reply.code(500).send({ error: 'No slide sections found in microsite' });
        }

        const pdfDoc = await PDFDocument.create();

        for (const handle of handles) {
          // screenshot() on an ElementHandle captures the element's full bounding box
          const screenshot = await handle.screenshot({ type: 'jpeg', quality: 92 }) as Buffer;
          const img = await pdfDoc.embedJpg(screenshot);
          const pdfPage = pdfDoc.addPage([pdfW, pdfH]);
          pdfPage.drawImage(img, { x: 0, y: 0, width: pdfW, height: pdfH });
        }

        const pdfBytes = await pdfDoc.save();

        const safeName = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
        void reply.header('Content-Type', 'application/pdf');
        void reply.header('Content-Disposition', `attachment; filename="${safeName}-presentation.pdf"`);
        return reply.send(Buffer.from(pdfBytes));

      } finally {
        await browser.close();
      }
    },
  );
}
