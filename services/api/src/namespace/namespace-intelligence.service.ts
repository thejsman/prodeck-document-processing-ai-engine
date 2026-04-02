/**
 * Namespace Intelligence Service — scans namespace state and returns insights.
 *
 * Reads from three sources:
 *   1. files.json  — ingestion status of every uploaded document
 *   2. proposals/  — count of saved proposal draft files
 *   3. Derived metadata — latest activity timestamp
 *
 * Kept pure: no LLM calls, no event emission.
 * Callers decide what to do with the returned NamespaceInsights object.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { loadFilesIndex } from '../ingestion/ingestion-service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NamespaceInsights {
  /** True if at least one file matches common RFP filename patterns. */
  hasRfp: boolean;
  /** True if at least one file matches common pricing/quote filename patterns. */
  hasPricingDoc: boolean;
  /** Number of saved proposal draft .md files in the proposals/ directory. */
  proposalDraftCount: number;
  /** Number of files with status "uploaded" or "processing" (not yet indexed). */
  ingestionPendingCount: number;
  /** Timestamp of the most recently uploaded file, if any. */
  lastActivityAt?: Date;
  /** Total number of indexed documents in the namespace. */
  indexedDocumentCount: number;
}

// ---------------------------------------------------------------------------
// Filename heuristics
// ---------------------------------------------------------------------------

const RFP_PATTERNS = [
  /rfp/i,
  /rfq/i,
  /request[-_\s]?for[-_\s]?proposal/i,
  /request[-_\s]?for[-_\s]?quote/i,
  /tender/i,
  /\bsow\b/i,   // Statement of Work
  /statement[-_\s]?of[-_\s]?work/i,
];

const PRICING_PATTERNS = [
  /pric/i,
  /quote/i,
  /\brate\b/i,
  /rate[-_\s]?card/i,
  /\bcost\b/i,
  /fee[-_\s]?schedule/i,
  /\bbudget\b/i,
  /commercial/i,
];

function matchesAny(fileName: string, patterns: RegExp[]): boolean {
  const base = path.basename(fileName, path.extname(fileName));
  return patterns.some((p) => p.test(base) || p.test(fileName));
}

// ---------------------------------------------------------------------------
// Core scan function
// ---------------------------------------------------------------------------

/**
 * Scan a namespace and return structured insights about its current state.
 *
 * Safe to call frequently — reads only from the local filesystem, no network
 * or LLM calls.  Missing directories are treated as empty (returns defaults).
 */
export async function scanNamespace(workdir: string, namespace: string): Promise<NamespaceInsights> {
  // ── 1. Load files index ───────────────────────────────────────────
  const files = await loadFilesIndex(workdir, namespace);

  const indexedFiles = files.filter((f) => f.status === 'indexed');
  const pendingFiles = files.filter((f) => f.status === 'uploaded' || f.status === 'processing');

  const hasRfp = files.some((f) => matchesAny(f.fileName, RFP_PATTERNS));
  const hasPricingDoc = files.some((f) => matchesAny(f.fileName, PRICING_PATTERNS));

  // Most recent upload timestamp across all files
  let lastActivityAt: Date | undefined;
  for (const f of files) {
    const ts = new Date(f.uploadedAt);
    if (!lastActivityAt || ts > lastActivityAt) {
      lastActivityAt = ts;
    }
  }

  // ── 2. Count proposal drafts ──────────────────────────────────────
  const proposalsDir = path.join(workdir, 'namespaces', namespace, 'proposals');
  let proposalDraftCount = 0;
  try {
    const entries = await readdir(proposalsDir);
    proposalDraftCount = entries.filter((e) => e.endsWith('.md')).length;
  } catch {
    // proposals/ does not exist yet — count stays 0
  }

  return {
    hasRfp,
    hasPricingDoc,
    proposalDraftCount,
    ingestionPendingCount: pendingFiles.length,
    lastActivityAt,
    indexedDocumentCount: indexedFiles.length,
  };
}
