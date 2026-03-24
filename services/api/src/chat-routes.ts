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
}
