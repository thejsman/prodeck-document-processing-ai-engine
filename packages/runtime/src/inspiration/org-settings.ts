/**
 * Org-level "Inspiration & Global Context" settings.
 *
 * Stored at {workdir}/org-context/settings.json. These toggles gate whether the
 * learned Author Voice (and, in Phase 2, the Design Kit) are injected at
 * generation time. Both default to ON.
 */

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export interface OrgContextSettings {
  applyAuthorVoice: boolean;
  applyDesignKit: boolean;
}

export const DEFAULT_ORG_CONTEXT_SETTINGS: OrgContextSettings = {
  applyAuthorVoice: true,
  applyDesignKit: true,
};

function settingsPath(workdir: string): string {
  return path.join(workdir, 'org-context', 'settings.json');
}

export async function readOrgContextSettings(workdir: string): Promise<OrgContextSettings> {
  try {
    const raw = await readFile(settingsPath(workdir), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<OrgContextSettings>;
    return { ...DEFAULT_ORG_CONTEXT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_ORG_CONTEXT_SETTINGS };
  }
}

export async function writeOrgContextSettings(
  workdir: string,
  patch: Partial<OrgContextSettings>,
): Promise<OrgContextSettings> {
  const current = await readOrgContextSettings(workdir);
  const next: OrgContextSettings = { ...current, ...patch };
  const filePath = settingsPath(workdir);
  const tmp = `${filePath}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8');
  await rename(tmp, filePath);
  return next;
}
