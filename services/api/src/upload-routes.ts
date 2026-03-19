/**
 * Upload route handlers — namespace file management.
 *
 * The POST /upload endpoint has been replaced by POST /knowledge/upload
 * (see ingestion/knowledge-routes.ts) which returns immediately and processes
 * files asynchronously.
 *
 * Endpoints kept here:
 *   GET    /namespaces/:namespace/files           — list files (legacy, no status field)
 *   DELETE /namespaces/:namespace/files/:fileName — delete file + queue reindex
 */

import { readFile, writeFile, mkdir, readdir, stat, unlink, appendFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { type AuthContext, isWildcard } from './auth.js';
import {
  type ProviderPolicyConfig,
} from './provider-policy.js';
import {
  removeFileEntry,
  updateFileStatus,
} from './ingestion/ingestion-service.js';
import { ingestionQueue } from './ingestion/ingestion-queue.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeFileName(raw: string): string {
  const base = path.basename(raw);
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
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

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerUploadRoutes(
  app: FastifyInstance,
  workdir: string,
  _policyConfig: ProviderPolicyConfig | null,
): void {

  // GET /namespaces/:namespace/files
  app.get('/namespaces/:namespace/files', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string };
    const auth = (req as FastifyRequest & { auth: AuthContext }).auth;

    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const uploadsDir = path.join(workdir, 'namespaces', namespace, 'uploads');

    let entries: string[];
    try {
      entries = await readdir(uploadsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.send({ files: [] });
      }
      throw err;
    }

    const files = [];
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const filePath = path.join(uploadsDir, name);
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) continue;
      files.push({
        fileName: name,
        size: fileStat.size,
        uploadedAt: fileStat.mtime.toISOString(),
      });
    }

    files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    return reply.send({ files });
  });

  // DELETE /namespaces/:namespace/files/:fileName
  app.delete('/namespaces/:namespace/files/:fileName', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, fileName } = req.params as { namespace: string; fileName: string };
    const auth = (req as FastifyRequest & { auth: AuthContext }).auth;

    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const sanitized = sanitizeFileName(fileName);
    if (!sanitized || sanitized !== fileName || sanitized === '_') {
      return reply.code(400).send({ error: 'Invalid file name' });
    }

    const uploadsDir = path.join(workdir, 'namespaces', namespace, 'uploads');
    const filePath = path.join(uploadsDir, sanitized);
    const resolved = path.resolve(filePath);

    if (!resolved.startsWith(path.resolve(uploadsDir))) {
      return reply.code(400).send({ error: 'Invalid file name' });
    }

    try {
      const fileStat = await stat(resolved);
      if (!fileStat.isFile()) {
        return reply.code(404).send({ error: `File not found: ${sanitized}` });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.code(404).send({ error: `File not found: ${sanitized}` });
      }
      throw err;
    }

    // Delete the file
    await unlink(resolved);

    // Audit log
    const auditLogDir = path.join(workdir, 'logs');
    await mkdir(auditLogDir, { recursive: true });
    const auditEntry = {
      timestamp: new Date().toISOString(),
      action: 'file_deleted',
      namespace,
      fileName: sanitized,
      apiKey: auth.apiKey,
    };
    await appendFile(
      path.join(auditLogDir, 'deletion-audit.log'),
      JSON.stringify(auditEntry) + '\n',
      'utf-8',
    );

    // Remove from files.json
    await removeFileEntry(workdir, namespace, sanitized);

    // Re-queue all remaining files for a full index rebuild
    let remainingEntries: string[];
    try {
      remainingEntries = await readdir(uploadsDir);
    } catch {
      remainingEntries = [];
    }

    const remainingFiles: string[] = [];
    for (const name of remainingEntries) {
      if (name.startsWith('.')) continue;
      const fp = path.join(uploadsDir, name);
      const s = await stat(fp);
      if (!s.isFile()) continue;
      remainingFiles.push(name);
    }

    if (remainingFiles.length > 0) {
      // Mark remaining files as 'uploaded' so status reflects pending reindex
      for (const name of remainingFiles) {
        await updateFileStatus(workdir, namespace, name, 'uploaded');
      }
      // Single queue job rebuilds all remaining files
      ingestionQueue.enqueue({
        namespace,
        fileName: remainingFiles[0],
        allFiles: remainingFiles,
      });
    }

    return reply.send({ ok: true, fileName: sanitized });
  });
}
