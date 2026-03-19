/**
 * Memory route handlers — read and write namespace memory JSON.
 *
 * Endpoints:
 *   GET  /memory/:namespace  — read namespace memory
 *   POST /memory/:namespace  — write namespace memory (validates JSON)
 *
 * Memory files live at: <workdir>/memory/namespaces/<namespace>.json
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { type AuthContext, isWildcard } from './auth.js';

function memoryPath(workdir: string, namespace: string): string {
  return path.join(workdir, 'memory', 'namespaces', `${namespace}.json`);
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

export function registerMemoryRoutes(
  app: FastifyInstance,
  workdir: string,
): void {

  // GET /memory/:namespace
  app.get('/memory/:namespace', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string };
    const auth = (req as FastifyRequest & { auth: AuthContext }).auth;

    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const filePath = memoryPath(workdir, namespace);

    try {
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      return reply.send({ memory: data });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.send({ memory: {} });
      }
      throw err;
    }
  });

  // POST /memory/:namespace
  app.post('/memory/:namespace', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string };
    const auth = (req as FastifyRequest & { auth: AuthContext }).auth;

    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as { memory?: unknown } | undefined;

    if (!body || body.memory === undefined) {
      return reply.code(400).send({ error: 'Missing required field: memory' });
    }

    // Validate it's a plain object (not array, null, or primitive)
    if (
      typeof body.memory !== 'object' ||
      body.memory === null ||
      Array.isArray(body.memory)
    ) {
      return reply.code(400).send({ error: 'memory must be a JSON object' });
    }

    const filePath = memoryPath(workdir, namespace);
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });

    const json = JSON.stringify(body.memory, null, 2);
    await writeFile(filePath, json, 'utf-8');

    return reply.send({ ok: true, memory: body.memory });
  });
}
