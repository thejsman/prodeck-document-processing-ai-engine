/**
 * Proposal Input Extractor — auto-fills proposal requirements from ingested documents.
 *
 * Queries the namespace vector store with three targeted prompts to surface
 * chunks relevant to industry, timeline, and budget.  A single LLM pass then
 * parses those chunks into a structured JSON object with per-field confidence
 * scores and supporting evidence.
 *
 * The result is cached in instance.context.extractedRequirements so the vector
 * store and LLM are only called once per workflow session.
 *
 * Placement: services/api layer (mirrors extract-rfp-requirements.ts) because
 * it depends on queryKnowledgeBase from @ai-engine/runtime and llmGenerateFn
 * from agent-routes.
 */

import path from 'node:path';
import { queryKnowledgeBase } from '@ai-engine/runtime';
import { llmGenerateFn } from '../agent-routes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single extracted proposal input with confidence and traceability. */
export interface ExtractedField {
  /** The extracted value (e.g. "fintech", "8–10 weeks", "$150,000"). */
  value: string;
  /**
   * Model confidence that the value is correct and explicitly stated: 0–1.
   * 0.85+ → auto-fill silently.
   * 0.60–0.84 → ask user to confirm.
   * <0.60 → discard and ask manually.
   */
  confidence: number;
  /** Always "rfp" — distinguishes these entries from chat-derived inputs. */
  source: 'rfp';
  /** Exact phrase or sentence from the document that supports this value. */
  evidence?: string;
}

export interface ExtractedProposalInputs {
  industry?: ExtractedField;
  timeline?: ExtractedField;
  budget?: ExtractedField;
}

// ---------------------------------------------------------------------------
// Targeted queries — one per required field
// ---------------------------------------------------------------------------

const EXTRACTION_QUERIES: Array<{
  field: keyof ExtractedProposalInputs;
  query: string;
}> = [
  {
    field: 'industry',
    query: 'industry domain sector business vertical type company market',
  },
  {
    field: 'timeline',
    query: 'timeline duration project schedule weeks months deadline go-live delivery date',
  },
  {
    field: 'budget',
    query: 'budget cost pricing financial investment ceiling estimate total value contract amount',
  },
];

// ---------------------------------------------------------------------------
// Extraction function
// ---------------------------------------------------------------------------

/**
 * Extract proposal inputs (industry, timeline, budget) from the namespace
 * vector store, each annotated with a confidence score and supporting evidence.
 *
 * @returns Partial record — only fields that were found with confidence ≥ 0.6.
 *          Returns {} if the knowledge base is unavailable or nothing relevant
 *          was found.
 */
export async function extractRequirementsFromKnowledge(
  workdir: string,
  namespace: string,
): Promise<ExtractedProposalInputs> {
  const storageDir = path.join(workdir, 'namespaces');

  // Run all three targeted queries in parallel
  const chunkResults = await Promise.all(
    EXTRACTION_QUERIES.map(async ({ field, query }) => {
      try {
        const result = await queryKnowledgeBase({ question: query, storageDir, namespace });
        return { field, text: result.answer?.trim() ?? '' };
      } catch {
        return { field, text: '' };
      }
    }),
  );

  // Combine non-empty results into a single context block for one LLM pass
  const contextBlock = chunkResults
    .filter(({ text }) => text.length > 0)
    .map(({ field, text }) => `### ${field}\n${text}`)
    .join('\n\n');

  if (!contextBlock) return {};

  const prompt = [
    'You are extracting structured proposal inputs from RFP and project documents.',
    '',
    'Based on the document excerpts below, extract the following fields if clearly present:',
    '- industry: the industry or sector (e.g. "fintech", "healthcare", "retail")',
    '- timeline: the project duration or deadline (e.g. "8–10 weeks", "Q3 2025", "6 months")',
    '- budget: the budget or cost range (e.g. "$150,000", "$50k–$100k")',
    '',
    'For each field found, return an object with:',
    '  - value: the extracted value as a short string',
    '  - confidence: a number from 0.0 to 1.0 representing how explicitly and clearly',
    '    this value is stated in the text (1.0 = verbatim, 0.5 = implied, 0.0 = not found)',
    '  - evidence: the exact phrase or sentence from the text that supports this value',
    '',
    'Rules:',
    '- Only include a field if it appears in the text with confidence >= 0.6',
    '- Do NOT infer or fabricate values not present in the documents',
    '- If nothing relevant is found, return: {}',
    '- Output ONLY the raw JSON — no explanation, no markdown fences',
    '',
    'Example output:',
    '{',
    '  "timeline": { "value": "8–10 weeks", "confidence": 0.92, "evidence": "The project must be completed within 8 to 10 weeks of contract signing." },',
    '  "industry": { "value": "fintech", "confidence": 0.85, "evidence": "Our platform serves financial technology companies." }',
    '}',
    '',
    'Document excerpts:',
    contextBlock,
  ].join('\n');

  try {
    const raw = await llmGenerateFn(prompt);
    // Strip optional markdown fences the LLM may add despite instructions
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const result: ExtractedProposalInputs = {};

    for (const field of ['industry', 'timeline', 'budget'] as const) {
      const raw = parsed[field];
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as Record<string, unknown>;

      const value = typeof entry.value === 'string' ? entry.value.trim() : '';
      const confidence = typeof entry.confidence === 'number' ? entry.confidence : 0;
      const evidence = typeof entry.evidence === 'string' ? entry.evidence.trim() : undefined;

      // Discard low-confidence extractions — handler will ask manually instead
      if (!value || confidence < 0.6) continue;

      result[field] = { value, confidence, source: 'rfp', evidence };
    }

    return result;
  } catch {
    // Non-fatal — JSON parse failure means no structured data was found
    return {};
  }
}
