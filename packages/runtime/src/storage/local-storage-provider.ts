import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import type { Readable } from 'node:stream';
import path from 'node:path';
import type { StorageProvider } from '@ai-engine/core';

export interface LocalStorageConfig {
  /**
   * Absolute path to the workspace root (e.g. process.cwd() + '/workdir').
   * All namespace data is stored under {workdir}/data/namespaces/{namespace}/.
   */
  workdir: string;

  /** Namespace slug — provides path isolation between organizations. */
  namespace: string;
}

// ── Path safety ───────────────────────────────────────────────────

/**
 * Normalize and validate a caller-supplied relative path.
 * Throws on absolute paths or directory traversal attempts.
 */
function sanitize(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    throw new Error(`Storage: absolute paths are not allowed: "${inputPath}"`);
  }
  const normalized = path.normalize(inputPath);
  if (normalized.startsWith('..') || normalized.includes(`${path.sep}..`)) {
    throw new Error(`Storage: path traversal is not allowed: "${inputPath}"`);
  }
  return normalized;
}

// ── Provider ─────────────────────────────────────────────────────

export class LocalStorageProvider implements StorageProvider {
  private readonly root: string;
  private readonly namespace: string;

  constructor({ workdir, namespace }: LocalStorageConfig) {
    this.namespace = namespace;
    // All data scoped to: {workdir}/data/namespaces/{namespace}/
    this.root = path.join(workdir, 'data', 'namespaces', namespace);
  }

  /** Resolve a relative path to an absolute path inside the namespace root. */
  private resolve(relativePath: string): string {
    const safe = sanitize(relativePath);
    const full = path.join(this.root, safe);
    // Final guard: resolved path must stay inside namespace root
    if (!path.resolve(full).startsWith(path.resolve(this.root) + path.sep) &&
        path.resolve(full) !== path.resolve(this.root)) {
      throw new Error(`Storage: path escapes namespace root: "${relativePath}"`);
    }
    return full;
  }

  async writeFile(relativePath: string, content: Buffer | string): Promise<string> {
    const full = this.resolve(relativePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
    // Return normalized URI using forward slashes for cross-platform consistency
    const uri = `local://namespaces/${this.namespace}/${sanitize(relativePath).replace(/\\/g, '/')}`;
    return uri;
  }

  async readFile(relativePath: string): Promise<Buffer> {
    const full = this.resolve(relativePath);
    return readFile(full);
  }

  async list(prefix: string): Promise<string[]> {
    const dir = this.resolve(prefix);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const results: string[] = [];
    for (const entry of entries) {
      const entryPath = path.join(dir, entry);
      const s = await stat(entryPath);
      if (s.isFile()) {
        results.push(path.join(prefix, entry).replace(/\\/g, '/'));
      }
    }
    return results;
  }

  async delete(relativePath: string): Promise<void> {
    const full = this.resolve(relativePath);
    try {
      await unlink(full);
    } catch (err) {
      // Silently ignore missing files — caller doesn't need to check existence first
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async exists(relativePath: string): Promise<boolean> {
    const full = this.resolve(relativePath);
    try {
      await stat(full);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Stream content directly to disk without buffering the full file in memory.
   * Suitable for large uploads (50 MB+).
   */
  async writeStream(relativePath: string, stream: Readable): Promise<string> {
    const full = this.resolve(relativePath);
    await mkdir(path.dirname(full), { recursive: true });

    return new Promise<string>((resolve, reject) => {
      const ws = createWriteStream(full);
      stream.pipe(ws);
      ws.on('finish', () => {
        resolve(
          `local://namespaces/${this.namespace}/${sanitize(relativePath).replace(/\\/g, '/')}`,
        );
      });
      ws.on('error', (err) => {
        stream.destroy();
        reject(err);
      });
      stream.on('error', (err) => {
        ws.destroy();
        reject(err);
      });
    });
  }

  /** Open a read stream to stored content — avoids loading the full file into memory. */
  async readStream(relativePath: string): Promise<Readable> {
    const full = this.resolve(relativePath);
    // Verify the file exists before returning the stream (fail fast)
    await stat(full);
    return createReadStream(full);
  }
}
