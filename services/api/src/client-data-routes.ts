// services/api/src/client-data-routes.ts
//
// API routes for the client data collection module.
// These are ADDITIVE routes — they don't modify or replace any existing endpoints.
//
// Endpoints:
//   GET  /namespaces/:namespace/collection/status   — collection progress + missing fields
//   GET  /namespaces/:namespace/collection/schema    — active industry schema for this namespace
//   POST /namespaces/:namespace/collection/scrape    — trigger URL scraping
//   POST /namespaces/:namespace/collection/custom-fields — update industry-specific custom fields
//   GET  /industries                                 — list all available industry modules
//   GET  /engagement-types                           — list all engagement type modifiers

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ContextService } from './chat/context.service.js';
import { assessCollectionStatus, buildProgressSummary } from './chat/client-data-handler.js';
import {
  getAllIndustries,
  getAllEngagementTypes,
  getActiveSchema,
  computeIndustryCompleteness,
  getNextQuestions,
} from './chat/industry-schema.js';
import { scrapeUrl } from './chat/url-scraper.service.js';
import type { RequirementField } from './chat/context.types.js';
import { isWildcard, type AuthContext } from './auth.js';

// ---------------------------------------------------------------------------
// Helper: namespace access check (reuses existing auth pattern)
// ---------------------------------------------------------------------------

function checkAccess(auth: AuthContext | undefined, namespace: string): boolean {
  if (!auth) return false;
  return isWildcard(auth.allowedNamespaces) || auth.allowedNamespaces.includes(namespace);
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function clientDataRoutes(app: FastifyInstance): Promise<void> {
  const workdir = process.env.WORKDIR ?? './workdir';
  const contextService = new ContextService(workdir);

  // -----------------------------------------------------------------------
  // GET /namespaces/:namespace/collection/status
  // Returns current collection progress, missing fields, and readiness state.
  // -----------------------------------------------------------------------
  app.get(
    '/namespaces/:namespace/collection/status',
    async (
      request: FastifyRequest<{ Params: { namespace: string } }>,
      reply: FastifyReply,
    ) => {
      const { namespace } = request.params;
      const auth = (request as any).auth as AuthContext | undefined;
      if (!checkAccess(auth, namespace)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const context = await contextService.get(namespace);
      const { status, summary } = buildProgressSummary(context);

      // Get next questions to ask
      const industryId = context?.industryContext?.industryId ?? null;
      const engagementType = context?.engagementType ?? null;
      const customFieldValues: Record<string, unknown> = {};
      if (context?.requirements?.customFields) {
        for (const [key, field] of Object.entries(context.requirements.customFields)) {
          if (field?.value) customFieldValues[key] = field.value;
        }
      }
      const nextQuestions = getNextQuestions(industryId, engagementType, customFieldValues, 3);

      return reply.send({
        ...status,
        summary,
        documentCount: (context?.sources ?? []).length,
        nextQuestions: nextQuestions.map(f => ({
          key: f.key,
          label: f.label,
          question: f.question,
          priority: f.priority,
          category: f.category,
        })),
        brandingKit: context?.brandingKit ?? null,
        industryContext: context?.industryContext ?? null,
      });
    },
  );

  // -----------------------------------------------------------------------
  // GET /namespaces/:namespace/collection/schema
  // Returns the active industry schema (base + industry + engagement fields).
  // -----------------------------------------------------------------------
  app.get(
    '/namespaces/:namespace/collection/schema',
    async (
      request: FastifyRequest<{ Params: { namespace: string } }>,
      reply: FastifyReply,
    ) => {
      const { namespace } = request.params;
      const auth = (request as any).auth as AuthContext | undefined;
      if (!checkAccess(auth, namespace)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const context = await contextService.get(namespace);
      const industryId = context?.industryContext?.industryId ?? null;
      const engagementType = context?.engagementType ?? null;

      const schema = getActiveSchema(industryId, engagementType);

      return reply.send({
        industryId,
        industryName: schema.industryModule?.name ?? null,
        engagementType,
        engagementLabel: schema.engagementModifier?.label ?? null,
        defaultTone: schema.industryModule?.defaultTone ?? null,
        brandingHints: schema.industryModule?.brandingHints ?? null,
        fields: schema.allFields.map(f => ({
          key: f.key,
          label: f.label,
          priority: f.priority,
          category: f.category,
          valueType: f.valueType,
          filled: !!(context?.requirements?.customFields?.[f.key]?.value),
          value: context?.requirements?.customFields?.[f.key]?.value ?? null,
          confidence: context?.requirements?.customFields?.[f.key]?.confidence ?? null,
        })),
        emphasizedSections: schema.engagementModifier?.emphasizedSections ?? [],
      });
    },
  );

  // -----------------------------------------------------------------------
  // POST /namespaces/:namespace/collection/scrape
  // Triggers URL scraping and stores results in context.
  // Body: { url: string }
  // -----------------------------------------------------------------------
  app.post(
    '/namespaces/:namespace/collection/scrape',
    async (
      request: FastifyRequest<{
        Params: { namespace: string };
        Body: { url: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { namespace } = request.params;
      const auth = (request as any).auth as AuthContext | undefined;
      if (!checkAccess(auth, namespace)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const { url } = request.body ?? {};
      if (!url || typeof url !== 'string') {
        return reply.code(400).send({ error: 'url is required' });
      }

      try {
        // Scrape without LLM for the REST endpoint (LLM extraction happens via chat)
        const result = await scrapeUrl(url);

        // Merge results into context
        if (Object.keys(result.fields).length > 0) {
          await contextService.mergeRequirements(namespace, result.fields);
        }
        if (Object.keys(result.customFields).length > 0) {
          await contextService.mergeCustomFields(namespace, result.customFields);
        }
        if (result.brandingKit && (result.brandingKit.colors.length > 0 || result.brandingKit.typography.length > 0)) {
          await contextService.setBrandingKit(namespace, result.brandingKit);
        }

        // Trigger industry detection
        await contextService.detectAndSetIndustry(namespace);

        // Return results
        const context = await contextService.get(namespace);
        const { status } = buildProgressSummary(context);

        return reply.send({
          success: true,
          fieldsExtracted: Object.keys(result.fields).length,
          customFieldsExtracted: Object.keys(result.customFields).length,
          brandingExtracted: !!result.brandingKit && result.brandingKit.colors.length > 0,
          pagesScraped: result.pagesScraped,
          warnings: result.warnings,
          collectionStatus: status,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: `Scraping failed: ${msg}` });
      }
    },
  );

  // -----------------------------------------------------------------------
  // POST /namespaces/:namespace/collection/custom-fields
  // Updates industry-specific custom fields from the right panel UI.
  // Body: { fields: Record<string, string | string[]> }
  // -----------------------------------------------------------------------
  app.post(
    '/namespaces/:namespace/collection/custom-fields',
    async (
      request: FastifyRequest<{
        Params: { namespace: string };
        Body: { fields: Record<string, unknown> };
      }>,
      reply: FastifyReply,
    ) => {
      const { namespace } = request.params;
      const auth = (request as any).auth as AuthContext | undefined;
      if (!checkAccess(auth, namespace)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const { fields } = request.body ?? {};
      if (!fields || typeof fields !== 'object') {
        return reply.code(400).send({ error: 'fields object is required' });
      }

      const now = new Date().toISOString();
      const incoming: Record<string, RequirementField<string>> = {};

      for (const [key, value] of Object.entries(fields)) {
        if (value === null || value === undefined) continue;
        const strValue = Array.isArray(value) ? value.join(', ') : String(value);
        incoming[key] = {
          value: strValue,
          confidence: 1.0,
          source: 'user',
          updatedAt: now,
        };
      }

      const context = await contextService.mergeCustomFields(namespace, incoming);
      const { status } = buildProgressSummary(context);

      return reply.send({
        success: true,
        fieldsUpdated: Object.keys(incoming).length,
        collectionStatus: status,
      });
    },
  );

  // -----------------------------------------------------------------------
  // GET /industries
  // Lists all available industry modules (for dropdown selection).
  // -----------------------------------------------------------------------
  app.get('/industries', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ industries: getAllIndustries() });
  });

  // -----------------------------------------------------------------------
  // GET /engagement-types
  // Lists all engagement type modifiers.
  // -----------------------------------------------------------------------
  app.get('/engagement-types', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ engagementTypes: getAllEngagementTypes() });
  });
}
