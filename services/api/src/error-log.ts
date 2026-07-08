/**
 * Append-only error logger.
 *
 * Writes one JSON line per error to an error log file, capturing the error
 * message + stack, the namespace, the process/operation where it happened, and
 * the user input that triggered it. Mirrors the audit logger (audit.ts).
 *
 * The log path is configured once at startup via `setErrorLogPath` and defaults
 * to `error.log`. `logError` never throws — a logging failure must not mask the
 * original error or crash a request.
 */

import { appendFile, readFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import type { FastifyRequest } from 'fastify';

export interface ErrorLogEntry {
  readonly timestamp: string;
  readonly process: string;
  readonly namespace: string | null;
  readonly userInput: string | null;
  readonly message: string;
  readonly stack: string | null;
  readonly method?: string;
  readonly path?: string;
  readonly statusCode?: number;
}

export interface LogErrorInput {
  /** Operation where the error occurred, e.g. "chat", "agent:run", "POST /ingest". */
  readonly process: string;
  readonly error: unknown;
  readonly namespace?: string | null;
  readonly userInput?: string | null;
  readonly method?: string;
  readonly path?: string;
  readonly statusCode?: number;
}

const USER_INPUT_MAX = 2000;
const STACK_MAX = 8000;

let errorLogPath = 'error.log';

export function setErrorLogPath(filePath: string): void {
  errorLogPath = filePath;
}

function truncate(value: string, max: number): string {
  return value.length > max
    ? `${value.slice(0, max)}… [truncated ${value.length - max} chars]`
    : value;
}

function buildEntry(input: LogErrorInput): ErrorLogEntry {
  const err = input.error;
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? truncate(err.stack, STACK_MAX) : null;

  return {
    timestamp: new Date().toISOString(),
    process: input.process,
    namespace: input.namespace ?? null,
    userInput: input.userInput != null ? truncate(input.userInput, USER_INPUT_MAX) : null,
    message,
    stack,
    ...(input.method ? { method: input.method } : {}),
    ...(input.path ? { path: input.path } : {}),
    ...(input.statusCode != null ? { statusCode: input.statusCode } : {}),
  };
}

/**
 * Append a structured error entry to the log file. Swallows its own failures
 * (writes them to stderr only) so it is safe to call from any catch block.
 */
export async function logError(input: LogErrorInput): Promise<void> {
  try {
    await appendFile(errorLogPath, JSON.stringify(buildEntry(input)) + '\n', 'utf-8');
  } catch (writeErr) {
    // Never let a logging failure mask the original error or crash a request.
    process.stderr.write(`[error-log] failed to write entry: ${String(writeErr)}\n`);
  }
}

/**
 * Synchronous variant for process-crash handlers, where the write must land
 * before the process exits. Same swallow-and-continue guarantee as logError.
 */
export function logErrorSync(input: LogErrorInput): void {
  try {
    appendFileSync(errorLogPath, JSON.stringify(buildEntry(input)) + '\n', 'utf-8');
  } catch (writeErr) {
    process.stderr.write(`[error-log] failed to write entry: ${String(writeErr)}\n`);
  }
}

/**
 * Register process-level handlers so crashes and stray rejections reach the log.
 * Call once at the application entry point, after setErrorLogPath.
 *
 * - unhandledRejection: logged; the process keeps running (a stray rejection
 *   should not take the whole API down).
 * - uncaughtException: logged synchronously, then the process exits 1 —
 *   preserving Node's default crash semantics (the process state is unsafe).
 */
export function registerProcessErrorHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    void logError({ process: 'unhandledRejection', error: reason });
  });
  process.on('uncaughtException', (err) => {
    logErrorSync({ process: 'uncaughtException', error: err });
    process.stderr.write(`Uncaught exception: ${String(err)}\n`);
    process.exit(1);
  });
}

/**
 * Read the most recent error entries, newest first. Malformed lines are skipped;
 * a missing file yields an empty array.
 */
export async function readErrorEntries(limit = 500): Promise<ErrorLogEntry[]> {
  let raw: string;
  try {
    raw = await readFile(errorLogPath, 'utf-8');
  } catch {
    return []; // file doesn't exist yet
  }

  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 500;
  const lastLines = lines.slice(-safeLimit);

  const entries: ErrorLogEntry[] = [];
  for (const line of lastLines) {
    try {
      entries.push(JSON.parse(line) as ErrorLogEntry);
    } catch {
      // skip malformed line
    }
  }
  entries.reverse(); // newest first
  return entries;
}

// ── Request extractors (best-effort, used by the global error handler) ────────

/** Pull a `namespace` string from the request body, query, or params. */
export function namespaceFromReq(req: FastifyRequest): string | null {
  const fromField = (obj: unknown): string | null => {
    if (obj && typeof obj === 'object' && 'namespace' in obj) {
      const ns = (obj as Record<string, unknown>).namespace;
      if (typeof ns === 'string' && ns.trim()) return ns.trim();
    }
    return null;
  };
  return fromField(req.body) ?? fromField(req.query) ?? fromField(req.params);
}

/** Best-effort user input: the salient text field, else the JSON body. */
export function userInputFromReq(req: FastifyRequest): string | null {
  const body = req.body;
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  for (const key of ['message', 'prompt', 'question', 'agent']) {
    const v = record[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  try {
    return JSON.stringify(record);
  } catch {
    return null;
  }
}
