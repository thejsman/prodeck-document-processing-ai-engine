/**
 * GET /ai-executions/stream
 *
 * Server-Sent Events endpoint. Clients connect once and receive real-time
 * execution status updates pushed by the in-process executionBus.
 */

import type { FastifyInstance } from 'fastify';
import { executionBus, extractionBus, type ExecutionEvent, type ExtractionReadyPayload } from './execution-events.js';

export function registerExecutionStreamRoutes(app: FastifyInstance): void {
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

    executionBus.on('update', handler);
    extractionBus.on('extraction_ready', extractionHandler);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      executionBus.off('update', handler);
      extractionBus.off('extraction_ready', extractionHandler);
    });

    // Keep the handler open — do not return a response body
    await new Promise<void>((resolve) => {
      req.raw.on('close', resolve);
    });
  });
}
