/**
 * GET /ai-executions/stream
 *
 * Server-Sent Events endpoint. Clients connect once and receive real-time
 * execution status updates pushed by the in-process executionBus.
 */

import type { FastifyInstance } from 'fastify';
import { executionBus, extractionBus, progressBus, getExecution, type ExecutionEvent, type ExtractionReadyPayload, type IngestionProgressEvent } from './execution-events.js';

export function registerExecutionStreamRoutes(app: FastifyInstance): void {
  // ── Polling fallback — lets the frontend poller catch up on missed SSE events
  app.get('/ai-executions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = getExecution(id);
    if (!event) return reply.code(404).send({ error: 'Not found' });
    return reply.send({ id: event.executionId, status: event.status, type: event.type ?? null });
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

    raw.setHeader('Content-Type', 'text/event-stream');
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
