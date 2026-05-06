import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PendingExtraction } from '../chat/context.types.js';

const TTL_HOURS = 24;

export class PendingExtractionService {
  constructor(private readonly workdir: string) {}

  private pendingDir(namespace: string): string {
    return path.join(this.workdir, 'namespaces', namespace, 'pending');
  }

  private cardPath(namespace: string, cardId: string): string {
    return path.join(this.pendingDir(namespace), `${cardId}.json`);
  }

  private async ensureDir(namespace: string): Promise<void> {
    await mkdir(this.pendingDir(namespace), { recursive: true });
  }

  private async write(namespace: string, record: PendingExtraction): Promise<void> {
    await this.ensureDir(namespace);
    const filePath = this.cardPath(namespace, record.cardId);
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
    // Atomic rename
    const { rename } = await import('node:fs/promises');
    await rename(tmpPath, filePath);
  }

  async store(
    namespace: string,
    data: Omit<PendingExtraction, 'cardId' | 'expiresAt' | 'status'>,
  ): Promise<PendingExtraction> {
    // Lazy cleanup before writing
    await this.purgeExpired(namespace).catch(() => {});

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL_HOURS * 60 * 60 * 1000).toISOString();
    const record: PendingExtraction = {
      ...data,
      cardId: randomUUID(),
      expiresAt,
      status: 'pending',
    };
    await this.write(namespace, record);
    return record;
  }

  async get(namespace: string, cardId: string): Promise<PendingExtraction | null> {
    const filePath = this.cardPath(namespace, cardId);
    if (!existsSync(filePath)) return null;
    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw) as PendingExtraction;
    } catch {
      return null;
    }
  }

  async listPending(namespace: string): Promise<PendingExtraction[]> {
    const dir = this.pendingDir(namespace);
    if (!existsSync(dir)) return [];
    const now = Date.now();
    try {
      const files = await readdir(dir);
      const records: PendingExtraction[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await readFile(path.join(dir, file), 'utf-8');
          const record = JSON.parse(raw) as PendingExtraction;
          if (record.status !== 'pending') continue;
          if (record.expiresAt && new Date(record.expiresAt).getTime() < now) continue;
          records.push(record);
        } catch {
          // Skip corrupt files
        }
      }
      return records;
    } catch {
      return [];
    }
  }

  async markConfirmed(namespace: string, cardId: string): Promise<void> {
    const record = await this.get(namespace, cardId);
    if (!record) return;
    record.status = 'confirmed';
    await this.write(namespace, record);
  }

  async markDiscarded(namespace: string, cardId: string): Promise<void> {
    const record = await this.get(namespace, cardId);
    if (!record) return;
    record.status = 'discarded';
    await this.write(namespace, record);
  }

  async purgeExpired(namespace: string): Promise<void> {
    const dir = this.pendingDir(namespace);
    if (!existsSync(dir)) return;
    const now = Date.now();
    try {
      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(dir, file);
        try {
          const raw = await readFile(filePath, 'utf-8');
          const record = JSON.parse(raw) as PendingExtraction;
          const expired = record.expiresAt && new Date(record.expiresAt).getTime() < now;
          const discarded = record.status === 'discarded';
          if (expired || discarded) {
            await unlink(filePath).catch(() => {});
          }
        } catch {
          // Skip corrupt files
        }
      }
    } catch {
      // Dir may not exist yet
    }
  }
}
