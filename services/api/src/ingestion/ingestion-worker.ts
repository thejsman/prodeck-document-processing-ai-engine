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
import { emitExecution, emitExtractionReady, type ExtractionReadyPayload } from '../execution-events.js';
import { PendingExtractionService } from './pending-extraction.service.js';
import { detectConflicts } from './conflict-detector.js';
import {
  workflowEventBus,
  type IngestionCompletedEvent,
  type IngestionFailedEvent,
} from '../workflows/workflow-event-bus.js';
import type { IngestionJob } from './ingestion-queue.js';
import { processDocument } from './ingest-orchestrator.js';
import { ContextService } from '../chat/context.service.js';
import type { PendingExtraction, RequirementKey } from '../chat/context.types.js';
import { llmGenerateFn } from '../agent-routes.js';

const MAX_RETRIES = 2;

const TIER_1_KEYS: RequirementKey[] = ['clientName', 'clientIndustry', 'projectType'];

function buildExtractionReadyPayload(namespace: string, pending: PendingExtraction): ExtractionReadyPayload {
  const fields = pending.fields ?? {};
  const conflicts = pending.conflicts ?? [];

  const extractedFields = Object.entries(fields).map(([rawKey, field]) => {
    const key = rawKey as RequirementKey;
    const conflict = conflicts.find((c) => c.key === key);
    return { key, value: field?.value, confidence: field?.confidence ?? 0, ...(conflict ? { conflict } : {}) };
  });

  const highCount = extractedFields.filter((f) => f.confidence >= 0.8).length;
  const lowCount = extractedFields.filter((f) => f.confidence < 0.8).length;
  const notFoundFields = TIER_1_KEYS.filter((k) => !fields[k]);

  return {
    cardId: pending.cardId,
    namespace,
    fileName: pending.fileName,
    classification: pending.classification ?? 'client_source',
    extractedFields,
    knowledgeEntryCount: pending.knowledgeEntries?.length ?? 0,
    highConfidenceCount: highCount,
    lowConfidenceCount: lowCount,
    notFoundFields,
    expiresAt: pending.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

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

  // Read namespace config to resolve the correct vector store backend
  const configLoader = createNodeConfigLoader(path.join(workdir, 'config'));
  const configResolver = new ConfigResolver(configLoader);
  const config = await configResolver.resolve({ namespace });
  const rawVs = (config as { vectorStore?: { type?: string; url?: string; apiKey?: string } }).vectorStore;
  const vectorStoreConfig = (rawVs?.type === 'faiss' || rawVs?.type === 'qdrant')
    ? { type: rawVs.type as 'faiss' | 'qdrant', url: rawVs.url, ...(rawVs.apiKey ? { apiKey: rawVs.apiKey } : {}) }
    : undefined;

  const documents: { fileName: string; content: string }[] = [];
  for (const f of filesToIndex) {
    const filePath = path.join(uploadsDir, f);
    const ext = path.extname(f).toLowerCase();
    let content: string;
    if (ext === '.pdf') {
      const { default: pdfParse } = await import('pdf-parse');
      const buf = await readFile(filePath);
      const parsed = await pdfParse(buf);
      content = parsed.text;
    } else {
      content = await readFile(filePath, 'utf-8');
    }
    documents.push({ fileName: f, content });
  }

  if (policyConfig) {
    const policy = resolvePolicy(policyConfig, namespace, 'ingest');
    await executeWithPolicy(
      policy,
      () => ingestDocuments({ documents, storageDir, namespace, vectorStoreConfig }),
    );
  } else {
    await ingestDocuments({ documents, storageDir, namespace, vectorStoreConfig });
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

  const vectorStore = getVectorStoreProvider({ namespace, config: config as Record<string, unknown>, workdir });

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
      let chunkCount = 0;

      if (uri) {
        // Stream path — large file progressive ingestion
        chunkCount = await processStreamJob(job, workdir);
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

      // ── Ingest V2: context enrichment pipeline ──────────────────
      if (process.env.INGEST_V2 === 'true') {
        const contextService = new ContextService(workdir);
        const uploadsDir = path.join(workdir, 'namespaces', namespace, 'uploads');
        const filesToProcess = allFiles ?? [fileName];

        for (const f of filesToProcess) {
          await updateFileStatus(workdir, namespace, f, 'extracting');
        }

        for (const f of filesToProcess) {
          try {
            const ext = path.extname(f).toLowerCase();
            let content: string;
            if (ext === '.pdf') {
              const { default: pdfParse } = await import('pdf-parse');
              const buf = await readFile(path.join(uploadsDir, f));
              const parsed = await pdfParse(buf);
              content = parsed.text;
            } else {
              content = await readFile(path.join(uploadsDir, f), 'utf-8');
            }
            console.log(`[IngestV2] starting pipeline — ${namespace}/${f} (${content.length} chars)`);
            const v2t0 = Date.now();
            const deferConfirmation = process.env.EXTRACTION_CONFIRMATION === 'true';
            const v2Result = await processDocument(namespace, f, content, llmGenerateFn, contextService, undefined, job.classification, deferConfirmation);
            console.log(`[IngestV2] finished pipeline — ${namespace}/${f} | type=${v2Result.documentType} fields=${v2Result.fieldsExtracted.length} knowledge=${v2Result.knowledgeEntriesCreated} duration=${v2Result.durationMs}ms total=${Date.now() - v2t0}ms`);

            await updateFileStatus(workdir, namespace, f, 'extracted');

            emitExecution({
              executionId: `doc-processed-${namespace}-${f}-${Date.now()}`,
              status: 'COMPLETED',
              type: 'document_processed',
              title: f,
              message: JSON.stringify({
                fileName: v2Result.fileName,
                type: v2Result.documentType,
                fieldsExtracted: v2Result.fieldsExtracted,
                knowledgeEntries: v2Result.knowledgeEntriesCreated,
              }),
            });

            if (deferConfirmation) {
              // EXTRACTION_CONFIRMATION=true: store pending + emit extraction_ready
              // Nothing written to context.json until user confirms.
              const pendingService = new PendingExtractionService(workdir);
              const existing = await contextService.get(namespace);
              const conflicts = detectConflicts(v2Result.extractedFields, existing, f);

              const pendingRecord = await pendingService.store(namespace, {
                documentId: f,
                fileName: f,
                classification: job.classification ?? 'client_source',
                extractedAt: new Date().toISOString(),
                fields: v2Result.extractedFields,
                knowledgeEntries: v2Result.knowledgeEntries,
                conflicts,
              });

              emitExtractionReady(buildExtractionReadyPayload(namespace, pendingRecord));
              console.log(`[IngestV2] extraction_ready emitted — cardId=${pendingRecord.cardId} namespace=${namespace}/${f} fields=${v2Result.fieldsExtracted.length} conflicts=${conflicts.length}`);
            } else if (v2Result.fieldsExtracted.length > 0 || v2Result.knowledgeEntriesCreated > 0) {
              emitExecution({
                executionId: `ctx-updated-${namespace}-${f}-${Date.now()}`,
                status: 'COMPLETED',
                type: 'context_updated',
                title: namespace,
                message: JSON.stringify({
                  fieldsUpdated: v2Result.fieldsExtracted,
                  knowledgeAdded: v2Result.knowledgeEntriesCreated,
                  source: f,
                }),
              });
            }
          } catch (err) {
            console.warn(`[IngestV2] processDocument failed for ${f}:`, err);
            // Leave status as 'indexed' — FAISS search still works even if extraction failed
            await updateFileStatus(workdir, namespace, f, 'indexed');
          }
        }
      }

      // Notify workflow resume service (STEP 2) — fire-and-forget
      const completedEvent: IngestionCompletedEvent = {
        namespace,
        fileName,
        uri: job.uri,
        jobId: job.id,
        chunkCount,
      };
      workflowEventBus.emit('ingestion_completed', completedEvent);

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

  // Notify workflow resume service of failure (STEP 2) — fire-and-forget
  const failedEvent: IngestionFailedEvent = {
    namespace,
    fileName,
    uri: job.uri,
    jobId: job.id,
    error: errorMessage,
  };
  workflowEventBus.emit('ingestion_failed', failedEvent);
}
