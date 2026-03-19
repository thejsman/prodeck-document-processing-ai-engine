/**
 * Knowledge route handlers — async document upload and ingestion status.
 *
 * Endpoints:
 *   POST /knowledge/upload         — save files, enqueue indexing jobs
 *   GET  /knowledge/files          — list files with ingestion status
 *   POST /knowledge/reindex        — re-queue a single file for indexing
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { type AuthContext, isWildcard } from '../auth.js';
import {
  loadFilesIndex,
  upsertFile,
  updateFileStatus,
  type IngestionFile,
} from './ingestion-service.js';
import { ingestionQueue } from './ingestion-queue.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.txt', '.md']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeFileName(raw: string): string {
  const base = path.basename(raw);
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isAllowedExtension(fileName: string): boolean {
  return ALLOWED_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function checkNamespaceAccess(
  auth: AuthContext,
  namespace: string,
  reply: FastifyReply,
): boolean {
  if (isWildcard(auth.allowedNamespaces)) return true;
  if (auth.allowedNamespaces.includes(namespace)) return true;
  reply.code(403).send({ error: `Access denied for namespace: ${namespace}` });
  return false;
}

function getAuth(req: FastifyRequest): AuthContext {
  return (req as FastifyRequest & { auth: AuthContext }).auth;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerKnowledgeRoutes(
  app: FastifyInstance,
  workdir: string,
): void {

  // POST /knowledge/upload
  app.post('/knowledge/upload', async (req: FastifyRequest, reply: FastifyReply) => {
    const parts = req.parts();

    let namespace = 'default';
    const accepted: { fileName: string; buffer: Buffer; size: number }[] = [];
    const rejected: string[] = [];

    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'namespace' && typeof part.value === 'string') {
          namespace = part.value.trim() || 'default';
        }
        continue;
      }

      const rawName = part.filename ?? 'unnamed';
      const safeName = sanitizeFileName(rawName);

      if (!safeName || safeName === '_' || !isAllowedExtension(safeName)) {
        rejected.push(rawName);
        await part.toBuffer();
        continue;
      }

      const buffer = await part.toBuffer();

      if (buffer.length > MAX_FILE_SIZE) {
        return reply.code(400).send({
          error: `File "${rawName}" exceeds the 25 MB size limit`,
        });
      }

      accepted.push({ fileName: safeName, buffer, size: buffer.length });
    }

    if (rejected.length > 0 && accepted.length === 0) {
      return reply.code(400).send({
        error: `No valid files. Rejected: ${rejected.join(', ')}. Only .pdf, .txt, and .md files are allowed.`,
      });
    }

    if (accepted.length === 0) {
      return reply.code(400).send({ error: 'No files provided' });
    }

    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    // Save files to uploads directory
    const uploadsDir = path.join(workdir, 'namespaces', namespace, 'uploads');
    await mkdir(uploadsDir, { recursive: true });

    const now = new Date().toISOString();
    const queued: string[] = [];

    for (const file of accepted) {
      const dest = path.join(uploadsDir, file.fileName);
      const resolved = path.resolve(dest);
      if (!resolved.startsWith(path.resolve(uploadsDir))) {
        return reply.code(400).send({ error: `Invalid file name: ${file.fileName}` });
      }
      await writeFile(dest, file.buffer);

      // Add/update entry in files.json with status 'uploaded'
      const entry: IngestionFile = {
        fileName: file.fileName,
        size: file.size,
        uploadedAt: now,
        status: 'uploaded',
      };
      await upsertFile(workdir, namespace, entry);

      // Enqueue background indexing job
      ingestionQueue.enqueue({ namespace, fileName: file.fileName });
      queued.push(file.fileName);
    }

    return reply.code(202).send({
      files: accepted.length,
      queued,
      ...(rejected.length > 0 ? { rejected } : {}),
    });
  });

  // GET /knowledge/files?namespace=<ns>
  app.get('/knowledge/files', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.query as { namespace?: string };
    if (!namespace) {
      return reply.code(400).send({ error: 'Missing required query param: namespace' });
    }

    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const files = await loadFilesIndex(workdir, namespace);
    return reply.send({ files });
  });

  // POST /knowledge/reindex
  app.post('/knowledge/reindex', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { namespace?: string; fileName?: string } | undefined;
    if (!body?.namespace || !body?.fileName) {
      return reply.code(400).send({ error: 'Missing required fields: namespace, fileName' });
    }

    const { namespace, fileName } = body;
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    // Reset status and re-enqueue
    await updateFileStatus(workdir, namespace, fileName, 'uploaded');
    ingestionQueue.enqueue({ namespace, fileName });

    return reply.send({ ok: true });
  });
}
