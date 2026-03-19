/**
 * Append-only audit logger.
 *
 * Writes one JSON line per request to an audit log file.
 */

import { appendFile } from 'node:fs/promises';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthContext } from './auth.js';
import type { ProviderInfo } from './provider-policy.js';

interface AuditEntry {
  readonly timestamp: string;
  readonly apiKey: string;
  readonly method: string;
  readonly path: string;
  readonly namespace: string | null;
  readonly question: string | null;
  readonly statusCode: number;
  readonly provider: string | null;
  readonly usedFallback: boolean | null;
  readonly policySource: string | null;
}

let auditLogPath = 'audit.log';

export function setAuditLogPath(filePath: string): void {
  auditLogPath = filePath;
}

export async function auditHook(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const auth = (req as FastifyRequest & { auth?: AuthContext }).auth;
  const body = req.body as Record<string, unknown> | undefined;
  const providerInfo = (req as FastifyRequest & { __providerInfo?: ProviderInfo }).__providerInfo;

  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    apiKey: auth?.apiKey ?? 'unknown',
    method: req.method,
    path: req.url,
    namespace: (body?.namespace as string) ?? null,
    question: (body?.question as string) ?? null,
    statusCode: reply.statusCode,
    provider: providerInfo?.provider ?? null,
    usedFallback: providerInfo?.usedFallback ?? null,
    policySource: providerInfo?.policySource ?? null,
  };

  await appendFile(auditLogPath, JSON.stringify(entry) + '\n', 'utf-8');
}
