/**
 * Route handlers — thin delegation to @ai-engine/runtime.
 */

import { readFile, readdir, stat, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  ingestDocuments,
  queryKnowledgeBase,
  listNamespaces,
  nativeQdrantDeleteNamespace,
} from '@ai-engine/runtime';
import { appendEpisodicEntry, truncate } from './memory-util.js';
import { appendChatTurn, hashApiKey } from './chat/chat-history.service.js';
import { filterByAccess, type AuthContext } from './auth.js';
import { processDocument } from './ingestion/ingest-orchestrator.js';
import { resolveVectorStoreConfig } from './ingestion/branch-runner.js';
import { ContextService } from './chat/context.service.js';
import { llmGenerateFn } from './agent-routes.js';
import { emitExecution } from './execution-events.js';
import {
  resolvePolicy,
  executeWithPolicy,
  withProviderEnv,
  type ProviderPolicyConfig,
  type ProviderInfo,
} from './provider-policy.js';

// ---------------------------------------------------------------------------
// Helpers — lightweight file collection (mirrors CLI logic)
// ---------------------------------------------------------------------------

const INGESTABLE_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm',
  '.log', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.ts', '.js', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.rs', '.go', '.rb', '.php', '.sh', '.bash', '.zsh',
  '.css', '.scss', '.less', '.sql', '.r', '.m', '.swift',
  '.kt', '.scala', '.ex', '.exs', '.erl', '.hs', '.lua',
  '.pl', '.pm', '.tex', '.rst', '.adoc', '.org',
  '.pdf',
]);

function isIngestable(filePath: string): boolean {
  return INGESTABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function collectFiles(
  inputPath: string,
): Promise<{ fileName: string; content: string }[]> {
  const resolved = path.resolve(inputPath);
  const inputStat = await stat(resolved);

  if (inputStat.isFile()) {
    if (!isIngestable(resolved)) {
      throw new Error(`Not a recognized file type: ${resolved}`);
    }
    const content = await readFile(resolved, 'utf-8');
    return [{ fileName: path.basename(resolved), content }];
  }

  if (inputStat.isDirectory()) {
    return collectFromDirectory(resolved);
  }

  throw new Error(`Input path is neither a file nor a directory: ${resolved}`);
}

async function collectFromDirectory(
  dirPath: string,
): Promise<{ fileName: string; content: string }[]> {
  const results: { fileName: string; content: string }[] = [];
  const entries = (await readdir(dirPath, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  );

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isFile() && isIngestable(fullPath)) {
      const content = await readFile(fullPath, 'utf-8');
      results.push({ fileName: entry.name, content });
    } else if (entry.isDirectory()) {
      const nested = await collectFromDirectory(fullPath);
      for (const item of nested) {
        results.push({
          fileName: path.join(entry.name, item.fileName),
          content: item.content,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

function safePath(base: string, userPath: string): string {
  const resolved = path.resolve(base, userPath);
  const rel = path.relative(base, resolved);
  if (rel.startsWith('..')) {
    throw new Error('Invalid path — traversal outside data directory');
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Request decoration helper
// ---------------------------------------------------------------------------

function attachProviderInfo(req: FastifyRequest, info: ProviderInfo): void {
  (req as FastifyRequest & { __providerInfo: ProviderInfo }).__providerInfo = info;
}


// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerRoutes(
  app: FastifyInstance,
  workdir: string,
  policyConfig: ProviderPolicyConfig | null,
): void {

  // POST /ingest
  app.post('/ingest', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { path?: string; namespace?: string } | undefined;

    if (!body?.path) {
      return reply.code(400).send({ error: 'Missing required field: path' });
    }

    const namespace = body.namespace ?? 'default';
    const inputPath = safePath(workdir, body.path);
    const storageDir = path.join(workdir, 'namespaces', namespace);

    const documents = await collectFiles(inputPath);

    if (documents.length === 0) {
      return reply.send({ documents: 0, chunks: 0 });
    }

    let ingestResult: unknown;

    if (policyConfig) {
      const policy = resolvePolicy(policyConfig, namespace, 'ingest');
      const { result, usedFallback, provider } = await executeWithPolicy(
        policy,
        () => ingestDocuments({ documents, storageDir, namespace }),
      );
      attachProviderInfo(req, { provider, usedFallback, policySource: policy.source });
      ingestResult = result;
    } else {
      ingestResult = await ingestDocuments({ documents, storageDir, namespace });
    }

    // ── Ingest V2: run context enrichment pipeline after FAISS ──
    if (process.env.INGEST_V2 === 'true') {
      const contextService = new ContextService(workdir);
      for (const doc of documents) {
        try {
          const v2Result = await processDocument(
            namespace,
            doc.fileName,
            doc.content,
            llmGenerateFn,
            contextService,
            // faissIndexFn omitted — FAISS already ran above
          );

          emitExecution({
            executionId: `doc-processed-${namespace}-${doc.fileName}-${Date.now()}`,
            status: 'COMPLETED',
            type: 'document_processed',
            title: doc.fileName,
            message: JSON.stringify({
              fileName: v2Result.fileName,
              type: v2Result.documentType,
              fieldsExtracted: v2Result.fieldsExtracted,
              knowledgeEntries: v2Result.knowledgeEntriesCreated,
              noiseRatio: 0,
            }),
          });

          if (v2Result.fieldsExtracted.length > 0 || v2Result.knowledgeEntriesCreated > 0) {
            emitExecution({
              executionId: `ctx-updated-${namespace}-${doc.fileName}-${Date.now()}`,
              status: 'COMPLETED',
              type: 'context_updated',
              title: namespace,
              message: JSON.stringify({
                fieldsUpdated: v2Result.fieldsExtracted,
                knowledgeAdded: v2Result.knowledgeEntriesCreated,
                source: doc.fileName,
              }),
            });
          }
        } catch (err) {
          console.warn(`[IngestV2] processDocument failed for ${doc.fileName}:`, err);
        }
      }
    }

    return reply.send(ingestResult);
  });

  // POST /query
  app.post('/query', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      question?: string;
      namespace?: string;
      stream?: boolean;
      chatSessionId?: string;
    } | undefined;

    if (!body?.question) {
      return reply.code(400).send({ error: 'Missing required field: question' });
    }

    const namespace = body.namespace ?? 'default';
    const chatSessionId = typeof body.chatSessionId === 'string' ? body.chatSessionId.trim() : undefined;
    const apiKeyHash = hashApiKey((req as FastifyRequest & { auth: AuthContext }).auth.apiKey);
    const storageDir = path.join(workdir, 'namespaces', namespace);
    const vectorStoreConfig = await resolveVectorStoreConfig(workdir, namespace);

    if (body.stream) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // After writeHead, errors must be written as SSE events — Fastify's error
      // handler cannot send a new HTTP response once headers are already sent.
      try {
        if (policyConfig) {
          const policy = resolvePolicy(policyConfig, namespace, 'query');

          // Streaming — no fallback (partial SSE data cannot be retried).
          const promise = withProviderEnv(policy, () =>
            queryKnowledgeBase({
              question: body.question!,
              storageDir,
              namespace,
              stream: true,
              vectorStoreConfig,
              onChunk: (chunk: string) => {
                reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
              },
            }),
          );

          attachProviderInfo(req, {
            provider: policy.provider,
            usedFallback: false,
            policySource: policy.source,
          });

          const result = await promise;
          void appendEpisodicEntry(workdir, namespace, {
            timestamp: new Date().toISOString(),
            source: 'chat-query',
            content: truncate(`Q: ${body.question!} | A: ${result.answer}`, 400),
          });
          if (chatSessionId) {
            void appendChatTurn(workdir, namespace, apiKeyHash, chatSessionId, body.question!, result.answer);
          }
          reply.raw.write(`event: done\ndata: ${JSON.stringify({ answer: result.answer })}\n\n`);
          reply.raw.end();
          return;
        }

        const result = await queryKnowledgeBase({
          question: body.question,
          storageDir,
          namespace,
          stream: true,
          vectorStoreConfig,
          onChunk: (chunk: string) => {
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
          },
        });

        void appendEpisodicEntry(workdir, namespace, {
          timestamp: new Date().toISOString(),
          source: 'chat-query',
          content: truncate(`Q: ${body.question} | A: ${result.answer}`, 400),
        });
        if (chatSessionId) {
          void appendChatTurn(workdir, namespace, apiKeyHash, chatSessionId, body.question, result.answer);
        }
        reply.raw.write(`event: done\ndata: ${JSON.stringify({ answer: result.answer })}\n\n`);
        reply.raw.end();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
        reply.raw.end();
      }
      return;
    }

    if (policyConfig) {
      const policy = resolvePolicy(policyConfig, namespace, 'query');
      const { result, usedFallback, provider } = await executeWithPolicy(
        policy,
        () => queryKnowledgeBase({ question: body.question!, storageDir, namespace, vectorStoreConfig }),
      );

      attachProviderInfo(req, { provider, usedFallback, policySource: policy.source });
      void appendEpisodicEntry(workdir, namespace, {
        timestamp: new Date().toISOString(),
        source: 'chat-query',
        content: truncate(`Q: ${body.question!} | A: ${result.answer}`, 400),
      });
      if (chatSessionId) {
        void appendChatTurn(workdir, namespace, apiKeyHash, chatSessionId, body.question!, result.answer);
      }
      return reply.send(result);
    }

    const result = await queryKnowledgeBase({
      question: body.question,
      storageDir,
      namespace,
      vectorStoreConfig,
    });

    void appendEpisodicEntry(workdir, namespace, {
      timestamp: new Date().toISOString(),
      source: 'chat-query',
      content: truncate(`Q: ${body.question} | A: ${result.answer}`, 400),
    });
    if (chatSessionId) {
      void appendChatTurn(workdir, namespace, apiKeyHash, chatSessionId, body.question, result.answer);
    }
    return reply.send(result);
  });

  // GET /namespaces
  app.get('/namespaces', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = (req as FastifyRequest & { auth: AuthContext }).auth;
    const all = await listNamespaces(workdir);
    const visible = filterByAccess(all, auth.allowedNamespaces);
    return reply.send({ namespaces: visible });
  });

  // POST /namespaces
  app.post('/namespaces', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { name?: string; clientName?: string } | undefined;

    if (!body?.name) {
      return reply.code(400).send({ error: 'Missing required field: name' });
    }

    const name = body.name.trim();

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      return reply.code(400).send({
        error: 'Invalid namespace name. Use lowercase alphanumeric characters and dashes only (e.g. "acme-corp").',
      });
    }

    const nsDir = path.join(workdir, 'namespaces', name);

    // Check for duplicate
    try {
      const s = await stat(nsDir);
      if (s.isDirectory()) {
        return reply.code(409).send({ error: `Namespace "${name}" already exists` });
      }
    } catch {
      // Does not exist — proceed.
    }

    // Create directory structure
    await mkdir(path.join(nsDir, 'uploads'), { recursive: true });
    await mkdir(path.join(nsDir, 'proposals'), { recursive: true });
    await mkdir(path.join(nsDir, 'index'), { recursive: true });

    // Pre-populate context from client memory if clientName is known
    const clientName = body.clientName?.trim();
    let prepopulated: { fieldsCount: number; knowledgeCount: number; engagementCount: number } | null = null;
    if (clientName) {
      try {
        const { ClientMemoryService } = await import('./memory/client-memory.service.js');
        const memService = new ClientMemoryService(workdir);
        const clientSlug = memService.slugify(clientName);
        const prepop = await memService.prepopulate(clientSlug);

        if (prepop.found) {
          const contextService = new ContextService(workdir);
          const now = new Date().toISOString();

          // Convert memory stable fields into RequirementFields
          const incoming: Record<string, { value: unknown; confidence: number; source: 'client_memory'; updatedAt: string; pendingConfirmation: true }> = {};
          for (const [key, field] of Object.entries(prepop.stableFields)) {
            if (field) {
              incoming[key] = {
                value: field.value,
                confidence: field.confidence,
                source: 'client_memory',
                updatedAt: now,
                pendingConfirmation: true,
              };
            }
          }

          if (Object.keys(incoming).length > 0 || prepop.knowledge.length > 0) {
            const context = (await contextService.get(name)) ?? {
              namespace: name,
              requirements: { fields: {}, customFields: {} },
              knowledge: [],
              sources: [],
              version: 0,
              updatedAt: now,
            };
            for (const [key, field] of Object.entries(incoming)) {
              context.requirements.fields[key as keyof typeof context.requirements.fields] =
                field as never;
            }
            // Load knowledge entries from memory
            for (const entry of prepop.knowledge) {
              context.knowledge.push({
                id: entry.id,
                content: entry.content,
                category: entry.category as never,
                importance: 3,
                source: { type: 'manual' },
                extractedAt: now,
                confidence: entry.confidence,
              });
            }
            context.version += 1;
            context.updatedAt = now;
            await contextService.save(name, context);

            prepopulated = {
              fieldsCount: Object.keys(incoming).length,
              knowledgeCount: prepop.knowledge.length,
              engagementCount: prepop.engagementCount,
            };
          }

          // Ensure memory record exists for this client
          if (!(await memService.get(clientSlug))) {
            await memService.createEmpty(clientName);
          }
        }
      } catch (err) {
        app.log.warn({ err }, '[ClientMemory] pre-population failed — namespace created without memory');
      }
    }

    return reply.code(201).send({ namespace: name, ...(prepopulated ? { memoryPrepopulated: prepopulated } : {}) });
  });

  // DELETE /namespaces/:namespace
  app.delete('/namespaces/:namespace', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string };
    const nsDir = path.join(workdir, 'namespaces', namespace);

    try {
      const s = await stat(nsDir);
      if (!s.isDirectory()) {
        return reply.code(404).send({ error: `Namespace "${namespace}" not found` });
      }
    } catch {
      return reply.code(404).send({ error: `Namespace "${namespace}" not found` });
    }

    const vsConfig = await resolveVectorStoreConfig(workdir, namespace);

    await rm(nsDir, { recursive: true, force: true });

    // Clean up all other namespace-keyed data outside the namespaces/ folder
    await Promise.all([
      rm(path.join(workdir, 'chat-history', namespace), { recursive: true, force: true }),
      rm(path.join(workdir, 'assets', 'presentations', namespace), { recursive: true, force: true }),
      rm(path.join(workdir, 'presentations', namespace), { recursive: true, force: true }),
      rm(path.join(workdir, 'data', 'namespaces', namespace), { recursive: true, force: true }),
      rm(path.join(workdir, 'memory', 'namespaces', `${namespace}.json`), { force: true }),
      rm(path.join(workdir, 'exports', namespace), { recursive: true, force: true }),
      rm(path.join(workdir, 'workflows', namespace), { recursive: true, force: true }),
    ]);

    if (vsConfig?.type === 'qdrant') {
      const qdrantUrl = vsConfig.url ?? process.env['QDRANT_URL'] ?? 'http://localhost:6333';
      const qdrantApiKey = vsConfig.apiKey ?? process.env['QDRANT_API_KEY'];
      await nativeQdrantDeleteNamespace(qdrantUrl, namespace, qdrantApiKey);
    }

    return reply.code(200).send({ deleted: namespace });
  });
}
