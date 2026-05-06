import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ClientMemoryService } from './memory/client-memory.service.js';
import { ContextService } from './chat/context.service.js';
import type { ClientKnowledgeEntry, StableRequirementKey } from './memory/client-memory.types.js';

export function registerClientMemoryRoutes(
  app: FastifyInstance,
  workdir: string,
): void {
  const service = new ClientMemoryService(workdir);
  const contextService = new ContextService(workdir);

  // GET /clients
  app.get('/clients', async (_req: FastifyRequest, reply: FastifyReply) => {
    const clients = await service.list();
    return reply.send({ clients });
  });

  // GET /clients/:clientSlug
  app.get(
    '/clients/:clientSlug',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { clientSlug } = req.params as { clientSlug: string };
      const memory = await service.get(clientSlug);
      if (!memory) return reply.code(404).send({ error: 'Client not found' });
      return reply.send({ memory });
    },
  );

  // GET /clients/:clientSlug/memory/prepopulate
  app.get(
    '/clients/:clientSlug/memory/prepopulate',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { clientSlug } = req.params as { clientSlug: string };
      const result = await service.prepopulate(clientSlug);
      return reply.send(result);
    },
  );

  // POST /clients/:clientSlug/memory/fields
  app.post(
    '/clients/:clientSlug/memory/fields',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { clientSlug } = req.params as { clientSlug: string };
      const body = req.body as { key?: string; value?: unknown } | undefined;

      if (!body?.key || body.value === undefined) {
        return reply.code(400).send({ error: 'Missing required fields: key, value' });
      }

      const validKeys: StableRequirementKey[] = ['clientName', 'clientIndustry', 'contactName'];
      if (!validKeys.includes(body.key as StableRequirementKey)) {
        return reply
          .code(400)
          .send({ error: `key must be one of: ${validKeys.join(', ')}` });
      }

      await service.updateField(
        clientSlug,
        body.key as StableRequirementKey,
        body.value as string | string[],
      );

      const memory = await service.get(clientSlug);
      return reply.send({ memory });
    },
  );

  // POST /clients/:clientSlug/memory/knowledge
  app.post(
    '/clients/:clientSlug/memory/knowledge',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { clientSlug } = req.params as { clientSlug: string };
      const body = req.body as {
        content?: string;
        category?: string;
        confidence?: number;
      } | undefined;

      if (!body?.content || !body.category) {
        return reply.code(400).send({ error: 'Missing required fields: content, category' });
      }

      const validCategories: ClientKnowledgeEntry['category'][] = [
        'preference', 'constraint', 'relationship', 'context',
      ];
      if (!validCategories.includes(body.category as ClientKnowledgeEntry['category'])) {
        return reply.code(400).send({
          error: `category must be one of: ${validCategories.join(', ')}`,
        });
      }

      const entry = await service.addKnowledge(
        clientSlug,
        body.content,
        body.category as ClientKnowledgeEntry['category'],
        body.confidence,
      );
      return reply.code(201).send({ entry });
    },
  );

  // PUT /clients/:clientSlug/memory/knowledge/:id
  app.put(
    '/clients/:clientSlug/memory/knowledge/:id',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { clientSlug, id } = req.params as { clientSlug: string; id: string };
      const body = req.body as { content?: string } | undefined;

      if (!body?.content) {
        return reply.code(400).send({ error: 'Missing required field: content' });
      }

      await service.updateKnowledge(clientSlug, id, body.content);
      return reply.send({ ok: true });
    },
  );

  // DELETE /clients/:clientSlug/memory/knowledge/:id
  app.delete(
    '/clients/:clientSlug/memory/knowledge/:id',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { clientSlug, id } = req.params as { clientSlug: string; id: string };
      await service.removeKnowledge(clientSlug, id);
      return reply.send({ ok: true });
    },
  );

  // POST /clients/:clientSlug/memory/stakeholders
  app.post(
    '/clients/:clientSlug/memory/stakeholders',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { clientSlug } = req.params as { clientSlug: string };
      const body = req.body as {
        name?: string;
        role?: string;
        email?: string;
        notes?: string;
      } | undefined;

      if (!body?.name || !body.role) {
        return reply.code(400).send({ error: 'Missing required fields: name, role' });
      }

      const record = await service.addStakeholder(clientSlug, {
        name: body.name,
        role: body.role,
        email: body.email,
        notes: body.notes,
      });
      return reply.code(201).send({ record });
    },
  );

  // PUT /clients/:clientSlug/memory/stakeholders/:id
  app.put(
    '/clients/:clientSlug/memory/stakeholders/:id',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { clientSlug, id } = req.params as { clientSlug: string; id: string };
      const body = req.body as {
        name?: string;
        role?: string;
        email?: string;
        notes?: string;
      } | undefined;

      await service.updateStakeholder(clientSlug, id, body ?? {});
      return reply.send({ ok: true });
    },
  );

  // DELETE /clients/:clientSlug/memory/stakeholders/:id
  app.delete(
    '/clients/:clientSlug/memory/stakeholders/:id',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { clientSlug, id } = req.params as { clientSlug: string; id: string };
      await service.removeStakeholder(clientSlug, id);
      return reply.send({ ok: true });
    },
  );

  // GET /clients/:clientSlug/memory/conflicts
  app.get(
    '/clients/:clientSlug/memory/conflicts',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { clientSlug } = req.params as { clientSlug: string };
      const conflicts = await service.getConflicts(clientSlug);
      return reply.send({ conflicts });
    },
  );

  // POST /clients/:clientSlug/memory/conflicts/:id/resolve
  app.post(
    '/clients/:clientSlug/memory/conflicts/:id/resolve',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { clientSlug, id } = req.params as { clientSlug: string; id: string };
      const body = req.body as { resolution?: string } | undefined;

      const valid = ['keep_old', 'use_new', 'keep_both', 'defer'];
      if (!body?.resolution || !valid.includes(body.resolution)) {
        return reply.code(400).send({
          error: `resolution must be one of: ${valid.join(', ')}`,
        });
      }

      await service.resolveConflict(
        clientSlug,
        id,
        body.resolution as 'keep_old' | 'use_new' | 'keep_both' | 'defer',
      );
      return reply.send({ ok: true });
    },
  );

  // POST /namespaces/:namespace/memory/distill (internal — called by proposal status change)
  app.post(
    '/namespaces/:namespace/memory/distill',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { namespace } = req.params as { namespace: string };
      const context = await contextService.get(namespace);
      if (!context) {
        return reply.code(404).send({ error: 'Namespace context not found' });
      }

      const clientNameField = context.requirements.fields['clientName'];
      if (!clientNameField) {
        return reply.code(400).send({ error: 'clientName not set in context' });
      }

      const result = await service.distill(namespace, context);
      return reply.send(result);
    },
  );
}
