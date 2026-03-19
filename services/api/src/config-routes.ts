/**
 * Config route handlers — read and write namespace configuration JSON.
 *
 * Endpoints:
 *   GET  /config/:namespace  — read namespace config
 *   POST /config/:namespace  — write namespace config (atomic write)
 *
 * Config files live at: <workdir>/config/namespaces/<namespace>.json
 * These are the same files read by ConfigResolver at pipeline execution time.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { type AuthContext, isWildcard } from './auth.js';
import { appendFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function configPath(workdir: string, namespace: string): string {
  return path.join(workdir, 'config', 'namespaces', `${namespace}.json`);
}

function isValidNamespace(namespace: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(namespace) && namespace.length > 0 && namespace.length <= 64;
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

function getAuth(req: FastifyRequest): AuthContext {
  return (req as FastifyRequest & { auth: AuthContext }).auth;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerConfigRoutes(
  app: FastifyInstance,
  workdir: string,
  auditLogPath: string,
): void {

  // GET /config/:namespace
  app.get('/config/:namespace', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string };

    if (!isValidNamespace(namespace)) {
      return reply.code(400).send({ error: 'Invalid namespace name' });
    }

    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const filePath = configPath(workdir, namespace);

    // Prevent path traversal
    const resolved = path.resolve(filePath);
    const configDir = path.resolve(path.join(workdir, 'config', 'namespaces'));
    if (!resolved.startsWith(configDir)) {
      return reply.code(400).send({ error: 'Invalid namespace name' });
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const config = JSON.parse(content) as Record<string, unknown>;
      return reply.send({ namespace, config });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.send({ namespace, config: {} });
      }
      throw err;
    }
  });

  // POST /config/:namespace
  app.post('/config/:namespace', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string };

    if (!isValidNamespace(namespace)) {
      return reply.code(400).send({ error: 'Invalid namespace name' });
    }

    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as { config?: unknown } | undefined;

    if (!body || body.config === undefined) {
      return reply.code(400).send({ error: 'Missing required field: config' });
    }

    if (
      typeof body.config !== 'object' ||
      body.config === null ||
      Array.isArray(body.config)
    ) {
      return reply.code(400).send({ error: 'config must be a JSON object' });
    }

    const filePath = configPath(workdir, namespace);

    // Prevent path traversal
    const resolved = path.resolve(filePath);
    const configDir = path.resolve(path.join(workdir, 'config', 'namespaces'));
    if (!resolved.startsWith(configDir)) {
      return reply.code(400).send({ error: 'Invalid namespace name' });
    }

    await mkdir(path.dirname(filePath), { recursive: true });

    // Atomic write: temp file + rename
    const tmp = `${filePath}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(body.config, null, 2), 'utf-8');
    await rename(tmp, filePath);

    // Audit log
    const auditEntry = {
      timestamp: new Date().toISOString(),
      action: 'config_saved',
      namespace,
      apiKey: auth.apiKey,
    };
    await appendFile(auditLogPath, JSON.stringify(auditEntry) + '\n', 'utf-8');

    return reply.send({ ok: true, namespace, config: body.config });
  });
}
