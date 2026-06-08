/**
 * GET /ai-executions/stream
 *
 * Server-Sent Events endpoint. Clients connect once and receive real-time
 * execution status updates pushed by the in-process executionBus.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { executionBus, extractionBus, progressBus, getExecution, type ExecutionEvent, type ExtractionReadyPayload, type IngestionProgressEvent } from './execution-events.js';
import { loadFilesIndex, computeLegacyStatus } from './ingestion/ingestion-service.js';

async function findIngestionJobById(
  workdir: string,
  jobId: string,
): Promise<{ status: string } | null> {
  const nsRoot = path.join(workdir, 'namespaces');
  let namespaces: string[];
  try {
    const entries = await readdir(nsRoot, { withFileTypes: true });
    namespaces = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }
  for (const ns of namespaces) {
    const files = await loadFilesIndex(workdir, ns);
    const match = files.find((f) => f.jobId === jobId);
    if (match) {
      const legacy = computeLegacyStatus(match);
      const status =
        legacy === 'indexed' || legacy === 'extracted' ? 'COMPLETED'
        : legacy === 'failed' ? 'FAILED'
        : legacy === 'processing' || legacy === 'extracting' ? 'RUNNING'
        : 'PENDING';
      return { status };
    }
  }
  return null;
}

export function registerExecutionStreamRoutes(app: FastifyInstance, workdir?: string): void {
  // ── Polling fallback — lets the frontend poller catch up on missed SSE events
  app.get('/ai-executions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = getExecution(id);
    if (event) return reply.send({ id: event.executionId, status: event.status, type: event.type ?? null });

    // Cache miss — check files.json for ingestion jobs whose event has expired
    if (workdir) {
      const ingestion = await findIngestionJobById(workdir, id);
      if (ingestion) return reply.send({ id, status: ingestion.status, type: 'ingestion' });
    }

    return reply.code(404).send({ error: 'Not found' });
  });

  // ── Trace snapshot — returns status + any server-side metadata for a given execution
  app.get('/ai-executions/:id/trace', async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = getExecution(id);
    if (!event) return reply.code(404).send({ error: 'Not found' });
    return reply.send({
      executionId: event.executionId,
      status: event.status,
      type: event.type ?? null,
      steps: [],
    });
  });

  app.get('/ai-executions/stream', async (req, reply) => {
    const raw = reply.raw;

    raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    raw.setHeader('Cache-Control', 'no-cache');
    raw.setHeader('Connection', 'keep-alive');
    raw.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    raw.flushHeaders();

    // Send a heartbeat every 25 s to keep the connection alive through proxies
    const heartbeat = setInterval(() => {
      raw.write(': heartbeat\n\n');
    }, 25_000);

    const handler = (event: ExecutionEvent) => {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Named SSE event for extraction-ready payloads (EXTRACTION_CONFIRMATION=true path)
    const extractionHandler = (payload: ExtractionReadyPayload) => {
      raw.write(`event: extraction_ready\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    // Named SSE event for granular ingestion stage progress
    const progressHandler = (event: IngestionProgressEvent) => {
      raw.write(`event: ingestion_progress\ndata: ${JSON.stringify(event)}\n\n`);
    };

    executionBus.on('update', handler);
    extractionBus.on('extraction_ready', extractionHandler);
    progressBus.on('ingestion_progress', progressHandler);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      executionBus.off('update', handler);
      extractionBus.off('extraction_ready', extractionHandler);
      progressBus.off('ingestion_progress', progressHandler);
    });

    // Keep the handler open — do not return a response body
    await new Promise<void>((resolve) => {
      req.raw.on('close', resolve);
    });
  });
}
