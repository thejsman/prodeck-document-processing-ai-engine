/**
 * Ingestion worker — processes a single ingestion job.
 *
 * Two execution paths:
 *
 *   Classic path (job.uri is undefined):
 *     Reads file(s) from the local uploads directory, calls ingestDocuments()
 *     with the full content buffer.  Existing behaviour — unchanged.
 *
 *   Stream path (job.uri is set):
 *     Reads the file as a stream from the storage backend, chunks it
 *     progressively, and ingests each batch into FAISS without buffering
 *     the full file in memory.  Suitable for large uploads (50 MB+).
 *
 * Both paths:
 *   - Emit execution SSE events (RUNNING → COMPLETED / FAILED)
 *   - Retry up to MAX_RETRIES times with exponential backoff
 *   - Update files.json status accordingly
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ingestDocuments,
  processDocumentStream,
  getStorageProvider,
  getVectorStoreProvider,
  resolveStorageUri,
  createNodeConfigLoader,
} from '@ai-engine/runtime';
import { ConfigResolver } from '@ai-engine/core';
import {
  updateFileStatus,
  updateFileChunkCount,
  loadFilesIndex,
} from './ingestion-service.js';
import {
  resolvePolicy,
  executeWithPolicy,
  type ProviderPolicyConfig,
} from '../provider-policy.js';
import { emitExecution } from '../execution-events.js';
import type { IngestionJob } from './ingestion-queue.js';

const MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Classic (buffer) path ─────────────────────────────────────────

async function processBufferJob(
  job: IngestionJob,
  workdir: string,
  policyConfig: ProviderPolicyConfig | null,
): Promise<void> {
  const { namespace, fileName, allFiles } = job;
  const storageDir = path.join(workdir, 'namespaces', namespace);
  const uploadsDir = path.join(storageDir, 'uploads');
  const filesToIndex = allFiles ?? [fileName];

  const documents: { fileName: string; content: string }[] = [];
  for (const f of filesToIndex) {
    const content = await readFile(path.join(uploadsDir, f), 'utf-8');
    documents.push({ fileName: f, content });
  }

  if (policyConfig) {
    const policy = resolvePolicy(policyConfig, namespace, 'ingest');
    await executeWithPolicy(
      policy,
      () => ingestDocuments({ documents, storageDir, namespace }),
    );
  } else {
    await ingestDocuments({ documents, storageDir, namespace });
  }
}

// ── Stream path ───────────────────────────────────────────────────

async function processStreamJob(
  job: IngestionJob,
  workdir: string,
): Promise<number> {
  const { namespace, fileName, uri } = job;
  if (!uri) throw new Error('processStreamJob called without uri');

  const resolved = resolveStorageUri(uri);

  // Build the storage provider for this namespace
  const configLoader = createNodeConfigLoader(path.join(workdir, 'config'));
  const configResolver = new ConfigResolver(configLoader);
  const config = await configResolver.resolve({ namespace });
  const provider = getStorageProvider({ namespace, config, workdir });

  const vectorStore = getVectorStoreProvider({ namespace, config, workdir });

  const { chunkCount } = await processDocumentStream({
    provider,
    relativePath: resolved.relativePath,
    namespace,
    vectorStore,
    onProgress: (n) => {
      console.log(`[TraceLive] step received — ${fileName} chunk ${n}`);
    },
  });

  return chunkCount;
}

// ── Main entry point ──────────────────────────────────────────────

export async function processJob(
  job: IngestionJob,
  workdir: string,
  policyConfig: ProviderPolicyConfig | null,
): Promise<void> {
  const { namespace, fileName, allFiles, uri } = job;
  const filesToMark = allFiles ?? [fileName];

  // Mark as processing
  for (const f of filesToMark) {
    await updateFileStatus(workdir, namespace, f, 'processing');
  }

  emitExecution({ executionId: job.id, status: 'RUNNING', type: 'ingestion', title: job.fileName });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (uri) {
        // Stream path — large file progressive ingestion
        const chunkCount = await processStreamJob(job, workdir);
        await updateFileStatus(workdir, namespace, fileName, 'indexed');
        await updateFileChunkCount(workdir, namespace, fileName, chunkCount);
      } else {
        // Classic path — existing buffer-based ingestion
        await processBufferJob(job, workdir, policyConfig);
        for (const f of filesToMark) {
          await updateFileStatus(workdir, namespace, f, 'indexed');
        }
      }

      emitExecution({ executionId: job.id, status: 'COMPLETED', type: 'ingestion', title: job.fileName });
      console.log(`[TraceLive] execution completed — job ${job.id}`);
      return; // success
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await sleep(1000 * (attempt + 1));
      }
    }
  }

  // All retries exhausted
  const errorMessage = lastError?.message ?? 'Unknown error';
  for (const f of filesToMark) {
    await updateFileStatus(workdir, namespace, f, 'failed', errorMessage);
  }
  emitExecution({
    executionId: job.id,
    status: 'FAILED',
    type: 'ingestion',
    title: job.fileName,
    message: errorMessage,
  });
}
