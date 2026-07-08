/**
 * Fastify server — wires auth, audit, and route handlers.
 */

import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import multipart from '@fastify/multipart';
import { readFile as fsReadFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { authHook, loadApiKeys } from './auth.js';
import { auditHook, setAuditLogPath } from './audit.js';
import {
  logError,
  setErrorLogPath,
  namespaceFromReq,
  userInputFromReq,
} from './error-log.js';
import { registerErrorLogRoutes, ERROR_LOG_ROUTE } from './error-log-routes.js';
import { registerRoutes } from './routes.js';
import { registerProposalRoutes } from './proposal-routes.js';
import { registerMemoryRoutes } from './memory-routes.js';
import { registerUploadRoutes } from './upload-routes.js';
import { registerPresentationRoutes } from './presentation/presentation-routes.js';
import { registerClassicPresentationRoutes } from './presentation/presentation-classic-routes.js';
import { registerKnowledgeRoutes } from './ingestion/knowledge-routes.js';
import { registerConfigRoutes } from './config-routes.js';
import { registerTemplateAgentRoutes } from './template-agent-routes.js';
import { registerAgentRoutes, llmGenerateFn } from './agent-routes.js';
import { registerAssetRoutes } from './asset-routes.js';
import { registerStreamUploadRoutes } from './ingestion/stream-upload-routes.js';
import { registerImageRoutes } from './image-routes.js';
import { registerAnalyzeImageRoutes } from './analyze-image-routes.js';
import { registerPluginRoutes } from './plugin-routes.js';
import { registerSkillRoutes } from './skills/skill-routes.js';
import { registerDesignSkillRoutes } from './skills/design-skill-routes.js';
import { registerChatRoutes } from './chat-routes.js';
import { registerClientMemoryRoutes } from './client-memory-routes.js';
import { registerContextRoutes } from './context-routes.js';
import { clientDataRoutes } from './client-data-routes.js';
import { registerSuperClientRoutes } from './super-client-routes.js';
import { registerOrgContextRoutes } from './inspiration/org-context-routes.js';
import { registerPdfExportRoutes } from './pdf-export-routes.js';
import { registerDocumentRoutes } from './documents/document-routes.js';

import { registerExtractionRoutes } from './ingestion/extraction-routes.js';
import { registerTraceRoutes } from './trace/trace-routes.js';
import { registerExecutionStreamRoutes } from './execution-stream-routes.js';
import {
  workflowEventBus,
  type IngestionCompletedEvent,
  type IngestionFailedEvent,
} from './workflows/workflow-event-bus.js';
import {
  resumeWorkflowsForIngestion,
  handleIngestionFailure,
} from './workflows/workflow-resume.service.js';
import { ChatOrchestrator } from './chat/chat-orchestrator.js';
import { ingestionQueue } from './ingestion/ingestion-queue.js';
import { recoverInterruptedJobs } from './ingestion/ingestion-service.js';
import { loadProviderPolicy, type ProviderPolicyConfig } from './provider-policy.js';
import { PresenterPluginRegistry, discoverPresenterPlugins } from '@ai-engine/runtime';

export interface ServerOptions {
  readonly port: number;
  readonly host: string;
  readonly workdir: string;
  readonly apiKeysPath: string;
  readonly auditLogPath: string;
  readonly errorLogPath: string;
  readonly providerPolicyPath?: string;
  /** Directory containing presenter plugin subdirectories (e.g. plugins/presenter-*) */
  readonly pluginsDir?: string;
}

export async function createServer(opts: ServerOptions) {
  await loadApiKeys(opts.apiKeysPath);
  setAuditLogPath(opts.auditLogPath);
  setErrorLogPath(opts.errorLogPath);

  // ── Presenter plugin discovery ────────────────────────────────
  const presenterRegistry = new PresenterPluginRegistry();
  if (opts.pluginsDir) {
    try {
      await discoverPresenterPlugins(opts.pluginsDir, presenterRegistry);
    } catch (err) {
      // Non-fatal: log and continue with empty registry
      await logError({ process: 'startup:plugin-discovery', error: err });
      process.stderr.write(`[plugins] Discovery failed: ${String(err)}\n`);
    }
  }

  let policyConfig: ProviderPolicyConfig | null = null;
  if (opts.providerPolicyPath) {
    policyConfig = await loadProviderPolicy(opts.providerPolicyPath);
  }

  const app = Fastify({ logger: true, bodyLimit: 210 * 1024 * 1024 }); // 210 MB — covers 200 MB file uploads + multipart overhead

  // ── Multipart support (file uploads) ─────────────────────────
  await app.register(multipart, {
    limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB per file
  });

  // ── Health check (no auth required) ──────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // ── Auth + audit hooks (everything except /health and public image assets) ───────────
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    // Locally saved presentation images are public (no expiry, no secrets)
    if (req.url.startsWith('/presentation-images/')) return;
    // Exported HTML files — ephemeral, browser-downloaded via plain <a> tag (no auth headers)
    if (req.method === 'GET' && req.url.startsWith('/exports/')) return;
    // Hidden error-log viewer — guarded only by its obscure path (no API key)
    if (req.method === 'GET' && req.url.startsWith(ERROR_LOG_ROUTE)) return;
    // Read-only microsite view routes — public so clients can preview without an API key
    if (req.method === 'GET' && /\/presentations\/[^/]+\/[^/]+\/(microsite|site-html|publish-meta)(\?.*)?$/.test(req.url)) return;
    await authHook(req, reply);
  });

  app.addHook('onResponse', async (req, reply) => {
    if (req.url === '/health') return;
    await auditHook(req, reply);
  });

  // ── Routes ───────────────────────────────────────────────────
  registerRoutes(app, opts.workdir, policyConfig);
  registerProposalRoutes(app, opts.workdir, policyConfig, llmGenerateFn);
  registerMemoryRoutes(app, opts.workdir);
  registerUploadRoutes(app, opts.workdir, policyConfig);
  registerPresentationRoutes(app, opts.workdir);
  registerClassicPresentationRoutes(app, opts.workdir);
  registerKnowledgeRoutes(app, opts.workdir);
  registerConfigRoutes(app, opts.workdir, opts.auditLogPath);
  registerTemplateAgentRoutes(app);
  registerAgentRoutes(app, opts.workdir, policyConfig);
  registerChatRoutes(app, opts.workdir, policyConfig);
  registerContextRoutes(app, opts.workdir);
  registerExtractionRoutes(app, opts.workdir);
  registerTraceRoutes(app);
  registerExecutionStreamRoutes(app, opts.workdir);
  registerAssetRoutes(app, opts.workdir);
  registerStreamUploadRoutes(app, opts.workdir);
  registerImageRoutes(app, opts.workdir);
  registerAnalyzeImageRoutes(app);
  registerPluginRoutes(app, presenterRegistry);
  registerSkillRoutes(app, opts.workdir, policyConfig);
  registerDesignSkillRoutes(app, opts.workdir);
  registerClientMemoryRoutes(app, opts.workdir);
  registerSuperClientRoutes(app, opts.workdir);
  registerOrgContextRoutes(app, opts.workdir, llmGenerateFn);
  registerPdfExportRoutes(app, opts.workdir);
  registerDocumentRoutes(app, opts.workdir);
  app.register(clientDataRoutes);
  registerErrorLogRoutes(app);

  // ── Global error handler ─────────────────────────────────────
  // Safety net: logs any error that propagates to Fastify (i.e. routes that do
  // not catch their own error) with best-effort namespace/user-input context,
  // then returns the standard error response. Routes that catch-and-respond call
  // logError directly, so they never reach this handler (no double-logging).
  app.setErrorHandler(async (err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      // Preserve Fastify's built-in error logging to stdout (feeds docker logs)
      // — overriding setErrorHandler otherwise silences it.
      req.log.error({ err }, 'request error');
      await logError({
        process: `${req.method} ${req.routeOptions?.url ?? req.url}`,
        error: err,
        namespace: namespaceFromReq(req),
        userInput: userInputFromReq(req),
        method: req.method,
        path: req.url,
        statusCode: status,
      });
    }
    return reply.code(status).send({ error: err.message });
  });

  // ── Static exports (HTML downloads) ──────────────────────────
  app.get('/exports/:namespace/:filename', async (req, reply) => {
    const { namespace, filename } = req.params as { namespace: string; filename: string };
    // Prevent path traversal
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return reply.code(400).send({ error: 'Invalid filename' });
    }
    const filePath = nodePath.join(opts.workdir, 'exports', namespace, filename);
    try {
      const content = await fsReadFile(filePath);
      reply.header('Content-Type', 'text/html; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(content);
    } catch {
      return reply.code(404).send({ error: 'File not found' });
    }
  });

  // ── Workflow event bus listeners (STEP 4) ────────────────────
  // Bound once at startup so the same orchestrator instance handles all resumes.
  const workflowOrchestrator = new ChatOrchestrator(opts.workdir, policyConfig);

  workflowEventBus.on('ingestion_completed', (event: IngestionCompletedEvent) => {
    resumeWorkflowsForIngestion(event, opts.workdir, workflowOrchestrator).catch(async (err) => {
      await logError({ process: 'workflow:ingestion_completed', error: err, namespace: event.namespace });
      process.stderr.write(`[WorkflowResume] ingestion_completed handler error: ${String(err)}\n`);
    });
  });

  workflowEventBus.on('ingestion_failed', (event: IngestionFailedEvent) => {
    handleIngestionFailure(event, opts.workdir).catch(async (err) => {
      await logError({ process: 'workflow:ingestion_failed', error: err, namespace: event.namespace });
      process.stderr.write(`[WorkflowResume] ingestion_failed handler error: ${String(err)}\n`);
    });
  });

  // ── Ingestion queue ───────────────────────────────────────────
  ingestionQueue.init(opts.workdir, policyConfig);
  await recoverInterruptedJobs(opts.workdir, (namespace, fileName) => {
    ingestionQueue.enqueue({ namespace, fileName });
  });

  return app;
}
