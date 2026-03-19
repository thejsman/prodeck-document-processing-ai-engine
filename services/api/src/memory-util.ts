/**
 * Shared utility for appending episodic entries to namespace memory files.
 *
 * Episodic entries are atomic-appended to <workdir>/memory/namespaces/<namespace>.json
 * so that automatic events (proposal generation, chat queries) are recorded without
 * overwriting existing memory data.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface EpisodicEntry {
  timestamp: string;
  source: string;
  content: string;
}

/**
 * Reads the namespace memory file, appends the episodic entry, and writes back
 * atomically using a temp-file + rename pattern.
 *
 * Never throws — failures are silently swallowed so callers never block a
 * response waiting for memory to be written.
 */
export async function appendEpisodicEntry(
  workdir: string,
  namespace: string,
  entry: EpisodicEntry,
): Promise<void> {
  const filePath = path.join(
    workdir,
    'memory',
    'namespaces',
    `${namespace}.json`,
  );
  const dir = path.dirname(filePath);

  try {
    await mkdir(dir, { recursive: true });

    let data: Record<string, unknown> = {};
    try {
      const raw = await readFile(filePath, 'utf-8');
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // File doesn't exist yet or is corrupt — start fresh
    }

    const episodic: EpisodicEntry[] = Array.isArray(data.episodic)
      ? (data.episodic as EpisodicEntry[])
      : [];

    episodic.push(entry);
    data.episodic = episodic;

    const tmp = `${filePath}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmp, filePath);
  } catch {
    // Silently ignore — memory append is best-effort and must never
    // cause the originating request to fail.
  }
}

/** Truncate a string to a maximum byte-safe length. */
export function truncate(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : `${s.slice(0, maxLen)}…`;
}
