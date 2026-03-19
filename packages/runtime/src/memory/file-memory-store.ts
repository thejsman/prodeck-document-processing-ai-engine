/**
 * Filesystem-backed implementation of the core MemoryStore interface.
 *
 * Expected directory layout under `basePath`:
 *
 *   org.json
 *   namespaces/<namespace>.json
 *   users/<userId>.json
 *
 * Missing files are treated as empty objects.
 * Writes are atomic (write to temp file, then rename).
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { MemoryData, MemoryStore } from '@ai-engine/core';

export class FileMemoryStore implements MemoryStore {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async loadOrg(): Promise<MemoryData> {
    return this.loadJson(path.join(this.basePath, 'org.json'));
  }

  async loadNamespace(namespace: string): Promise<MemoryData> {
    return this.loadJson(
      path.join(this.basePath, 'namespaces', `${namespace}.json`),
    );
  }

  async loadUser(userId: string): Promise<MemoryData> {
    return this.loadJson(
      path.join(this.basePath, 'users', `${userId}.json`),
    );
  }

  async writeNamespace(namespace: string, data: MemoryData): Promise<void> {
    const filePath = path.join(
      this.basePath,
      'namespaces',
      `${namespace}.json`,
    );
    await this.writeJsonAtomic(filePath, data);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async loadJson(filePath: string): Promise<MemoryData> {
    try {
      const content = await readFile(filePath, 'utf-8');
      if (content.trim() === '') return {};
      return JSON.parse(content) as MemoryData;
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return {};
      throw err;
    }
  }

  private async writeJsonAtomic(
    filePath: string,
    data: MemoryData,
  ): Promise<void> {
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });

    const tmp = `${filePath}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmp, filePath);
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
