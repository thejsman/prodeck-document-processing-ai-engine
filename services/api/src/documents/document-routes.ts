// services/api/src/documents/document-routes.ts
//
// REST routes for generated documents under a super-client.
//
// GET    /super-clients/:name/generated-documents                    → list index
// GET    /super-clients/:name/generated-documents/:id               → fetch content (.md)
// GET    /super-clients/:name/generated-documents/:id/meta          → fetch metadata
// GET    /super-clients/:name/generated-documents/:id/export        → download in format
// DELETE /super-clients/:name/generated-documents/:id               → delete

import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listDocuments,
  getDocumentContent,
  getDocumentMeta,
  deleteDocument,
} from './document-generator.js';
import { exportDocument } from './document-exporter.js';
import type { OutputFormat } from '../skills/skill.types.js';

const FORMAT_EXT: Partial<Record<OutputFormat, string>> = {
  pptx: 'pptx',
  docx: 'docx',
  rtf:  'rtf',
  pdf:  'pdf',
  txt:  'txt',
  notion: 'md',
}

const FORMAT_MIME: Partial<Record<OutputFormat, string>> = {
  pptx:   'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx:   'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf:    'application/rtf',
  pdf:    'application/pdf',
  txt:    'text/plain',
  notion: 'text/markdown',
}

const VALID_FORMATS = new Set<OutputFormat>(['md', 'txt', 'pdf', 'docx', 'rtf', 'pptx', 'notion']);

function guardName(name: string, root: string): void {
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw Object.assign(new Error('Invalid client name'), { statusCode: 400 });
  }
  const resolved = path.resolve(path.join(root, name));
  if (!resolved.startsWith(path.resolve(root))) {
    throw Object.assign(new Error('Path traversal detected'), { statusCode: 400 });
  }
}

function guardId(id: string): void {
  if (!/^[\w-]+$/.test(id)) {
    throw Object.assign(new Error('Invalid document ID'), { statusCode: 400 });
  }
}

export function registerDocumentRoutes(app: FastifyInstance, workdir: string): void {
  const superClientsRoot = path.join(workdir, 'super-clients');

  // GET /super-clients/:name/generated-documents
  app.get<{ Params: { name: string } }>(
    '/super-clients/:name/generated-documents',
    async (req: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const { name } = req.params;
      try {
        guardName(name, superClientsRoot);
        const docs = await listDocuments(workdir, name);
        return reply.send(docs);
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode ?? 500;
        return reply.code(code).send({ error: (err as Error).message });
      }
    },
  );

  // GET /super-clients/:name/generated-documents/:id
  app.get<{ Params: { name: string; id: string } }>(
    '/super-clients/:name/generated-documents/:id',
    async (req: FastifyRequest<{ Params: { name: string; id: string } }>, reply: FastifyReply) => {
      const { name, id } = req.params;
      try {
        guardName(name, superClientsRoot);
        guardId(id);
        const content = await getDocumentContent(workdir, name, id);
        return reply.header('Content-Type', 'text/markdown').send(content);
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode ?? 404;
        return reply.code(code).send({ error: (err as Error).message });
      }
    },
  );

  // GET /super-clients/:name/generated-documents/:id/meta
  app.get<{ Params: { name: string; id: string } }>(
    '/super-clients/:name/generated-documents/:id/meta',
    async (req: FastifyRequest<{ Params: { name: string; id: string } }>, reply: FastifyReply) => {
      const { name, id } = req.params;
      try {
        guardName(name, superClientsRoot);
        guardId(id);
        const meta = await getDocumentMeta(workdir, name, id);
        return reply.send(meta);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  // GET /super-clients/:name/generated-documents/:id/export?format=md|txt|pdf|docx|pptx|notion
  app.get<{ Params: { name: string; id: string }; Querystring: { format?: string } }>(
    '/super-clients/:name/generated-documents/:id/export',
    async (
      req: FastifyRequest<{ Params: { name: string; id: string }; Querystring: { format?: string } }>,
      reply: FastifyReply,
    ) => {
      const { name, id } = req.params;
      const rawFormat = req.query.format ?? 'md';

      if (!VALID_FORMATS.has(rawFormat as OutputFormat)) {
        return reply.code(400).send({ error: `Invalid format: ${rawFormat}` });
      }
      const format = rawFormat as OutputFormat;

      try {
        guardName(name, superClientsRoot);
        guardId(id);

        const docsDir = path.join(superClientsRoot, name, 'documents');

        // Serve pre-generated file if it exists (e.g. PPTX from slide-data-to-pptx.ts)
        const ext = FORMAT_EXT[format];
        if (ext && ext !== 'md') {
          const prebuiltPath = path.join(docsDir, `${id}.${ext}`);
          const exists = await stat(prebuiltPath).then(() => true).catch(() => false);
          if (exists) {
            const buffer = await readFile(prebuiltPath);
            const safeTitle = id;
            const mime = FORMAT_MIME[format] ?? 'application/octet-stream';
            return reply
              .header('Content-Type', mime)
              .header('Content-Disposition', `attachment; filename="${safeTitle}.${ext}"`)
              .send(buffer);
          }
        }

        const [content, meta] = await Promise.all([
          getDocumentContent(workdir, name, id),
          getDocumentMeta(workdir, name, id),
        ]);

        const result = await exportDocument(content, format, meta.title);

        return reply
          .header('Content-Type', result.mimeType)
          .header('Content-Disposition', `attachment; filename="${result.filename}"`)
          .send(result.buffer);
      } catch (err) {
        req.log.error({ err }, 'document export failed');
        return reply.code(500).send({ error: (err as Error).message });
      }
    },
  );

  // GET /super-clients/:name/generated-documents/:id/preview
  app.get<{ Params: { name: string; id: string } }>(
    '/super-clients/:name/generated-documents/:id/preview',
    async (req: FastifyRequest<{ Params: { name: string; id: string } }>, reply: FastifyReply) => {
      const { name, id } = req.params;
      try {
        guardName(name, superClientsRoot);
        guardId(id);
        const previewPath = path.join(superClientsRoot, name, 'documents', `${id}.slide-preview.html`);
        const exists = await stat(previewPath).then(() => true).catch(() => false);
        if (!exists) return reply.code(404).send({ error: 'Slide preview not available' });
        const html = await readFile(previewPath, 'utf-8');
        return reply.header('Content-Type', 'text/html').send(html);
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode ?? 500;
        return reply.code(code).send({ error: (err as Error).message });
      }
    },
  );

  // DELETE /super-clients/:name/generated-documents/:id
  app.delete<{ Params: { name: string; id: string } }>(
    '/super-clients/:name/generated-documents/:id',
    async (req: FastifyRequest<{ Params: { name: string; id: string } }>, reply: FastifyReply) => {
      const { name, id } = req.params;
      try {
        guardName(name, superClientsRoot);
        guardId(id);
        await deleteDocument(workdir, name, id);
        return reply.code(204).send();
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );
}
