/**
 * Fastify server — wires auth, audit, and route handlers.
 */

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { readFile as fsReadFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { authHook, loadApiKeys } from './auth.js';
import { auditHook, setAuditLogPath } from './audit.js';
import { registerRoutes } from './routes.js';
import { registerProposalRoutes } from './proposal-routes.js';
import { registerMemoryRoutes } from './memory-routes.js';
import { registerUploadRoutes } from './upload-routes.js';
import { registerPresentationRoutes } from './presentation/presentation-routes.js';
import { registerKnowledgeRoutes } from './ingestion/knowledge-routes.js';
import { registerConfigRoutes } from './config-routes.js';
import { registerTemplateAgentRoutes } from './template-agent-routes.js';
import { registerAgentRoutes } from './agent-routes.js';
import { registerAssetRoutes } from './asset-routes.js';
import { registerStreamUploadRoutes } from './ingestion/stream-upload-routes.js';
import { registerImageRoutes } from './image-routes.js';
import { registerPluginRoutes } from './plugin-routes.js';
import { registerChatRoutes } from './chat-routes.js';
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
  readonly providerPolicyPath?: string;
  /** Directory containing presenter plugin subdirectories (e.g. plugins/presenter-*) */
  readonly pluginsDir?: string;
}

export async function createServer(opts: ServerOptions) {
  await loadApiKeys(opts.apiKeysPath);
  setAuditLogPath(opts.auditLogPath);

  // ── Presenter plugin discovery ────────────────────────────────
  const presenterRegistry = new PresenterPluginRegistry();
  if (opts.pluginsDir) {
    try {
      await discoverPresenterPlugins(opts.pluginsDir, presenterRegistry);
    } catch (err) {
      // Non-fatal: log and continue with empty registry
      process.stderr.write(`[plugins] Discovery failed: ${String(err)}\n`);
    }
  }

  let policyConfig: ProviderPolicyConfig | null = null;
  if (opts.providerPolicyPath) {
    policyConfig = await loadProviderPolicy(opts.providerPolicyPath);
  }

  const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 }); // 20 MB — needed for base64 design images

  // ── Multipart support (file uploads) ─────────────────────────
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  // ── Health check (no auth required) ──────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // ── Auth + audit hooks (everything except /health) ───────────
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    await authHook(req, reply);
  });

  app.addHook('onResponse', async (req, reply) => {
    if (req.url === '/health') return;
    await auditHook(req, reply);
  });

  // ── Routes ───────────────────────────────────────────────────
  registerRoutes(app, opts.workdir, policyConfig);
  registerProposalRoutes(app, opts.workdir, policyConfig);
  registerMemoryRoutes(app, opts.workdir);
  registerUploadRoutes(app, opts.workdir, policyConfig);
  registerPresentationRoutes(app, opts.workdir);
  registerKnowledgeRoutes(app, opts.workdir);
  registerConfigRoutes(app, opts.workdir, opts.auditLogPath);
  registerTemplateAgentRoutes(app);
  registerAgentRoutes(app, opts.workdir, policyConfig);
  registerChatRoutes(app, opts.workdir, policyConfig);
  registerAssetRoutes(app, opts.workdir);
  registerStreamUploadRoutes(app, opts.workdir);
  registerImageRoutes(app);
  registerPluginRoutes(app, presenterRegistry);

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

  // ── Ingestion queue ───────────────────────────────────────────
  ingestionQueue.init(opts.workdir, policyConfig);
  await recoverInterruptedJobs(opts.workdir, (namespace, fileName) => {
    ingestionQueue.enqueue({ namespace, fileName });
  });

  return app;
}
