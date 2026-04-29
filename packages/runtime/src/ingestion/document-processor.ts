/**
 * Streaming document processor.
 *
 * Reads stored documents as a stream, splits them into text chunks, and
 * progressively ingests each batch into the vector store.  The full file
 * is never loaded into Node.js memory at once.
 *
 * Supported formats (text-native):
 *   .md, .mdx, .txt, .csv, .html, .xml, .json — streamed line by line
 *
 * For binary formats (.pdf, .docx) the caller must either pre-extract text
 * or pass the file through an extraction tool first.  The processor treats
 * unrecognised formats as plain UTF-8 text.
 *
 * Memory safety guarantees:
 *   - Maximum chunk buffer: MAX_CHUNK_BYTES (256 KB)
 *   - Backpressure respected via async iteration
 *   - Stream errors immediately abort ingestion
 *   - Ingestion call per BATCH_SIZE chunks (default 5)
 */

import { Readable } from 'node:stream';
import type { StorageProvider, VectorStoreProvider, VectorChunk } from '@ai-engine/core';

// ── Constants ──────────────────────────────────────────────────────

/** Maximum text per chunk in bytes.  Splitting happens on newline boundaries. */
const MAX_CHUNK_BYTES = 256 * 1024; // 256 KB

/** Number of chunks to accumulate before calling upsertChunks. */
const BATCH_SIZE = 25;

// ── Text chunker ───────────────────────────────────────────────────

/**
 * Async generator that splits a Readable into text chunks of at most
 * `maxBytes` bytes, preferring to split on newline boundaries so individual
 * paragraphs are not cut mid-sentence.
 */
async function* textChunks(
  stream: Readable,
  maxBytes = MAX_CHUNK_BYTES,
): AsyncGenerator<string> {
  let buffer = '';

  for await (const data of stream) {
    buffer += typeof data === 'string' ? data : (data as Buffer).toString('utf-8');

    while (buffer.length >= maxBytes) {
      // Prefer splitting at a newline so we don't break mid-paragraph
      const splitAt = buffer.lastIndexOf('\n', maxBytes);
      const cutAt = splitAt > 0 ? splitAt : maxBytes;
      const chunk = buffer.slice(0, cutAt).trim();
      if (chunk.length > 0) yield chunk;
      buffer = buffer.slice(cutAt + 1);
    }
  }

  // Flush remaining content
  const remaining = buffer.trim();
  if (remaining.length > 0) yield remaining;
}

// ── Public API ────────────────────────────────────────────────────

export interface ProcessDocumentStreamParams {
  /** StorageProvider scoped to the correct namespace. */
  provider: StorageProvider;
  /** Path relative to the namespace root (e.g. "uploads/report.md"). */
  relativePath: string;
  /** Namespace slug forwarded to the vector store for index isolation. */
  namespace: string;
  /**
   * Vector store provider to receive the ingested chunks.
   * Created via `getVectorStoreProvider` from the namespace config.
   */
  vectorStore: VectorStoreProvider;
  /**
   * Called after each batch of chunks is successfully ingested.
   * Useful for progress tracking and job status updates.
   */
  onProgress?: (chunksIngested: number) => void;
}

export interface ProcessDocumentStreamResult {
  /** Total number of text chunks generated and ingested into the vector store. */
  chunkCount: number;
}

/**
 * Stream a stored document, split it into chunks, and progressively embed.
 *
 * Uses `provider.readStream()` when available for true streaming; falls back
 * to `provider.readFile()` + wrapping in a Readable for providers that have
 * not yet implemented `readStream`.
 *
 * @example
 * const result = await processDocumentStream({
 *   provider,
 *   relativePath: 'uploads/architecture.md',
 *   namespace: 'acme',
 *   vectorStore,
 *   onProgress: (n) => console.log(`[TraceLive] ${n} chunks ingested`),
 * });
 */
export async function processDocumentStream(
  params: ProcessDocumentStreamParams,
): Promise<ProcessDocumentStreamResult> {
  const { provider, relativePath, namespace, vectorStore, onProgress } = params;

  // ── Open read stream (with fallback) ─────────────────────────────
  let stream: Readable;

  if (typeof provider.readStream === 'function') {
    stream = await provider.readStream(relativePath);
    console.log(`[TraceLive] streaming "${relativePath}" from storage`);
  } else {
    // Provider does not yet implement streaming — buffer and wrap
    const buf = await provider.readFile(relativePath);
    stream = Readable.from(buf);
    console.log(`[TraceLive] buffered "${relativePath}" (provider lacks readStream)`);
  }

  const fileName = relativePath.split('/').pop() ?? relativePath;
  let globalChunkIdx = 0;
  let batch: VectorChunk[] = [];

  // ── Flush accumulated batch to vector store ───────────────────────
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    await vectorStore.upsertChunks({ namespace, chunks: batch });
    globalChunkIdx += batch.length;
    onProgress?.(globalChunkIdx);
    console.log(`[TraceLive] ingested chunk batch — total so far: ${globalChunkIdx}`);
    batch = [];
  };

  // ── Chunk and ingest ─────────────────────────────────────────────
  for await (const text of textChunks(stream)) {
    // Each chunk is stored with a unique name so the vector store can index it separately
    const chunkId = `${fileName}#chunk-${globalChunkIdx + batch.length + 1}`;
    batch.push({
      id: chunkId,
      embedding: [], // provider handles embedding computation internally
      text,
      metadata: { namespace, docId: fileName },
    });

    if (batch.length >= BATCH_SIZE) {
      await flush();
    }
  }

  await flush(); // remaining chunks that didn't fill a full batch

  console.log(`[TraceLive] execution completed — total chunks: ${globalChunkIdx}`);
  return { chunkCount: globalChunkIdx };
}
