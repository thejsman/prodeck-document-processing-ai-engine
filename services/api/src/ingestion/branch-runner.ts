/**
 * branch-runner.ts — parallel ingestion branch coordinator.
 *
 * Runs indexing (vector store) and extraction (LLM pipeline) as independent
 * concurrent branches so neither blocks the other. Both receive the same
 * pre-read document content.
 *
 * Gated by INGEST_PARALLEL=true (default). Legacy sequential path in
 * ingestion-worker.ts is preserved when INGEST_PARALLEL=false.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ingestDocuments, createNodeConfigLoader, nativeQdrantIndex } from '@ai-engine/runtime';
import { ConfigResolver } from '@ai-engine/core';
import {
  updateIndexingStatus,
  updateExtractionStatus,
  updateFileChunkCount,
} from './ingestion-service.js';
import { resolvePolicy, executeWithPolicy, type ProviderPolicyConfig } from '../provider-policy.js';
import {
  emitExecution,
  emitExtractionReady,
  emitIngestionProgress,
  type ExtractionReadyPayload,
} from '../execution-events.js';
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

// ── Helpers ───────────────────────────────────────────────────────

const TIER_1_KEYS: RequirementKey[] = ['clientName', 'clientIndustry', 'projectType'];

function buildExtractionReadyPayload(namespace: string, pending: PendingExtraction): ExtractionReadyPayload {
  const fields = pending.fields ?? {};
  const conflicts = pending.conflicts ?? [];
  const extractedFields = Object.entries(fields).map(([rawKey, field]) => {
    const key = rawKey as RequirementKey;
    const conflict = conflicts.find((c) => c.key === key);
    return { key, value: field?.value, confidence: field?.confidence ?? 0, ...(conflict ? { conflict } : {}) };
  });
  return {
    cardId: pending.cardId,
    namespace,
    fileName: pending.fileName,
    classification: pending.classification ?? 'client_source',
    extractedFields,
    knowledgeEntryCount: pending.knowledgeEntries?.length ?? 0,
    highConfidenceCount: extractedFields.filter((f) => f.confidence >= 0.8).length,
    lowConfidenceCount: extractedFields.filter((f) => f.confidence < 0.8).length,
    notFoundFields: TIER_1_KEYS.filter((k) => !fields[k]),
    expiresAt: pending.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function resolveVectorStoreConfig(workdir: string, namespace: string) {
  const configLoader = createNodeConfigLoader(path.join(workdir, 'config'));
  const configResolver = new ConfigResolver(configLoader);
  const config = await configResolver.resolve({ namespace });
  const rawVs = (config as { vectorStore?: { type?: string; url?: string; apiKey?: string } }).vectorStore;

  if (rawVs?.type === 'faiss' || rawVs?.type === 'qdrant') {
    return { type: rawVs.type as 'faiss' | 'qdrant', url: rawVs.url, apiKey: rawVs.apiKey };
  }

  // Global default via VECTOR_STORE env var (e.g. VECTOR_STORE=qdrant).
  const envType = process.env['VECTOR_STORE'];
  if (envType === 'qdrant') {
    return {
      type: 'qdrant' as const,
      url: process.env['QDRANT_URL'] ?? 'http://localhost:6333',
      apiKey: process.env['QDRANT_API_KEY'],
    };
  }

  return undefined; // defaults to FAISS via Python bridge
}

// ── Read helper ───────────────────────────────────────────────────

/** Read a single upload file into a string (PDF or text). */
export async function readUploadedFile(workdir: string, namespace: string, fileName: string): Promise<string> {
  const filePath = path.join(workdir, 'namespaces', namespace, 'uploads', fileName);
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.pdf') {
    const { default: pdfParse } = await import('pdf-parse');
    const buf = await readFile(filePath);
    const parsed = await pdfParse(buf);
    return parsed.text;
  }
  return readFile(filePath, 'utf-8');
}

// ── Indexing branch ───────────────────────────────────────────────

/**
 * Runs the vector-store indexing branch for a single file.
 * Emits ingestion_progress events and fires ingestion_completed on the
 * workflow event bus when done.
 */
export async function runIndexingBranch(
  documents: { fileName: string; content: string }[],
  job: IngestionJob,
  workdir: string,
  policyConfig: ProviderPolicyConfig | null,
): Promise<void> {
  const { namespace, fileName } = job;
  const storageDir = path.join(workdir, 'namespaces', namespace);

  try {
    await updateIndexingStatus(workdir, namespace, fileName, 'processing');
    emitIngestionProgress({ stage: 'chunking', fileName, namespace });

    const vectorStoreConfig = await resolveVectorStoreConfig(workdir, namespace);

    if (vectorStoreConfig?.type === 'qdrant') {
      // ── Native Node.js path — no Python cold start ────────────────
      const qdrantUrl = vectorStoreConfig.url ?? process.env['QDRANT_URL'] ?? 'http://localhost:6333';
      const qdrantApiKey = vectorStoreConfig.apiKey ?? process.env['QDRANT_API_KEY'];
      const result = await nativeQdrantIndex({
        namespace,
        fileName,
        content: documents[0].content,
        qdrantUrl,
        qdrantApiKey,
        onProgress: (chunksProcessed, totalChunks) => {
          emitIngestionProgress({ stage: 'embedding', fileName, namespace, chunksProcessed, totalChunks });
        },
      });
      await updateFileChunkCount(workdir, namespace, fileName, result.chunks);
    } else {
      // ── Python bridge path (FAISS or Python-Qdrant) ───────────────
      emitIngestionProgress({ stage: 'embedding', fileName, namespace });
      if (policyConfig) {
        const policy = resolvePolicy(policyConfig, namespace, 'ingest');
        await executeWithPolicy(policy, () => ingestDocuments({ documents, storageDir, namespace, vectorStoreConfig }));
      } else {
        await ingestDocuments({ documents, storageDir, namespace, vectorStoreConfig });
      }
    }

    await updateIndexingStatus(workdir, namespace, fileName, 'indexed');

    emitExecution({ executionId: job.id, status: 'COMPLETED', type: 'ingestion', title: fileName });
    console.log(`[IndexingBranch] completed — job ${job.id} namespace=${namespace}/${fileName}`);

    const completedEvent: IngestionCompletedEvent = {
      namespace,
      fileName,
      uri: job.uri,
      jobId: job.id,
      chunkCount: 0,
    };
    workflowEventBus.emit('ingestion_completed', completedEvent);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[IndexingBranch] failed — ${namespace}/${fileName}:`, err);
    await updateIndexingStatus(workdir, namespace, fileName, 'failed', errorMessage);
    emitExecution({
      executionId: job.id,
      status: 'FAILED',
      type: 'ingestion',
      title: fileName,
      message: errorMessage,
    });
    const failedEvent: IngestionFailedEvent = {
      namespace,
      fileName,
      uri: job.uri,
      jobId: job.id,
      error: errorMessage,
    };
    workflowEventBus.emit('ingestion_failed', failedEvent);
  }
}

// ── Extraction branch ─────────────────────────────────────────────

/**
 * Runs the LLM extraction branch for a single file.
 * Gated by INGEST_V2=true. Independent of the indexing branch — a failure
 * here does not affect the indexing result.
 */
export async function runExtractionBranch(
  content: string,
  job: IngestionJob,
  workdir: string,
): Promise<void> {
  if (process.env['INGEST_V2'] !== 'true') {
    await updateExtractionStatus(workdir, job.namespace, job.fileName, 'skipped');
    return;
  }

  const { namespace, fileName } = job;

  try {
    await updateExtractionStatus(workdir, namespace, fileName, 'processing');
    emitIngestionProgress({ stage: 'detecting', fileName, namespace });

    const contextService = new ContextService(workdir);
    const deferConfirmation = process.env['EXTRACTION_CONFIRMATION'] === 'true';

    console.log(`[ExtractionBranch] starting pipeline — ${namespace}/${fileName} (${content.length} chars)`);
    const t0 = Date.now();

    const v2Result = await processDocument(
      namespace,
      fileName,
      content,
      llmGenerateFn,
      contextService,
      undefined,
      job.classification,
      deferConfirmation,
    );

    console.log(`[ExtractionBranch] finished — ${namespace}/${fileName} | type=${v2Result.documentType} fields=${v2Result.fieldsExtracted.length} knowledge=${v2Result.knowledgeEntriesCreated} duration=${Date.now() - t0}ms`);

    emitIngestionProgress({ stage: 'storing', fileName, namespace });
    await updateExtractionStatus(workdir, namespace, fileName, 'extracted');

    emitExecution({
      executionId: `doc-processed-${namespace}-${fileName}-${Date.now()}`,
      status: 'COMPLETED',
      type: 'document_processed',
      title: fileName,
      message: JSON.stringify({
        fileName: v2Result.fileName,
        type: v2Result.documentType,
        fieldsExtracted: v2Result.fieldsExtracted,
        knowledgeEntries: v2Result.knowledgeEntriesCreated,
      }),
    });

    if (deferConfirmation) {
      const pendingService = new PendingExtractionService(workdir);
      const existing = await contextService.get(namespace);
      const conflicts = detectConflicts(v2Result.extractedFields, existing, fileName);
      const pendingRecord = await pendingService.store(namespace, {
        documentId: fileName,
        fileName,
        classification: job.classification ?? 'client_source',
        extractedAt: new Date().toISOString(),
        fields: v2Result.extractedFields,
        knowledgeEntries: v2Result.knowledgeEntries,
        conflicts,
      });
      emitExtractionReady(buildExtractionReadyPayload(namespace, pendingRecord));
      console.log(`[ExtractionBranch] extraction_ready emitted — cardId=${pendingRecord.cardId}`);
    } else if (v2Result.fieldsExtracted.length > 0 || v2Result.knowledgeEntriesCreated > 0) {
      emitExecution({
        executionId: `ctx-updated-${namespace}-${fileName}-${Date.now()}`,
        status: 'COMPLETED',
        type: 'context_updated',
        title: namespace,
        message: JSON.stringify({
          fieldsUpdated: v2Result.fieldsExtracted,
          knowledgeAdded: v2Result.knowledgeEntriesCreated,
          source: fileName,
        }),
      });
    }
  } catch (err) {
    console.warn(`[ExtractionBranch] failed for ${namespace}/${fileName} — indexing result still valid:`, err);
    await updateExtractionStatus(workdir, namespace, job.fileName, 'failed');
    // No emitExecution FAILED here — the indexing branch owns the top-level job status.
  }
}
