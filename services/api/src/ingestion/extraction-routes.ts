/**
 * Extraction confirmation routes — EXTRACTION_CONFIRMATION=true path.
 *
 * GET  /namespaces/:namespace/extractions/pending          → list pending extractions
 * POST /namespaces/:namespace/extractions/:cardId/confirm  → write fields to context.json
 * POST /namespaces/:namespace/extractions/:cardId/discard  → discard pending extraction
 * POST /namespaces/:namespace/extractions/:cardId/reclassify → re-enqueue with new classification
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PendingExtractionService } from './pending-extraction.service.js';
import { ContextService } from '../chat/context.service.js';
import { computeBriefReadiness } from '../chat/brief-readiness.js';
import { ingestionQueue } from './ingestion-queue.js';
import type { RequirementKey, RequirementField, DocumentClassification } from '../chat/context.types.js';
import { isWildcard, type AuthContext } from '../auth.js';

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

export function registerExtractionRoutes(
  app: FastifyInstance,
  workdir: string,
): void {
  const pendingService = new PendingExtractionService(workdir);
  const contextService = new ContextService(workdir);

  // GET /namespaces/:namespace/extractions/pending
  app.get(
    '/namespaces/:namespace/extractions/pending',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { namespace } = req.params as { namespace: string };
      const auth = getAuth(req);
      if (!checkNamespaceAccess(auth, namespace, reply)) return;

      const pending = await pendingService.listPending(namespace);
      return reply.send({ pending });
    },
  );

  // POST /namespaces/:namespace/extractions/:cardId/confirm
  app.post(
    '/namespaces/:namespace/extractions/:cardId/confirm',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { namespace, cardId } = req.params as { namespace: string; cardId: string };
      const auth = getAuth(req);
      if (!checkNamespaceAccess(auth, namespace, reply)) return;

      const record = await pendingService.get(namespace, cardId);
      if (!record) {
        return reply.code(404).send({ error: `Pending extraction not found: ${cardId}` });
      }
      if (record.status !== 'pending') {
        return reply.code(409).send({ error: `Extraction already ${record.status}` });
      }

      const body = req.body as {
        overrides?: Record<RequirementKey, { value: string }>;
        resolvedConflicts?: Record<RequirementKey, string>;
      };

      // Apply user overrides and resolved conflicts on top of extracted fields
      const finalFields: Partial<Record<RequirementKey, RequirementField<unknown>>> = { ...record.fields };

      if (body?.overrides) {
        for (const [rawKey, override] of Object.entries(body.overrides)) {
          const key = rawKey as RequirementKey;
          finalFields[key] = {
            value: override.value,
            confidence: 1.0,
            source: 'user',
            updatedAt: new Date().toISOString(),
            sourceFile: record.fileName,
          };
        }
      }

      if (body?.resolvedConflicts) {
        for (const [rawKey, chosenValue] of Object.entries(body.resolvedConflicts)) {
          const key = rawKey as RequirementKey;
          finalFields[key] = {
            value: chosenValue,
            confidence: 1.0,
            source: 'user',
            updatedAt: new Date().toISOString(),
            sourceFile: record.fileName,
          };
        }
      }

      const confirmedAt = new Date().toISOString();

      // Build context source record
      const contextSource = {
        fileName: record.fileName,
        documentType: 'generic' as const,
        extractedAt: record.extractedAt,
        fieldsExtracted: Object.keys(finalFields) as RequirementKey[],
        knowledgeEntriesCreated: record.knowledgeEntries?.length ?? 0,
        preprocessConfidence: 1.0,
        classification: record.classification,
        confirmedAt,
        confirmationCardId: cardId,
      };

      // Write to context.json
      const context = await contextService.mergeRequirements(namespace, finalFields, contextSource);

      if (record.knowledgeEntries && record.knowledgeEntries.length > 0) {
        await contextService.mergeKnowledge(namespace, record.knowledgeEntries);
      }

      if (record.fields) {
        // meetingSummary — not in PendingExtraction by default, skip
      }

      await pendingService.markConfirmed(namespace, cardId);

      const readiness = computeBriefReadiness(context);
      const fieldsWritten = Object.keys(finalFields) as RequirementKey[];

      return reply.send({ fieldsWritten, context, readiness });
    },
  );

  // POST /namespaces/:namespace/extractions/:cardId/discard
  app.post(
    '/namespaces/:namespace/extractions/:cardId/discard',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { namespace, cardId } = req.params as { namespace: string; cardId: string };
      const auth = getAuth(req);
      if (!checkNamespaceAccess(auth, namespace, reply)) return;

      const record = await pendingService.get(namespace, cardId);
      if (!record) {
        return reply.code(404).send({ error: `Pending extraction not found: ${cardId}` });
      }

      await pendingService.markDiscarded(namespace, cardId);
      return reply.send({ discarded: true });
    },
  );

  // POST /namespaces/:namespace/extractions/:cardId/reclassify
  app.post(
    '/namespaces/:namespace/extractions/:cardId/reclassify',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { namespace, cardId } = req.params as { namespace: string; cardId: string };
      const auth = getAuth(req);
      if (!checkNamespaceAccess(auth, namespace, reply)) return;

      const body = req.body as { newClassification: DocumentClassification };
      if (!body?.newClassification) {
        return reply.code(400).send({ error: 'newClassification is required' });
      }

      const record = await pendingService.get(namespace, cardId);
      if (!record) {
        return reply.code(404).send({ error: `Pending extraction not found: ${cardId}` });
      }

      // Discard old pending record
      await pendingService.markDiscarded(namespace, cardId);

      // Re-enqueue with new classification — a new extraction_ready event will fire
      ingestionQueue.enqueue({
        namespace,
        fileName: record.fileName,
        classification: body.newClassification,
      });

      return reply.send({ newCardId: 'pending' });
    },
  );
}
