/**
 * API-key authentication and namespace-based RBAC.
 *
 * Keys are loaded from a JSON file on disk:
 *
 *   { "some-key": ["ns-a", "ns-b"], "admin-key": ["*"] }
 *
 * A value of ["*"] grants access to every namespace.
 */

import { readFile } from 'node:fs/promises';
import type { FastifyRequest, FastifyReply } from 'fastify';

export interface AuthContext {
  readonly apiKey: string;
  readonly allowedNamespaces: readonly string[];
}

type KeyMap = Record<string, string[]>;

let keyMap: KeyMap = {};

export async function loadApiKeys(configPath: string): Promise<void> {
  const raw = await readFile(configPath, 'utf-8');
  keyMap = JSON.parse(raw) as KeyMap;
}

function extractKey(req: FastifyRequest): string | null {
  // Standard Bearer header (all normal requests)
  const header = req.headers.authorization;
  if (header) {
    const parts = header.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') return parts[1];
  }

  // Query-parameter fallback — EventSource (SSE) cannot send custom headers,
  // so the client passes the token as ?token=... in the URL.
  const query = req.query as Record<string, unknown>;
  if (typeof query.token === 'string' && query.token.length > 0) {
    return query.token;
  }

  return null;
}

function namespaceFromRequest(req: FastifyRequest): string | null {
  const body = req.body as Record<string, unknown> | undefined;
  if (body && typeof body.namespace === 'string') {
    return body.namespace;
  }
  const query = req.query as Record<string, unknown> | undefined;
  if (query && typeof query.namespace === 'string') {
    return query.namespace;
  }
  return null;
}

export function isWildcard(allowed: readonly string[]): boolean {
  return allowed.includes('*');
}

export function filterByAccess(
  names: string[],
  allowed: readonly string[],
): string[] {
  if (isWildcard(allowed)) return names;
  return names.filter((n) => allowed.includes(n));
}

/**
 * Fastify onRequest hook — validates API key and namespace permission.
 *
 * Skips namespace check for routes that don't target a specific namespace
 * (e.g. GET /namespaces).
 */
export async function authHook(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = extractKey(req);
  if (!key || !(key in keyMap)) {
    reply.code(401).send({ error: 'Invalid or missing API key' });
    return;
  }

  const allowed = keyMap[key];

  // Attach auth context for downstream handlers and audit.
  (req as FastifyRequest & { auth: AuthContext }).auth = {
    apiKey: key,
    allowedNamespaces: allowed,
  };

  // Namespace check — only for requests that carry a namespace.
  const namespace = namespaceFromRequest(req);
  if (namespace !== null && !isWildcard(allowed) && !allowed.includes(namespace)) {
    reply.code(403).send({ error: `Access denied for namespace: ${namespace}` });
  }
}
