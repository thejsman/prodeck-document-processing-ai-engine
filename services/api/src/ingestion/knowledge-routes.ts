/**
 * Knowledge route handlers — async document upload and ingestion status.
 *
 * Endpoints:
 *   POST   /knowledge/upload              — save files, enqueue indexing jobs
 *   GET    /knowledge/files               — list files with ingestion status
 *   DELETE /knowledge/files/:fileName     — delete file + remove from index
 *   POST   /knowledge/reindex             — re-queue a single file for indexing
 */

import { writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ConfigResolver } from '@ai-engine/core';
import { createNodeConfigLoader, getStorageProvider } from '@ai-engine/runtime';
import { type AuthContext, isWildcard } from '../auth.js';
import {
  loadFilesIndex,
  upsertFile,
  updateFileStatus,
  removeFileEntry,
  type IngestionFile,
} from './ingestion-service.js';
import { ingestionQueue } from './ingestion-queue.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 MB
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
    let classification: import('../chat/context.types.js').DocumentClassification | undefined;
    const accepted: { fileName: string; buffer: Buffer; size: number }[] = [];
    const rejected: string[] = [];

    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'namespace' && typeof part.value === 'string') {
          namespace = part.value.trim() || 'default';
        }
        if (part.fieldname === 'classification' && typeof part.value === 'string') {
          classification = part.value.trim() as import('../chat/context.types.js').DocumentClassification;
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
          error: `File "${rawName}" exceeds the 200 MB size limit`,
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

    // Resolve namespace config to determine storage backend
    const configLoader = createNodeConfigLoader(path.join(workdir, 'config'));
    const configResolver = new ConfigResolver(configLoader);
    const config = await configResolver.resolve({ namespace });
    const useS3 = (config.storage as { type?: string } | undefined)?.type === 's3';

    // Save files to local uploads directory (always — ingestion buffer path reads from here)
    const uploadsDir = path.join(workdir, 'namespaces', namespace, 'uploads');
    await mkdir(uploadsDir, { recursive: true });

    const now = new Date().toISOString();
    const queued: Array<{ fileName: string; jobId: string }> = [];

    for (const file of accepted) {
      const dest = path.join(uploadsDir, file.fileName);
      const resolved = path.resolve(dest);
      if (!resolved.startsWith(path.resolve(uploadsDir))) {
        return reply.code(400).send({ error: `Invalid file name: ${file.fileName}` });
      }
      await writeFile(dest, file.buffer);

      // If S3 is configured for this namespace, mirror the file to S3
      let uri: string | undefined;
      if (useS3) {
        const provider = getStorageProvider({ namespace, config, workdir });
        uri = await provider.writeFile(`uploads/${file.fileName}`, file.buffer);
      }

      // Add/update entry in files.json with status 'uploaded'
      const entry: IngestionFile = {
        fileName: file.fileName,
        size: file.size,
        uploadedAt: now,
        status: 'uploaded',
        ...(uri ? { uri } : {}),
      };
      await upsertFile(workdir, namespace, entry);

      // Enqueue background indexing job — capture the job ID for the response
      const jobId = ingestionQueue.enqueue({ namespace, fileName: file.fileName, classification });
      queued.push({ fileName: file.fileName, jobId });
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

  // DELETE /knowledge/files/:fileName?namespace=<ns>
  app.delete('/knowledge/files/:fileName', async (req: FastifyRequest, reply: FastifyReply) => {
    const { fileName } = req.params as { fileName: string };
    const { namespace } = req.query as { namespace?: string };

    if (!namespace) {
      return reply.code(400).send({ error: 'Missing required query param: namespace' });
    }

    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const sanitized = sanitizeFileName(fileName);
    if (!sanitized || sanitized === '_') {
      return reply.code(400).send({ error: 'Invalid file name' });
    }

    const uploadsDir = path.join(workdir, 'namespaces', namespace, 'uploads');
    const filePath = path.join(uploadsDir, fileName);
    const resolved = path.resolve(filePath);

    if (!resolved.startsWith(path.resolve(uploadsDir))) {
      return reply.code(400).send({ error: 'Invalid file name' });
    }

    try {
      const fileStat = await stat(resolved);
      if (!fileStat.isFile()) {
        return reply.code(404).send({ error: `File not found: ${fileName}` });
      }
      await unlink(resolved);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // File already gone — still remove from index
      } else {
        throw err;
      }
    }

    await removeFileEntry(workdir, namespace, sanitized);

    return reply.send({ ok: true });
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
