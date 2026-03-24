/**
 * Chat routes — POST /chat/message
 *
 * Accepts an incoming chat message, runs it through the ChatOrchestrator,
 * and returns either a streaming SSE response or a plain JSON response.
 *
 * SSE event stream format (when stream=true):
 *
 *   event: phase
 *   data: {"phase":"Analyzing RFP"}
 *
 *   data: "token chunk text..."     ← content tokens (default event type)
 *
 *   event: done
 *   data: {"message":"Your proposal draft is ready.","actions":{...}}
 *
 *   event: error
 *   data: {"error":"..."}
 *
 * Non-streaming response (when stream=false or absent):
 *   { message: string, actions?: Record<string, string> }
 *
 * Auth: inherits the global authHook applied in server.ts.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ChatOrchestrator } from './chat/chat-orchestrator.js';
import {
  chatSessionBus,
  type ChatSessionEvent,
} from './chat/chat-session-bus.js';
import type { ProviderPolicyConfig } from './provider-policy.js';

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerChatRoutes(
  app: FastifyInstance,
  workdir: string,
  policyConfig: ProviderPolicyConfig | null,
): void {

  // POST /chat/message
  app.post('/chat/message', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      message?: unknown;
      namespace?: unknown;
      chatSessionId?: unknown;
      stream?: unknown;
    } | undefined;

    if (!body?.message || typeof body.message !== 'string' || !body.message.trim()) {
      return reply.code(400).send({ error: 'Missing required field: message' });
    }

    if (!body?.namespace || typeof body.namespace !== 'string' || !body.namespace.trim()) {
      return reply.code(400).send({ error: 'Missing required field: namespace' });
    }

    if (
      !body?.chatSessionId ||
      typeof body.chatSessionId !== 'string' ||
      !body.chatSessionId.trim()
    ) {
      return reply.code(400).send({ error: 'Missing required field: chatSessionId' });
    }

    const message = body.message.trim();
    const namespace = body.namespace.trim();
    const chatSessionId = body.chatSessionId.trim();
    const stream = body.stream === true;

    const orchestrator = new ChatOrchestrator(workdir, policyConfig);

    if (stream) {
      // ── Streaming SSE response ──────────────────────────────────
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      try {
        const result = await orchestrator.processMessage({
          message,
          namespace,
          chatSessionId,

          // STEP 6 — emit phase events
          onPhase: (phase: string) => {
            reply.raw.write(`event: phase\ndata: ${JSON.stringify({ phase })}\n\n`);
          },

          // STEP 6 — stream content tokens
          onChunk: (chunk: string) => {
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
          },
        });

        // STEP 7 — final done event with message + actions
        reply.raw.write(
          `event: done\ndata: ${JSON.stringify({
            message: result.message,
            actions: result.actions ?? {},
          })}\n\n`,
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({ error: errorMessage })}\n\n`,
        );
      } finally {
        reply.raw.end();
      }

      return;
    }

    // ── Non-streaming JSON response ─────────────────────────────
    try {
      const result = await orchestrator.processMessage({
        message,
        namespace,
        chatSessionId,
      });
      return reply.send(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Chat orchestration failed: ${errorMessage}` });
    }
  });

  // ── GET /chat/session/:chatSessionId/stream ────────────────────
  //
  // Long-lived SSE channel for a single chat session.  The client connects
  // once and receives events pushed by resumeWorkflow() or any other
  // server-initiated action for that session.
  //
  // SSE event format mirrors POST /chat/message stream:
  //   event: phase   → { phase: string }
  //   data: (default) → chunk string
  //   event: done    → { message, actions }
  //   event: error   → { error }
  //   event: system  → { message }   (e.g. "Ingestion failed")
  //
  app.get(
    '/chat/session/:chatSessionId/stream',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { chatSessionId } = req.params as { chatSessionId: string };

      if (!chatSessionId?.trim()) {
        return reply.code(400).send({ error: 'Missing chatSessionId param' });
      }

      const raw = reply.raw;
      raw.setHeader('Content-Type', 'text/event-stream');
      raw.setHeader('Cache-Control', 'no-cache');
      raw.setHeader('Connection', 'keep-alive');
      raw.setHeader('X-Accel-Buffering', 'no');
      raw.flushHeaders();

      // Heartbeat every 25 s to keep proxies from dropping the connection
      const heartbeat = setInterval(() => {
        raw.write(': heartbeat\n\n');
      }, 25_000);

      const handler = (event: ChatSessionEvent) => {
        switch (event.type) {
          case 'phase':
            raw.write(`event: phase\ndata: ${JSON.stringify({ phase: event.phase })}\n\n`);
            break;
          case 'chunk':
            raw.write(`data: ${JSON.stringify(event.chunk)}\n\n`);
            break;
          case 'done':
            raw.write(
              `event: done\ndata: ${JSON.stringify({
                message: event.message ?? '',
                actions: event.actions ?? {},
              })}\n\n`,
            );
            break;
          case 'system':
            raw.write(
              `event: system\ndata: ${JSON.stringify({ message: event.message ?? '' })}\n\n`,
            );
            break;
          case 'error':
            raw.write(
              `event: error\ndata: ${JSON.stringify({ error: event.error ?? 'Unknown error' })}\n\n`,
            );
            break;
          case 'tool_progress':
            raw.write(
              `event: tool_progress\ndata: ${JSON.stringify(event.toolProgress ?? {})}\n\n`,
            );
            break;
          case 'namespace_insight':
            raw.write(
              `event: namespace_insight\ndata: ${JSON.stringify({ suggestions: event.suggestions ?? [] })}\n\n`,
            );
            break;
        }
      };

      chatSessionBus.on(chatSessionId, handler);

      req.raw.on('close', () => {
        clearInterval(heartbeat);
        chatSessionBus.off(chatSessionId, handler);
      });

      await new Promise<void>((resolve) => {
        req.raw.on('close', resolve);
      });
    },
  );
}
