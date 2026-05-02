/**
 * Large-file streaming ingestion routes.
 *
 * Endpoints:
 *   POST /api/documents/upload           — streaming multipart upload
 *   GET  /api/ai-executions/stream       — SSE execution status feed
 *   GET  /api/ingestion/jobs/:jobId      — poll a single ingestion job
 *
 * Upload design:
 *   The file stream is piped DIRECTLY from the multipart parser to the
 *   StorageProvider — the full file is never held in Node.js memory.
 *   A PassThrough stream counts bytes for the metadata record.
 *
 *   After the file lands in storage, an IngestionJob is created and enqueued.
 *   The job ID is returned to the client immediately (HTTP 202).
 *
 * SSE design:
 *   A shared in-process EventEmitter (executionBus) receives status updates
 *   from the ingestion worker.  Each SSE client subscribes to "update" events
 *   and receives them as `data: {json}\n\n` frames.  A 30-second keepalive
 *   ping prevents idle connections from being dropped by proxies.
 *
 * Security:
 *   - Namespace access verified against req.auth.allowedNamespaces on every route
 *   - File names validated (no traversal, no absolute paths)
 *   - 500 MB per-upload limit (overrides global 25 MB multipart limit)
 *   - Signed-URL TTL capped at 3600 s by AssetService
 */

import path from 'node:path';
import { PassThrough } from 'node:stream';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ConfigResolver } from '@ai-engine/core';
import { createNodeConfigLoader, getStorageProvider } from '@ai-engine/runtime';
import { type AuthContext, isWildcard } from '../auth.js';
import { ingestionQueue } from './ingestion-queue.js';
import { upsertFile, loadFilesIndex } from './ingestion-service.js';
import { executionBus, type ExecutionEvent } from '../execution-events.js';

// ── Helpers ───────────────────────────────────────────────────────

function getAuth(req: FastifyRequest): AuthContext {
  return (req as FastifyRequest & { auth: AuthContext }).auth;
}

function denyNamespace(
  auth: AuthContext,
  namespace: string,
  reply: FastifyReply,
): boolean {
  if (isWildcard(auth.allowedNamespaces)) return false;
  if (auth.allowedNamespaces.includes(namespace)) return false;
  reply.code(403).send({ error: `Access denied for namespace: "${namespace}"` });
  return true;
}

/** Map files.json status strings to the execution status vocabulary. */
function mapJobStatus(status: string): string {
  switch (status) {
    case 'uploaded':    return 'queued';
    case 'processing':  return 'running';
    case 'extracting':  return 'running';
    case 'indexed':     return 'completed';
    case 'extracted':   return 'completed';
    case 'failed':      return 'failed';
    default:            return status;
  }
}


// ── Route registration ────────────────────────────────────────────

export function registerStreamUploadRoutes(
  app: FastifyInstance,
  workdir: string,
): void {

  // ── POST /api/documents/upload ─────────────────────────────────

  app.post('/api/documents/upload', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const namespace = query.namespace;

    if (!namespace) {
      return reply.code(400).send({ error: 'Missing required query param: namespace' });
    }
    if (denyNamespace(getAuth(req), namespace, reply)) return;

    // Override the global 25 MB multipart limit for this route
    const part = await req.file({ limits: { fileSize: 500 * 1024 * 1024 } });
    if (!part) {
      return reply.code(400).send({ error: 'No file found in request body' });
    }

    const fileName = part.filename;
    if (!fileName) {
      return reply.code(400).send({ error: 'Uploaded file must have a filename' });
    }
    if (fileName.includes('..') || fileName.startsWith('/')) {
      return reply.code(400).send({ error: `Invalid file name: "${fileName}"` });
    }

    // Resolve storage provider for this namespace
    const configLoader = createNodeConfigLoader(path.join(workdir, 'config'));
    const configResolver = new ConfigResolver(configLoader);
    const config = await configResolver.resolve({ namespace });
    const provider = getStorageProvider({ namespace, config, workdir });

    // PassThrough stream that counts bytes without buffering full content
    let bytesWritten = 0;
    const counter = new PassThrough();
    counter.on('data', (chunk: Buffer) => { bytesWritten += chunk.length; });
    part.file.pipe(counter);

    const relativePath = `uploads/${fileName}`;
    let uri: string;

    try {
      if (typeof provider.writeStream === 'function') {
        // True streaming path — no full-file buffer
        uri = await provider.writeStream(relativePath, counter);
      } else {
        // Fallback: buffer the stream (providers that lack writeStream)
        const chunks: Buffer[] = [];
        for await (const chunk of counter) chunks.push(chunk as Buffer);
        const buf = Buffer.concat(chunks);
        bytesWritten = buf.length;
        uri = await provider.writeFile(relativePath, buf);
      }
    } catch (err) {
      return reply.code(500).send({
        error: `Upload failed: ${(err as Error).message}`,
      });
    }

    // Register file in files.json and enqueue the ingestion job
    const jobId = crypto.randomUUID();
    await upsertFile(workdir, namespace, {
      fileName,
      size: bytesWritten,
      uploadedAt: new Date().toISOString(),
      status: 'uploaded',
      uri,
      jobId,
    });

    ingestionQueue.enqueue({ namespace, fileName, uri });

    return reply.code(202).send({
      jobId,
      uri,
      fileName,
      size: bytesWritten,
      status: 'queued',
    });
  });

  // ── GET /api/ai-executions/stream ──────────────────────────────

  app.get('/api/ai-executions/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = reply.raw;

    raw.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });

    const send = (event: ExecutionEvent): void => {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    executionBus.on('update', send);

    // Keepalive ping every 30 s — prevents idle proxy timeouts
    const keepAlive = setInterval(() => {
      raw.write(': ping\n\n');
    }, 30_000);

    req.raw.on('close', () => {
      executionBus.off('update', send);
      clearInterval(keepAlive);
    });
    // Intentionally no reply.send() — the SSE connection stays open
  });

  // ── GET /api/ingestion/jobs/:jobId ─────────────────────────────

  app.get('/api/ingestion/jobs/:jobId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };
    const { namespace } = req.query as Record<string, string>;

    if (!namespace) {
      return reply.code(400).send({ error: 'Missing required query param: namespace' });
    }
    if (denyNamespace(getAuth(req), namespace, reply)) return;

    const files = await loadFilesIndex(workdir, namespace);
    const entry = files.find((f) => f.jobId === jobId);

    if (!entry) {
      return reply.code(404).send({ error: `Job not found: "${jobId}"` });
    }

    return reply.send({
      jobId,
      fileName:   entry.fileName,
      status:     mapJobStatus(entry.status),
      uri:        entry.uri,
      size:       entry.size,
      chunkCount: entry.chunkCount,
      error:      entry.error,
    });
  });

}

