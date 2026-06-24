/**
 * Cascade helpers for org-level inspiration context.
 *
 * Resolution order: namespace-level → org-level → null
 *
 * Both OrgVoiceStore and OrgAssetStore are already parameterized by workdir,
 * so passing a namespace-scoped workdir (e.g. {workdir}/super-clients/{name})
 * just changes the root they look under — no new stores needed.
 */

import path from 'node:path';
import { OrgVoiceStore } from './org-voice-store.js';
import { OrgAssetStore } from './org-asset-store.js';
import type { DesignKit } from '@ai-engine/core';

/**
 * Resolve the rendered Author Voice prompt block.
 * Tries namespace workdir first; falls back to org workdir.
 *
 * @param orgWorkdir   - the repository workdir (org-level root)
 * @param nsWorkdir    - namespace-scoped workdir (e.g. path.join(workdir, 'super-clients', name))
 *                       Pass null to skip namespace check and go straight to org.
 */
export async function resolveVoiceBlock(
  orgWorkdir: string,
  nsWorkdir: string | null,
): Promise<string | null> {
  if (nsWorkdir) {
    const nsBlock = await new OrgVoiceStore(nsWorkdir).getRendered().catch(() => null);
    if (nsBlock) return nsBlock;
  }
  return new OrgVoiceStore(orgWorkdir).getRendered().catch(() => null);
}

/**
 * Resolve the Design Kit.
 * Tries namespace workdir first; falls back to org workdir.
 *
 * @param orgWorkdir   - the repository workdir (org-level root)
 * @param nsWorkdir    - namespace-scoped workdir
 *                       Pass null to skip namespace check and go straight to org.
 */
export async function resolveDesignKit(
  orgWorkdir: string,
  nsWorkdir: string | null,
): Promise<DesignKit | null> {
  if (nsWorkdir) {
    const nsKit = await new OrgAssetStore(nsWorkdir).getDesignKit().catch(() => null);
    if (nsKit) return nsKit;
  }
  return new OrgAssetStore(orgWorkdir).getDesignKit().catch(() => null);
}

/**
 * Build the namespace-scoped workdir for a super-client.
 * Returns null if name is empty/invalid (safe to pass to resolve* helpers).
 */
export function superClientWorkdir(orgWorkdir: string, name: string): string | null {
  const safe = name.trim();
  if (!safe || safe.includes('..') || safe.includes('/')) return null;
  return path.join(orgWorkdir, 'super-clients', safe);
}

/**
 * Build the namespace-scoped workdir for a namespaces/ namespace.
 * Returns null if namespace is empty/invalid.
 */
export function namespaceWorkdir(orgWorkdir: string, namespace: string): string | null {
  const safe = namespace.trim();
  if (!safe || safe.includes('..') || safe.includes('/')) return null;
  return path.join(orgWorkdir, 'namespaces', safe);
}
