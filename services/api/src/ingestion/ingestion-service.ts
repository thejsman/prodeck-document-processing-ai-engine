/**
 * Ingestion service — reads and writes per-namespace files.json metadata.
 *
 * Storage: <workdir>/namespaces/<namespace>/files.json
 *
 * All functions use a read-modify-write pattern. Safe for single-process use
 * (no file locking required).
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IngestionStatus = 'uploaded' | 'processing' | 'indexed' | 'failed';

export interface IngestionFile {
  fileName: string;
  size: number;
  uploadedAt: string;
  status: IngestionStatus;
  error?: string;
  /** Storage URI for stream-uploaded files (local:// or s3://). */
  uri?: string;
  /** Stable job ID returned to the client for status polling. */
  jobId?: string;
  /** Set after successful ingestion: number of text chunks stored in FAISS. */
  chunkCount?: number;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function filesIndexPath(workdir: string, namespace: string): string {
  return path.join(workdir, 'namespaces', namespace, 'files.json');
}

// ---------------------------------------------------------------------------
// Core CRUD
// ---------------------------------------------------------------------------

export async function loadFilesIndex(
  workdir: string,
  namespace: string,
): Promise<IngestionFile[]> {
  try {
    const raw = await readFile(filesIndexPath(workdir, namespace), 'utf-8');
    return JSON.parse(raw) as IngestionFile[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function saveFilesIndex(
  workdir: string,
  namespace: string,
  files: IngestionFile[],
): Promise<void> {
  const filePath = filesIndexPath(workdir, namespace);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(files, null, 2), 'utf-8');
}

export async function upsertFile(
  workdir: string,
  namespace: string,
  file: IngestionFile,
): Promise<void> {
  const files = await loadFilesIndex(workdir, namespace);
  const idx = files.findIndex((f) => f.fileName === file.fileName);
  if (idx >= 0) {
    files[idx] = file;
  } else {
    files.push(file);
  }
  await saveFilesIndex(workdir, namespace, files);
}

export async function updateFileStatus(
  workdir: string,
  namespace: string,
  fileName: string,
  status: IngestionStatus,
  error?: string,
): Promise<void> {
  const files = await loadFilesIndex(workdir, namespace);
  const idx = files.findIndex((f) => f.fileName === fileName);
  if (idx < 0) return; // file not tracked — skip silently
  files[idx] = {
    ...files[idx],
    status,
    ...(error !== undefined ? { error } : { error: undefined }),
  };
  await saveFilesIndex(workdir, namespace, files);
}

export async function updateFileChunkCount(
  workdir: string,
  namespace: string,
  fileName: string,
  chunkCount: number,
): Promise<void> {
  const files = await loadFilesIndex(workdir, namespace);
  const idx = files.findIndex((f) => f.fileName === fileName);
  if (idx < 0) return;
  files[idx] = { ...files[idx], chunkCount };
  await saveFilesIndex(workdir, namespace, files);
}

export async function removeFileEntry(
  workdir: string,
  namespace: string,
  fileName: string,
): Promise<void> {
  const files = await loadFilesIndex(workdir, namespace);
  const filtered = files.filter((f) => f.fileName !== fileName);
  await saveFilesIndex(workdir, namespace, filtered);
}

// ---------------------------------------------------------------------------
// Recovery helper — called on server startup
// ---------------------------------------------------------------------------

/**
 * Scans all namespace files.json files. Any entry with status 'uploaded' or
 * 'processing' is reset to 'uploaded' and re-enqueued so interrupted jobs are
 * not permanently stuck.
 */
export async function recoverInterruptedJobs(
  workdir: string,
  enqueue: (namespace: string, fileName: string) => void,
): Promise<void> {
  const nsRoot = path.join(workdir, 'namespaces');
  let namespaces: string[];
  try {
    namespaces = await readdir(nsRoot);
  } catch {
    return; // no namespaces dir yet
  }

  for (const ns of namespaces) {
    const files = await loadFilesIndex(workdir, ns);
    let changed = false;
    for (const file of files) {
      if (file.status === 'uploaded' || file.status === 'processing') {
        file.status = 'uploaded';
        delete file.error;
        enqueue(ns, file.fileName);
        changed = true;
      }
    }
    if (changed) {
      await saveFilesIndex(workdir, ns, files);
    }
  }
}
