import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFile, rm, mkdtemp, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  setErrorLogPath,
  logError,
  logErrorSync,
  readErrorEntries,
  type ErrorLogEntry,
} from './error-log.js';

let dir: string;
let logPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'error-log-test-'));
  logPath = path.join(dir, 'error.log');
  setErrorLogPath(logPath);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('logError', () => {
  it('appends one parseable JSON line with all context', async () => {
    await logError({
      process: 'chat',
      error: new Error('boom'),
      namespace: 'acme',
      userInput: 'generate proposal',
      method: 'POST',
      path: '/chat/message',
      statusCode: 500,
    });

    const raw = await readFile(logPath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]) as ErrorLogEntry;
    expect(entry.process).toBe('chat');
    expect(entry.namespace).toBe('acme');
    expect(entry.userInput).toBe('generate proposal');
    expect(entry.message).toBe('boom');
    expect(entry.stack).toContain('Error: boom');
    expect(entry.method).toBe('POST');
    expect(entry.statusCode).toBe(500);
    expect(typeof entry.timestamp).toBe('string');
  });

  it('normalizes non-Error throwables and null context', async () => {
    await logError({ process: 'query', error: 'plain string failure' });
    const [entry] = await readErrorEntries();
    expect(entry.message).toBe('plain string failure');
    expect(entry.stack).toBeNull();
    expect(entry.namespace).toBeNull();
    expect(entry.userInput).toBeNull();
  });

  it('truncates oversized userInput and stack', async () => {
    const bigInput = 'a'.repeat(5000);
    const err = new Error('boom');
    err.stack = 'x'.repeat(12000);

    await logError({ process: 'agent:run', error: err, userInput: bigInput });
    const [entry] = await readErrorEntries();

    expect(entry.userInput!.length).toBeLessThan(bigInput.length);
    expect(entry.userInput).toContain('[truncated');
    expect(entry.stack!.length).toBeLessThan(12000);
    expect(entry.stack).toContain('[truncated');
  });

  it('never throws even if the log path is unwritable', async () => {
    setErrorLogPath(path.join(dir, 'no-such-dir', 'nested', 'error.log'));
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await expect(
      logError({ process: 'chat', error: new Error('boom') }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('logErrorSync', () => {
  it('appends a parseable entry synchronously (for crash handlers)', async () => {
    logErrorSync({ process: 'uncaughtException', error: new Error('fatal') });
    const [entry] = await readErrorEntries();
    expect(entry.process).toBe('uncaughtException');
    expect(entry.message).toBe('fatal');
    expect(entry.stack).toContain('Error: fatal');
  });

  it('never throws even if the log path is unwritable', () => {
    setErrorLogPath(path.join(dir, 'no-such-dir', 'nested', 'error.log'));
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(() => logErrorSync({ process: 'uncaughtException', error: new Error('x') })).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('readErrorEntries', () => {
  it('returns newest-first and respects the limit', async () => {
    await logError({ process: 'p', error: new Error('first') });
    await logError({ process: 'p', error: new Error('second') });
    await logError({ process: 'p', error: new Error('third') });

    const entries = await readErrorEntries(2);
    expect(entries.map((e) => e.message)).toEqual(['third', 'second']);
  });

  it('skips malformed lines', async () => {
    await logError({ process: 'p', error: new Error('valid') });
    await appendFile(logPath, 'this is not json\n', 'utf-8');
    await logError({ process: 'p', error: new Error('valid2') });

    const entries = await readErrorEntries();
    expect(entries.map((e) => e.message)).toEqual(['valid2', 'valid']);
  });

  it('returns [] when the file does not exist', async () => {
    setErrorLogPath(path.join(dir, 'missing.log'));
    expect(await readErrorEntries()).toEqual([]);
  });
});
