/**
 * Proposal Input Extractor — auto-fills proposal requirements from ingested documents.
 *
 * Queries the namespace vector store with three targeted prompts to surface
 * chunks relevant to industry, timeline, and budget.  A single LLM pass then
 * parses those chunks into a structured JSON object.
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

export interface ExtractedProposalInputs {
  industry?: string;
  timeline?: string;
  budget?: string;
}

// ---------------------------------------------------------------------------
// Targeted queries — one per required field
// ---------------------------------------------------------------------------

const EXTRACTION_QUERIES: Array<{ field: keyof ExtractedProposalInputs; query: string }> = [
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
 * vector store.
 *
 * @returns Partial record — only fields that were clearly found in the documents.
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
    'Rules:',
    '- Only include a field if it is clearly and explicitly stated in the text',
    '- Do NOT infer or guess values that are not stated in the documents',
    '- Return a JSON object containing only the fields that were found',
    '- If nothing is found, return: {}',
    '- Output ONLY the raw JSON — no explanation, no markdown fences',
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
    if (typeof parsed.industry === 'string' && parsed.industry.trim()) {
      result.industry = parsed.industry.trim();
    }
    if (typeof parsed.timeline === 'string' && parsed.timeline.trim()) {
      result.timeline = parsed.timeline.trim();
    }
    if (typeof parsed.budget === 'string' && parsed.budget.trim()) {
      result.budget = parsed.budget.trim();
    }
    return result;
  } catch {
    // Non-fatal — JSON parse failure means no structured data was found
    return {};
  }
}
