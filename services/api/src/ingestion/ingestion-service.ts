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

/** Legacy single-string status — kept for backward-compat with API consumers. */
export type IngestionStatus = 'uploaded' | 'processing' | 'indexed' | 'extracting' | 'extracted' | 'failed';

export type IndexingStatus = 'pending' | 'processing' | 'indexed' | 'failed';
export type ExtractionStatus = 'pending' | 'processing' | 'extracted' | 'skipped' | 'failed';

export interface IngestionFile {
  fileName: string;
  size: number;
  uploadedAt: string;
  /** Dual independent status fields — both branches run concurrently (INGEST_PARALLEL). */
  indexingStatus: IndexingStatus;
  extractionStatus: ExtractionStatus;
  error?: string;
  /** Storage URI for stream-uploaded files (local:// or s3://). */
  uri?: string;
  /** Stable job ID returned to the client for status polling. */
  jobId?: string;
  /** Set after successful ingestion: number of text chunks stored in FAISS. */
  chunkCount?: number;
}

/** Derive legacy single-status from dual fields for backward-compat with polling clients. */
export function computeLegacyStatus(file: IngestionFile): IngestionStatus {
  if (file.indexingStatus === 'failed' || file.extractionStatus === 'failed') return 'failed';
  if (file.extractionStatus === 'extracted') return 'extracted';
  if (file.indexingStatus === 'indexed' && file.extractionStatus === 'processing') return 'extracting';
  if (file.indexingStatus === 'indexed') return 'indexed';
  if (file.indexingStatus === 'processing' || file.extractionStatus === 'processing') return 'processing';
  return 'uploaded';
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
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    // Migrate old entries that only have a single `status` field
    return parsed.map((f) => {
      if (f['indexingStatus'] === undefined) {
        const legacyStatus = (f['status'] as IngestionStatus | undefined) ?? 'uploaded';
        f['indexingStatus'] = legacyStatus === 'failed' ? 'failed'
          : legacyStatus === 'uploaded' || legacyStatus === 'processing' ? legacyStatus === 'processing' ? 'processing' : 'pending'
          : 'indexed';
        f['extractionStatus'] = legacyStatus === 'extracted' ? 'extracted'
          : legacyStatus === 'extracting' ? 'processing'
          : legacyStatus === 'failed' ? 'failed'
          : 'pending';
        delete f['status'];
      }
      return f as unknown as IngestionFile;
    });
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

/** Update file status using the legacy single-status model (sequential path). */
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

  // Map legacy status to dual fields so files.json stays consistent
  const indexingStatus: IndexingStatus =
    status === 'failed' ? 'failed' :
    status === 'processing' ? 'processing' :
    status === 'indexed' || status === 'extracting' || status === 'extracted' ? 'indexed' :
    'pending';

  const extractionStatus: ExtractionStatus =
    status === 'failed' ? 'failed' :
    status === 'extracting' ? 'processing' :
    status === 'extracted' ? 'extracted' :
    files[idx].extractionStatus; // preserve if indexing-only change

  files[idx] = {
    ...files[idx],
    indexingStatus,
    extractionStatus,
    ...(error !== undefined ? { error } : { error: undefined }),
  };
  await saveFilesIndex(workdir, namespace, files);
}

/** Update only the indexing branch status (parallel path). */
export async function updateIndexingStatus(
  workdir: string,
  namespace: string,
  fileName: string,
  status: IndexingStatus,
  error?: string,
): Promise<void> {
  const files = await loadFilesIndex(workdir, namespace);
  const idx = files.findIndex((f) => f.fileName === fileName);
  if (idx < 0) return;
  files[idx] = {
    ...files[idx],
    indexingStatus: status,
    ...(error !== undefined ? { error } : {}),
  };
  await saveFilesIndex(workdir, namespace, files);
}

/** Update only the extraction branch status (parallel path). */
export async function updateExtractionStatus(
  workdir: string,
  namespace: string,
  fileName: string,
  status: ExtractionStatus,
  error?: string,
): Promise<void> {
  const files = await loadFilesIndex(workdir, namespace);
  const idx = files.findIndex((f) => f.fileName === fileName);
  if (idx < 0) return;
  files[idx] = {
    ...files[idx],
    extractionStatus: status,
    ...(error !== undefined ? { error } : {}),
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
    const entries = await readdir(nsRoot, { withFileTypes: true });
    namespaces = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return; // no namespaces dir yet
  }

  for (const ns of namespaces) {
    const files = await loadFilesIndex(workdir, ns);
    let changed = false;
    for (const file of files) {
      const wasInterrupted =
        file.indexingStatus === 'processing' ||
        file.extractionStatus === 'processing' ||
        (file.indexingStatus === 'pending' && file.extractionStatus === 'pending');
      if (wasInterrupted) {
        file.indexingStatus = 'pending';
        file.extractionStatus = 'pending';
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
