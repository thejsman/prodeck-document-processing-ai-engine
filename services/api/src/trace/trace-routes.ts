/**
 * GET /chat/trace/:chatSessionId
 *
 * Returns the execution trace for a chat workflow session.
 * The trace is only populated when the server is started with
 * DEBUG_TRACE=true — otherwise an empty event list is returned with
 * a note explaining how to enable tracing.
 */

import type { FastifyInstance } from 'fastify';
import { getTrace, isTraceEnabled } from './trace-store.js';

export function registerTraceRoutes(app: FastifyInstance): void {
  app.get('/chat/trace/:chatSessionId', async (req, reply) => {
    const { chatSessionId } = req.params as { chatSessionId: string };

    if (!isTraceEnabled()) {
      return reply.send({
        events: [],
        note: 'Set DEBUG_TRACE=true to enable execution tracing.',
      });
    }

    return reply.send({ events: getTrace(chatSessionId) });
  });
}
