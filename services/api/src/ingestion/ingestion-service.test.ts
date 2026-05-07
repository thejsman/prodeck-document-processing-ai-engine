import { describe, it, expect } from 'vitest';
import { computeLegacyStatus } from './ingestion-service.js';
import type { IngestionFile } from './ingestion-service.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function file(
  indexingStatus: IngestionFile['indexingStatus'],
  extractionStatus: IngestionFile['extractionStatus'],
): IngestionFile {
  return {
    fileName: 'test.pdf',
    size: 1024,
    uploadedAt: new Date().toISOString(),
    indexingStatus,
    extractionStatus,
  };
}

// ---------------------------------------------------------------------------
// computeLegacyStatus — status derivation rules
// ---------------------------------------------------------------------------

describe('computeLegacyStatus', () => {
  // ── failed wins ────────────────────────────────────────────────────
  it('returns "failed" when indexingStatus is failed', () => {
    expect(computeLegacyStatus(file('failed', 'pending'))).toBe('failed');
    expect(computeLegacyStatus(file('failed', 'extracted'))).toBe('failed');
    expect(computeLegacyStatus(file('failed', 'skipped'))).toBe('failed');
  });

  it('returns "failed" when extractionStatus is failed', () => {
    expect(computeLegacyStatus(file('indexed', 'failed'))).toBe('failed');
    expect(computeLegacyStatus(file('pending', 'failed'))).toBe('failed');
  });

  it('returns "failed" when both statuses are failed', () => {
    expect(computeLegacyStatus(file('failed', 'failed'))).toBe('failed');
  });

  // ── extracted ──────────────────────────────────────────────────────
  it('returns "extracted" when extractionStatus is extracted (and indexing not failed)', () => {
    expect(computeLegacyStatus(file('indexed', 'extracted'))).toBe('extracted');
    expect(computeLegacyStatus(file('processing', 'extracted'))).toBe('extracted');
  });

  // ── extracting ─────────────────────────────────────────────────────
  it('returns "extracting" when indexing is done but extraction is still processing', () => {
    expect(computeLegacyStatus(file('indexed', 'processing'))).toBe('extracting');
  });

  // ── indexed ────────────────────────────────────────────────────────
  it('returns "indexed" when indexing is done and extraction is pending/skipped', () => {
    expect(computeLegacyStatus(file('indexed', 'pending'))).toBe('indexed');
    expect(computeLegacyStatus(file('indexed', 'skipped'))).toBe('indexed');
  });

  // ── processing ─────────────────────────────────────────────────────
  it('returns "processing" when indexingStatus is processing', () => {
    expect(computeLegacyStatus(file('processing', 'pending'))).toBe('processing');
    expect(computeLegacyStatus(file('processing', 'processing'))).toBe('processing');
  });

  it('returns "processing" when extractionStatus is processing (indexing pending)', () => {
    expect(computeLegacyStatus(file('pending', 'processing'))).toBe('processing');
  });

  // ── uploaded (default) ─────────────────────────────────────────────
  it('returns "uploaded" when both are pending (initial state)', () => {
    expect(computeLegacyStatus(file('pending', 'pending'))).toBe('uploaded');
  });

  it('returns "uploaded" when indexing pending and extraction skipped', () => {
    expect(computeLegacyStatus(file('pending', 'skipped'))).toBe('uploaded');
  });

  // ── priority ordering ──────────────────────────────────────────────
  it('failed takes priority over extracted', () => {
    // indexing failed even though extraction succeeded
    expect(computeLegacyStatus(file('failed', 'extracted'))).toBe('failed');
  });

  it('extracted takes priority over extracting (not possible in practice but rule holds)', () => {
    // extracted wins over the indexed+processing check because it's checked first
    expect(computeLegacyStatus(file('indexed', 'extracted'))).toBe('extracted');
  });
});
