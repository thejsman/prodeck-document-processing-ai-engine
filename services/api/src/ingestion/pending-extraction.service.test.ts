import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PendingExtractionService } from './pending-extraction.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeWorkdir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'pending-svc-test-'));
}

function minimalStore() {
  return {
    documentId: 'rfp.pdf',
    fileName: 'rfp.pdf',
    extractedAt: new Date().toISOString(),
    fields: {},
  } as const;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let workdir: string;
let svc: PendingExtractionService;

beforeEach(async () => {
  workdir = await makeWorkdir();
  svc = new PendingExtractionService(workdir);
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// store()
// ---------------------------------------------------------------------------

describe('store()', () => {
  it('returns a record with a cardId, expiresAt, and status=pending', async () => {
    const record = await svc.store('ns1', minimalStore());
    expect(record.cardId).toBeTruthy();
    expect(record.status).toBe('pending');
    expect(record.expiresAt).toBeTruthy();
  });

  it('expiresAt is approximately 24h in the future', async () => {
    const before = Date.now();
    const record = await svc.store('ns1', minimalStore());
    const after = Date.now();
    const expMs = new Date(record.expiresAt!).getTime();
    const expectedMs = 24 * 60 * 60 * 1000;
    expect(expMs - before).toBeGreaterThanOrEqual(expectedMs - 1000);
    expect(expMs - after).toBeLessThanOrEqual(expectedMs + 1000);
  });

  it('two stores produce unique cardIds', async () => {
    const a = await svc.store('ns1', minimalStore());
    const b = await svc.store('ns1', minimalStore());
    expect(a.cardId).not.toBe(b.cardId);
  });

  it('creates the pending directory lazily', async () => {
    await svc.store('new-namespace', minimalStore());
    const { existsSync } = await import('node:fs');
    const dir = path.join(workdir, 'namespaces', 'new-namespace', 'pending');
    expect(existsSync(dir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// get()
// ---------------------------------------------------------------------------

describe('get()', () => {
  it('returns null for unknown cardId', async () => {
    const result = await svc.get('ns1', 'does-not-exist');
    expect(result).toBeNull();
  });

  it('returns stored record by cardId', async () => {
    const stored = await svc.store('ns1', minimalStore());
    const fetched = await svc.get('ns1', stored.cardId);
    expect(fetched?.cardId).toBe(stored.cardId);
    expect(fetched?.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// listPending()
// ---------------------------------------------------------------------------

describe('listPending()', () => {
  it('returns empty array when no pending dir exists', async () => {
    const result = await svc.listPending('empty-ns');
    expect(result).toEqual([]);
  });

  it('returns only pending, non-expired records', async () => {
    const a = await svc.store('ns1', minimalStore());
    const b = await svc.store('ns1', minimalStore());
    await svc.markConfirmed('ns1', a.cardId);

    const pending = await svc.listPending('ns1');
    expect(pending).toHaveLength(1);
    expect(pending[0].cardId).toBe(b.cardId);
  });

  it('excludes discarded records', async () => {
    const rec = await svc.store('ns1', { ...minimalStore(), fileName: 'discarded.pdf', documentId: 'discarded.pdf' });
    await svc.markDiscarded('ns1', rec.cardId);
    const pending = await svc.listPending('ns1');
    expect(pending).toHaveLength(0);
  });

  it('excludes expired records', async () => {
    // Store a record then manually set expiresAt to the past
    const rec = await svc.store('ns1', minimalStore());
    const { readFile, writeFile } = await import('node:fs/promises');
    const filePath = path.join(workdir, 'namespaces', 'ns1', 'pending', `${rec.cardId}.json`);
    const data = JSON.parse(await readFile(filePath, 'utf-8'));
    data.expiresAt = new Date(Date.now() - 1000).toISOString();
    await writeFile(filePath, JSON.stringify(data), 'utf-8');

    const pending = await svc.listPending('ns1');
    expect(pending).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// markConfirmed() / markDiscarded()
// ---------------------------------------------------------------------------

describe('markConfirmed()', () => {
  it('updates status to confirmed on disk', async () => {
    const rec = await svc.store('ns1', minimalStore());
    await svc.markConfirmed('ns1', rec.cardId);
    const fetched = await svc.get('ns1', rec.cardId);
    expect(fetched?.status).toBe('confirmed');
  });

  it('is a no-op for unknown cardId', async () => {
    await expect(svc.markConfirmed('ns1', 'ghost-id')).resolves.toBeUndefined();
  });
});

describe('markDiscarded()', () => {
  it('updates status to discarded on disk', async () => {
    const rec = await svc.store('ns1', minimalStore());
    await svc.markDiscarded('ns1', rec.cardId);
    const fetched = await svc.get('ns1', rec.cardId);
    expect(fetched?.status).toBe('discarded');
  });
});

// ---------------------------------------------------------------------------
// purgeExpired()
// ---------------------------------------------------------------------------

describe('purgeExpired()', () => {
  it('no-ops silently when pending dir does not exist', async () => {
    await expect(svc.purgeExpired('ghost-ns')).resolves.toBeUndefined();
  });

  it('deletes expired records and leaves valid ones intact', async () => {
    const valid = await svc.store('ns1', minimalStore());
    const expired = await svc.store('ns1', { ...minimalStore(), fileName: 'old.pdf', documentId: 'old.pdf' });

    // Age the expired record
    const { readFile, writeFile } = await import('node:fs/promises');
    const filePath = path.join(workdir, 'namespaces', 'ns1', 'pending', `${expired.cardId}.json`);
    const data = JSON.parse(await readFile(filePath, 'utf-8'));
    data.expiresAt = new Date(Date.now() - 1000).toISOString();
    await writeFile(filePath, JSON.stringify(data), 'utf-8');

    await svc.purgeExpired('ns1');

    const { existsSync } = await import('node:fs');
    expect(existsSync(filePath)).toBe(false);
    expect(await svc.get('ns1', valid.cardId)).not.toBeNull();
  });

  it('deletes discarded records', async () => {
    const rec = await svc.store('ns1', minimalStore());
    await svc.markDiscarded('ns1', rec.cardId);
    await svc.purgeExpired('ns1');
    expect(await svc.get('ns1', rec.cardId)).toBeNull();
  });
});
