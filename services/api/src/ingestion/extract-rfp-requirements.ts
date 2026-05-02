/**
 * RFP Requirement Extractor — semantic extraction tool.
 *
 * Queries the namespace vector store with four targeted prompts to surface
 * chunks relevant to each requirement category.  A secondary LLM pass then
 * parses those chunks into a clean structured matrix.
 *
 * Categories:
 *   functional   — deliverables, features, scope of work
 *   compliance   — regulatory, certifications, standards, security
 *   timeline     — milestones, deadlines, project duration
 *   pricing      — budget ceilings, cost structure, commercial terms
 *
 * Placement: services/api layer (not packages/tools) because it depends on
 * queryKnowledgeBase from @ai-engine/runtime and llmGenerateFn from agent-routes.
 */

import path from 'node:path';
import { queryKnowledgeBase } from '@ai-engine/runtime';
import { llmGenerateFn } from '../agent-routes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RequirementMatrix {
  /** Functional deliverables and scope items extracted from the RFP. */
  functional: string[];
  /** Compliance, regulatory, and certification requirements. */
  compliance: string[];
  /** Timeline constraints, milestones, and deadlines. */
  timeline: string[];
  /** Budget ceilings, pricing structure, and commercial signals. */
  pricing: string[];
}

// ---------------------------------------------------------------------------
// Category queries
// ---------------------------------------------------------------------------

const CATEGORY_QUERIES: Array<{ key: keyof RequirementMatrix; query: string }> = [
  {
    key: 'functional',
    query: 'functional requirements deliverables scope of work features capabilities',
  },
  {
    key: 'compliance',
    query: 'compliance regulatory requirements certifications security standards audit',
  },
  {
    key: 'timeline',
    query: 'timeline milestones project deadline schedule duration go-live date',
  },
  {
    key: 'pricing',
    query: 'pricing budget cost estimate commercial terms fee structure financial ceiling',
  },
];

// ---------------------------------------------------------------------------
// Core extraction function
// ---------------------------------------------------------------------------

/**
 * Extract a structured requirement matrix from the namespace vector store.
 *
 * @param workdir  - server working directory (used to locate the FAISS index)
 * @param namespace - namespace to query
 */
export async function extractRfpRequirements(
  workdir: string,
  namespace: string,
): Promise<RequirementMatrix> {
  const storageDir = path.join(workdir, 'namespaces', namespace);

  const matrix: RequirementMatrix = {
    functional: [],
    compliance: [],
    timeline: [],
    pricing: [],
  };

  // Run all four category queries in parallel for speed
  await Promise.all(
    CATEGORY_QUERIES.map(async ({ key, query }) => {
      let rawChunks = '';
      try {
        const result = await queryKnowledgeBase({ question: query, storageDir, namespace });
        rawChunks = result.answer ?? '';
      } catch {
        // Non-fatal — category stays empty if knowledge base is unavailable
        return;
      }

      if (!rawChunks.trim()) return;

      // LLM pass: parse the raw search answer into a bullet list for this category
      const parsePrompt = [
        `You are extracting structured requirements from RFP content.`,
        ``,
        `Category: ${key}`,
        `Task: Read the text below and extract a concise bullet list of ${key} requirements.`,
        `Rules:`,
        `- Each bullet must be a single concrete requirement or constraint`,
        `- Remove duplicates and vague phrases`,
        `- If nothing relevant is found, output exactly: (none detected)`,
        `- Output ONLY the bullet list — no intro, no headings, no commentary`,
        ``,
        `Text:`,
        rawChunks,
      ].join('\n');

      try {
        const parsed = await llmGenerateFn(parsePrompt);
        const lines = parsed
          .split('\n')
          .map((l) => l.replace(/^[-*•]\s*/, '').trim())
          .filter((l) => l.length > 0 && l !== '(none detected)');
        matrix[key] = lines;
      } catch {
        // Non-fatal — keep empty array
      }
    }),
  );

  return matrix;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Render the requirement matrix as a markdown table for chat display.
 */
export function formatRequirementMatrix(matrix: RequirementMatrix): string {
  const sections: string[] = ['## Requirement Matrix'];

  const entries: Array<{ label: string; items: string[] }> = [
    { label: 'Functional', items: matrix.functional },
    { label: 'Compliance', items: matrix.compliance },
    { label: 'Timeline', items: matrix.timeline },
    { label: 'Pricing', items: matrix.pricing },
  ];

  for (const { label, items } of entries) {
    sections.push(`\n### ${label}`);
    if (items.length === 0) {
      sections.push('_None detected_');
    } else {
      sections.push(items.map((i) => `- ${i}`).join('\n'));
    }
  }

  return sections.join('\n');
}
