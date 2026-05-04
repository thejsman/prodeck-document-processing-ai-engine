/**
 * Context routes — Brief Panel API.
 *
 * GET  /namespaces/:namespace/context/readiness      → BriefReadiness
 * POST /namespaces/:namespace/context/confirm        → confirm extracted fields
 * PATCH /namespaces/:namespace/context/fields/:key   → update a single field
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ContextService } from './chat/context.service.js';
import { computeBriefReadiness } from './chat/brief-readiness.js';
import type { RequirementKey } from './chat/context.types.js';
import { isWildcard, type AuthContext } from './auth.js';

function getAuth(req: FastifyRequest): AuthContext {
  return (req as FastifyRequest & { auth: AuthContext }).auth;
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

export function registerContextRoutes(
  app: FastifyInstance,
  workdir: string,
): void {
  const contextService = new ContextService(workdir);

  // GET /namespaces/:namespace/context/readiness
  app.get(
    '/namespaces/:namespace/context/readiness',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { namespace } = req.params as { namespace: string };
      const auth = getAuth(req);
      if (!checkNamespaceAccess(auth, namespace, reply)) return;

      const context = await contextService.get(namespace);
      const readiness = computeBriefReadiness(context);
      return reply.send({ readiness, context });
    },
  );

  // POST /namespaces/:namespace/context/confirm
  app.post(
    '/namespaces/:namespace/context/confirm',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { namespace } = req.params as { namespace: string };
      const auth = getAuth(req);
      if (!checkNamespaceAccess(auth, namespace, reply)) return;

      const body = req.body as {
        fields?: Partial<Record<RequirementKey, { value: unknown; confidence: number; source: 'user' | 'document' | 'inferred' }>>;
        documentId?: string;
      };

      if (!body?.fields || Object.keys(body.fields).length === 0) {
        return reply.code(400).send({ error: 'fields is required' });
      }

      const context = await contextService.confirmFields(
        namespace,
        body.fields,
        body.documentId,
      );
      const readiness = computeBriefReadiness(context);
      return reply.send({ context, readiness });
    },
  );

  // PATCH /namespaces/:namespace/context/fields/:key
  app.patch(
    '/namespaces/:namespace/context/fields/:key',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { namespace, key } = req.params as { namespace: string; key: string };
      const auth = getAuth(req);
      if (!checkNamespaceAccess(auth, namespace, reply)) return;

      const body = req.body as { value?: unknown; source?: 'user' | 'document' | 'inferred' };

      if (body?.value === undefined) {
        return reply.code(400).send({ error: 'value is required' });
      }

      const validKeys: RequirementKey[] = [
        'clientName', 'clientIndustry', 'projectType', 'budget', 'timeline',
        'teamSize', 'technicalStack', 'keyObjectives', 'constraints',
        'deliverables', 'stakeholders', 'contactName',
      ];
      if (!validKeys.includes(key as RequirementKey)) {
        return reply.code(400).send({ error: `Invalid field key: ${key}` });
      }

      const context = await contextService.updateField(
        namespace,
        key as RequirementKey,
        body.value,
        body.source ?? 'user',
      );
      const readiness = computeBriefReadiness(context);
      const field = context.requirements.fields[key as RequirementKey];
      return reply.send({ field, readiness });
    },
  );
}
