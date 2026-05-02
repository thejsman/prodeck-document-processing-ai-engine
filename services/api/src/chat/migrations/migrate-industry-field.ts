// One-time migration: rename `requirements.fields.industry` → `clientIndustry`
// in all existing context.json files under workdir/namespaces/*/context.json.
// Safe to call on every startup — skips namespaces already migrated.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { NamespaceContext } from '../context.types.js';

async function migrateContextFile(filePath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return false;
  }

  let ctx: NamespaceContext;
  try {
    ctx = JSON.parse(raw) as NamespaceContext;
  } catch {
    return false;
  }

  const fields = ctx.requirements?.fields as Record<string, unknown> | undefined;
  if (!fields) return false;

  // Already migrated or no legacy field present
  if (!('industry' in fields) || 'clientIndustry' in fields) return false;

  fields['clientIndustry'] = fields['industry'];
  delete fields['industry'];

  await writeFile(filePath, JSON.stringify(ctx, null, 2), 'utf-8');
  return true;
}

export async function migrateAllNamespaces(workdir: string): Promise<void> {
  const namespacesDir = path.join(workdir, 'namespaces');
  let entries: string[];
  try {
    entries = await readdir(namespacesDir);
  } catch {
    return; // namespaces dir doesn't exist yet — nothing to migrate
  }

  for (const entry of entries) {
    const contextPath = path.join(namespacesDir, entry, 'context.json');
    const migrated = await migrateContextFile(contextPath).catch(() => false);
    if (migrated) {
      console.info(`[migration] Renamed industry → clientIndustry in namespace "${entry}"`);
    }
  }
}
