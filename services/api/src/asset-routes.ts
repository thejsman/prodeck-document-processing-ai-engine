/**
 * Asset access routes.
 *
 * Endpoints:
 *   GET  /api/assets/download  — stream an asset by storage URI
 *   GET  /api/assets/signed    — return a time-limited access URL
 *   GET  /api/assets/list      — list assets for a namespace
 *
 * All endpoints require a valid API key (enforced by the global auth hook).
 * Namespace access is verified against the key's allowed namespaces.
 *
 * Query params for /api/assets/download and /api/assets/signed:
 *   uri        — encoded storage URI (local:// or s3://)
 *   ttl        — (signed only) TTL in seconds, default 300, max 3600
 *
 * Query params for /api/assets/list:
 *   namespace  — namespace to list
 *   prefix     — storage prefix, default "assets"
 */

import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  ConfigResolver,
} from '@ai-engine/core';
import {
  createNodeConfigLoader,
  getStorageProvider,
  resolveStorageUri,
  AssetService,
  listAssets,
  getMimeType,
} from '@ai-engine/runtime';
import { type AuthContext, isWildcard } from './auth.js';

// ── Helpers ───────────────────────────────────────────────────────

function getAuth(req: FastifyRequest): AuthContext {
  return (req as FastifyRequest & { auth: AuthContext }).auth;
}

function assertNamespaceAccess(
  auth: AuthContext,
  namespace: string,
  reply: FastifyReply,
): boolean {
  if (isWildcard(auth.allowedNamespaces)) return true;
  if (auth.allowedNamespaces.includes(namespace)) return true;
  reply.code(403).send({ error: `Access denied for namespace: "${namespace}"` });
  return false;
}

function buildFactory(workdir: string) {
  return async (namespace: string) => {
    const loader = createNodeConfigLoader(path.join(workdir, 'config'));
    const resolver = new ConfigResolver(loader);
    const config = await resolver.resolve({ namespace });
    return getStorageProvider({ namespace, config, workdir });
  };
}

// ── Route registration ────────────────────────────────────────────

export function registerAssetRoutes(
  app: FastifyInstance,
  workdir: string,
): void {
  const factory = buildFactory(workdir);
  const service = new AssetService(factory, '/api/assets/download');

  // ── GET /api/assets/download ────────────────────────────────────

  app.get('/api/assets/download', async (req: FastifyRequest, reply: FastifyReply) => {
    const { uri } = req.query as Record<string, string>;

    if (!uri) {
      return reply.code(400).send({ error: 'Missing required query param: uri' });
    }

    // Resolve and validate URI
    let resolved;
    try {
      resolved = resolveStorageUri(uri);
    } catch (err) {
      return reply.code(400).send({
        error: `Invalid storage URI: ${(err as Error).message}`,
      });
    }

    // Namespace access check
    const auth = getAuth(req);
    if (!assertNamespaceAccess(auth, resolved.namespace, reply)) return;

    // For S3 assets redirect to a signed URL — avoids proxying large objects
    if (resolved.provider === 's3') {
      let signedUrl: string;
      try {
        signedUrl = await service.getSignedReadUrl(uri, 300);
      } catch (err) {
        return reply.code(502).send({
          error: `Failed to generate signed URL: ${(err as Error).message}`,
        });
      }
      return reply.redirect(signedUrl, 302);
    }

    // Local assets: proxy file content through the API
    let buffer: Buffer;
    try {
      buffer = await service.getBuffer(uri);
    } catch (err) {
      const message = (err as Error).message;
      const status = message.includes('ENOENT') ? 404 : 502;
      return reply.code(status).send({ error: `Asset not found: ${message}` });
    }

    // Derive file name from URI path for Content-Disposition
    const segments = uri.split('/').filter(Boolean);
    const fileName = segments[segments.length - 1] ?? 'asset';
    const mimeType = getMimeType(fileName);

    return reply
      .type(mimeType)
      .header('Content-Disposition', `inline; filename="${fileName}"`)
      .header('Cache-Control', 'private, max-age=60')
      .send(buffer);
  });

  // ── GET /api/assets/signed ──────────────────────────────────────

  app.get('/api/assets/signed', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const { uri, ttl: ttlRaw } = query;

    if (!uri) {
      return reply.code(400).send({ error: 'Missing required query param: uri' });
    }

    let resolved;
    try {
      resolved = resolveStorageUri(uri);
    } catch (err) {
      return reply.code(400).send({
        error: `Invalid storage URI: ${(err as Error).message}`,
      });
    }

    const auth = getAuth(req);
    if (!assertNamespaceAccess(auth, resolved.namespace, reply)) return;

    const ttl = Math.min(
      parseInt(ttlRaw ?? '300', 10) || 300,
      3600,
    );

    let url: string;
    try {
      url = await service.getSignedReadUrl(uri, ttl);
    } catch (err) {
      return reply.code(502).send({
        error: `Failed to generate signed URL: ${(err as Error).message}`,
      });
    }

    return reply.send({ url, ttl });
  });

  // ── GET /api/assets/list ────────────────────────────────────────

  app.get('/api/assets/list', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const { namespace, prefix } = query;

    if (!namespace) {
      return reply.code(400).send({ error: 'Missing required query param: namespace' });
    }

    const auth = getAuth(req);
    if (!assertNamespaceAccess(auth, namespace, reply)) return;

    let items;
    try {
      const provider = await factory(namespace);
      items = await listAssets(provider, namespace, prefix ?? 'assets');
    } catch (err) {
      return reply.code(500).send({
        error: `Failed to list assets: ${(err as Error).message}`,
      });
    }

    return reply.send({ namespace, assets: items });
  });
}
