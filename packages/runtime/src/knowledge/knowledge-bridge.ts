/**
 * Knowledge bridge — programmatic interface to the FAISS-backed
 * knowledge store.  Delegates to `knowledge_store.py` via the
 * same JSON-over-stdin protocol the CLI used to call inline.
 *
 * Lives in runtime because it performs side effects (subprocess,
 * file system reads).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VectorStoreConfig {
  type: 'faiss' | 'qdrant';
  /** Qdrant base URL (e.g. "http://localhost:6333"). Required when type=qdrant. */
  url?: string;
  /** Qdrant Cloud API key. Optional — local Docker setups work without it. */
  apiKey?: string;
}

export interface IngestParams {
  readonly documents: ReadonlyArray<{ fileName: string; content: string }>;
  readonly storageDir: string;
  readonly namespace: string;
  /** When provided, overrides the default FAISS backend. */
  readonly vectorStoreConfig?: VectorStoreConfig;
}

export interface IngestResult {
  readonly documents: number;
  readonly chunks: number;
  readonly provider?: string;
}

export interface QueryParams {
  readonly question: string;
  readonly storageDir: string;
  readonly namespace: string;
  readonly stream?: boolean;
  readonly onChunk?: (chunk: string) => void;
  readonly vectorStoreConfig?: VectorStoreConfig;
}

export interface QueryResult {
  readonly answer: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function pythonScriptDir(): string {
  // Resolve relative to this file (dist/knowledge/knowledge-bridge.js → ../../../.. = project root)
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, '../../../../plugins/processor-local-faiss-rag');
}

function resolvePython(scriptDir: string): string {
  const venvUnix = path.join(scriptDir, '.venv', 'bin', 'python3');
  if (existsSync(venvUnix)) return venvUnix;
  const venvWin = path.join(scriptDir, '.venv', 'Scripts', 'python.exe');
  if (existsSync(venvWin)) return venvWin;
  // On Windows 'python3' may resolve to a stub or a different install without
  // the required packages; 'python' is the standard Windows executable name.
  // path.sep is '\' on Windows, '/' on Unix — use it as a platform check.
  return path.sep === '\\' ? 'python' : 'python3';
}

function spawnKnowledgeStore(
  payload: unknown,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const scriptDir = pythonScriptDir();
    const scriptPath = path.join(scriptDir, 'knowledge_store.py');

    const child = spawn(resolvePython(scriptDir), [scriptPath], {
      cwd: scriptDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn python3: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        let errorMessage = `Python process exited with code ${code}`;
        if (stderr) {
          try {
            const parsed = JSON.parse(stderr) as { error?: string; type?: string };
            const msg = parsed.error || '';
            errorMessage = msg || (parsed.type ? `${parsed.type} (no message)` : errorMessage);
          } catch {
            const clean = sanitizePythonStderr(stderr);
            errorMessage = clean || errorMessage;
          }
        }
        reject(new Error(errorMessage));
      } else {
        resolve({ stdout, stderr });
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

// Extract a clean error message from Python stderr.
// If there's a traceback, return only the final exception line (e.g. "ModuleNotFoundError: No module named 'faiss'").
// Otherwise strip urllib3/deprecation warning noise and return what remains.
function sanitizePythonStderr(raw: string): string {
  const lines = raw.split('\n');

  // If there's a traceback, find the last non-empty line after all the frame lines.
  if (lines.some((l) => l.startsWith('Traceback (most recent call last):'))) {
    // Traceback frame lines are: "Traceback...", "  File ...", "    <code>", warning noise.
    // The actual exception is the last non-empty line that isn't a frame line.
    const exceptionLine = [...lines].reverse().find((l) => {
      const t = l.trim();
      if (!t) return false;
      if (t.startsWith('Traceback (most recent call last):')) return false;
      if (/^File "/.test(t)) return false;
      if (/^\/.*\.py:\d+:/.test(t)) return false;
      if (/^\^\s*$/.test(t)) return false; // caret pointer lines
      if (/^(DeprecationWarning|UserWarning|FutureWarning|RuntimeWarning):/.test(t)) return false;
      if (/warnings\.warn\(/.test(t)) return false;
      return true;
    });
    return exceptionLine?.trim() ?? '';
  }

  // No traceback — strip warning noise, return remaining lines.
  const meaningful = lines.filter((line) => {
    const t = line.trim();
    if (!t) return false;
    if (/^\/.*\.py:\d+:/.test(t)) return false;
    if (/^\s*(DeprecationWarning|UserWarning|FutureWarning|RuntimeWarning|PendingDeprecationWarning):/.test(t)) return false;
    if (/warnings\.warn\(/.test(t)) return false;
    return true;
  });
  return meaningful.join('\n').trim();
}

// Sentinel written by knowledge_store.py after streaming all tokens, before
// the final result JSON.  Must match knowledge_store.STREAM_SENTINEL exactly.
const STREAM_SENTINEL = '\n<<<RESULT_JSON>>>\n';

function spawnKnowledgeStoreStreaming(
  payload: unknown,
  onChunk: (chunk: string) => void,
): Promise<QueryResult> {
  return new Promise((resolve, reject) => {
    const scriptDir = pythonScriptDir();
    const scriptPath = path.join(scriptDir, 'knowledge_store.py');

    const child = spawn(resolvePython(scriptDir), [scriptPath], {
      cwd: scriptDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // All stdout received so far.
    let accumulated = '';
    // How many characters of `accumulated` have already been emitted as tokens.
    let emittedUpTo = 0;
    // Set to the index of the sentinel once found (-1 = not yet found).
    let sentinelAt = -1;
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      accumulated += data.toString();

      // Once the sentinel has been found, stop emitting token chunks.
      if (sentinelAt !== -1) return;

      sentinelAt = accumulated.indexOf(STREAM_SENTINEL);

      if (sentinelAt !== -1) {
        // Emit any token text before the sentinel that hasn't been sent yet.
        const tokenEnd = sentinelAt;
        if (tokenEnd > emittedUpTo) {
          onChunk(accumulated.slice(emittedUpTo, tokenEnd));
          emittedUpTo = tokenEnd;
        }
      } else {
        // Sentinel not yet found.  Emit up to SENTINEL.length-1 chars before
        // the tail so we don't accidentally split a sentinel across two chunks.
        const safeEnd = Math.max(emittedUpTo, accumulated.length - (STREAM_SENTINEL.length - 1));
        if (safeEnd > emittedUpTo) {
          onChunk(accumulated.slice(emittedUpTo, safeEnd));
          emittedUpTo = safeEnd;
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn python3: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        let errorMessage = `Python process exited with code ${code}`;
        if (stderr) {
          try {
            const parsed = JSON.parse(stderr) as { error?: string; type?: string };
            const msg = parsed.error || '';
            errorMessage = msg || (parsed.type ? `${parsed.type} (no message)` : errorMessage);
          } catch {
            const clean = sanitizePythonStderr(stderr);
            errorMessage = clean || errorMessage;
          }
        }
        reject(new Error(errorMessage));
        return;
      }

      // On clean exit: resolve the final sentinel index, emit any remaining
      // token text, then parse the JSON that follows the sentinel.
      const finalSentinelAt = accumulated.indexOf(STREAM_SENTINEL);

      if (finalSentinelAt !== -1) {
        // Emit anything between emittedUpTo and the sentinel.
        if (finalSentinelAt > emittedUpTo) {
          onChunk(accumulated.slice(emittedUpTo, finalSentinelAt));
        }
        const jsonStr = accumulated.slice(finalSentinelAt + STREAM_SENTINEL.length);
        try {
          const parsed = JSON.parse(jsonStr) as { result: { answer: string } };
          resolve(parsed.result);
        } catch {
          // Fallback: reconstruct from accumulated tokens.
          resolve({ answer: accumulated.slice(0, finalSentinelAt) });
        }
      } else {
        // No sentinel — the provider didn't stream (e.g. non-streaming fallback).
        // Emit any remaining text and try to parse as JSON.
        if (accumulated.length > emittedUpTo) {
          onChunk(accumulated.slice(emittedUpTo));
        }
        try {
          const parsed = JSON.parse(accumulated) as { result: { answer: string } };
          resolve(parsed.result);
        } catch {
          resolve({ answer: accumulated });
        }
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function ingestDocuments(
  params: IngestParams,
): Promise<IngestResult> {
  const payload = {
    operation: 'ingest',
    storageDir: params.storageDir,
    namespace: params.namespace,
    documents: params.documents,
    ...(params.vectorStoreConfig ? { vectorStore: params.vectorStoreConfig } : {}),
  };

  const { stdout } = await spawnKnowledgeStore(payload);
  const parsed = JSON.parse(stdout) as {
    result: { documents: number; chunks: number };
  };

  return parsed.result;
}

export async function queryKnowledgeBase(
  params: QueryParams,
): Promise<QueryResult> {
  const payload = {
    operation: 'query',
    storageDir: params.storageDir,
    namespace: params.namespace,
    question: params.question,
    stream: params.stream ?? false,
    ...(params.vectorStoreConfig ? { vectorStore: params.vectorStoreConfig } : {}),
  };

  if (params.stream && params.onChunk) {
    // spawnKnowledgeStoreStreaming emits token chunks via onChunk and returns
    // the parsed QueryResult once the sentinel + JSON have been received.
    return spawnKnowledgeStoreStreaming(payload, params.onChunk);
  }

  const { stdout } = await spawnKnowledgeStore(payload);
  const parsed = JSON.parse(stdout) as {
    result: { answer: string };
  };

  return parsed.result;
}

// ---------------------------------------------------------------------------
// Vector-store search (raw chunks, no generation)
// ---------------------------------------------------------------------------

export interface SearchChunksParams {
  readonly question: string;
  readonly storageDir: string;
  readonly namespace: string;
  readonly topK?: number;
  readonly vectorStoreConfig?: VectorStoreConfig;
}

export interface RetrievedChunk {
  readonly text: string;
  readonly score: number;
  /** Document filename — present when the namespace was ingested with source metadata. */
  readonly document?: string;
}

export interface SearchChunksResult {
  readonly chunks: ReadonlyArray<RetrievedChunk>;
}

/**
 * Embed the question in Python and return raw FAISS search results.
 *
 * Unlike queryKnowledgeBase, this operation does NOT invoke an LLM to
 * generate an answer — it returns the top-k matching chunks with their
 * cosine-similarity scores so the caller can decide how to use them.
 */
export async function searchKnowledgeChunks(
  params: SearchChunksParams,
): Promise<SearchChunksResult> {
  const payload = {
    operation: 'search',
    storageDir: params.storageDir,
    namespace: params.namespace,
    question: params.question,
    topK: params.topK ?? 5,
    ...(params.vectorStoreConfig ? { vectorStore: params.vectorStoreConfig } : {}),
  };

  const { stdout } = await spawnKnowledgeStore(payload);
  const parsed = JSON.parse(stdout) as { result: SearchChunksResult };
  return parsed.result;
}

// ---------------------------------------------------------------------------
// Qdrant-specific bridge operations
// ---------------------------------------------------------------------------

export interface DeleteNamespaceParams {
  readonly storageDir: string;
  readonly namespace: string;
  readonly vectorStoreConfig?: VectorStoreConfig;
}

/**
 * Delete all vector data for a namespace.
 * For Qdrant: drops the collection.
 * For FAISS: removes index.faiss and chunks.json (handled by FaissVectorStoreProvider).
 */
export async function deleteNamespace(
  params: DeleteNamespaceParams,
): Promise<void> {
  const payload = {
    operation: 'delete_namespace',
    storageDir: params.storageDir,
    namespace: params.namespace,
    ...(params.vectorStoreConfig ? { vectorStore: params.vectorStoreConfig } : {}),
  };
  await spawnKnowledgeStore(payload);
}

export interface NamespaceStatsParams {
  readonly storageDir: string;
  readonly namespace: string;
  readonly vectorStoreConfig?: VectorStoreConfig;
}

/**
 * Return vector count for a namespace via the Python store.
 * Used by QdrantVectorStoreProvider.namespaceStats().
 */
export async function namespaceStats(
  params: NamespaceStatsParams,
): Promise<{ vectorCount: number; sizeBytes?: number }> {
  const payload = {
    operation: 'namespace_stats',
    storageDir: params.storageDir,
    namespace: params.namespace,
    ...(params.vectorStoreConfig ? { vectorStore: params.vectorStoreConfig } : {}),
  };
  const { stdout } = await spawnKnowledgeStore(payload);
  const parsed = JSON.parse(stdout) as { result: { vectorCount: number } };
  return parsed.result;
}

export async function listNamespaces(workdir: string): Promise<string[]> {
  const namespacesDir = path.join(workdir, 'namespaces');

  try {
    const entries = await readdir(namespacesDir, { withFileTypes: true });
    const namespaces: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      if (await isValidNamespace(namespacesDir, entry.name)) {
        namespaces.push(entry.name);
      }
    }

    return namespaces.sort();
  } catch {
    // namespaces directory doesn't exist yet.
    return [];
  }
}

async function isValidNamespace(
  namespacesDir: string,
  name: string,
): Promise<boolean> {
  const nsDir = path.join(namespacesDir, name);

  // Has a FAISS index (ingested namespace).
  try {
    const s = await stat(path.join(nsDir, 'index.faiss'));
    if (s.isFile()) return true;
  } catch { /* not present */ }

  // Has an uploads/ subdirectory (explicitly created namespace).
  try {
    const s = await stat(path.join(nsDir, 'uploads'));
    if (s.isDirectory()) return true;
  } catch { /* not present */ }

  return false;
}
