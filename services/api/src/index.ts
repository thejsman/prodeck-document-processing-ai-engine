#!/usr/bin/env node

import path from 'node:path';
import { createServer } from './server.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const WORKDIR = path.resolve(process.env.WORKDIR ?? process.cwd());
const API_KEYS_PATH = path.resolve(
  process.env.API_KEYS_PATH ?? 'config/api_keys.json',
);
const AUDIT_LOG_PATH = path.resolve(
  process.env.AUDIT_LOG_PATH ?? 'audit.log',
);
const PROVIDER_POLICY_PATH = process.env.PROVIDER_POLICY_PATH
  ? path.resolve(process.env.PROVIDER_POLICY_PATH)
  : undefined;

async function main(): Promise<void> {
  const app = await createServer({
    port: PORT,
    host: HOST,
    workdir: WORKDIR,
    apiKeysPath: API_KEYS_PATH,
    auditLogPath: AUDIT_LOG_PATH,
    providerPolicyPath: PROVIDER_POLICY_PATH,
  });

  await app.listen({ port: PORT, host: HOST });
}

main().catch((err: unknown) => {
  process.stderr.write(`Failed to start API server: ${String(err)}\n`);
  process.exit(1);
});
