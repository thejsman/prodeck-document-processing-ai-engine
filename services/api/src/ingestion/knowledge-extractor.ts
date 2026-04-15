import { randomUUID } from 'node:crypto';
import type { DocumentType, KnowledgeEntry, KnowledgeCategory } from '../chat/context.types.js';
import type { PreprocessedDocument, LLMGenerateFn } from './document-preprocessor.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VALID_KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = [
  'requirement',
  'preference',
  'constraint',
  'context',
  'history',
  'concern',
  'decision',
  'action_item',
  'relationship',
];

// Confidence cap per document type — informal sources can't exceed their cap
const CONFIDENCE_CAP_BY_DOC_TYPE: Record<DocumentType, number> = {
  rfp: 0.85,
  technical_spec: 0.85,
  meeting_transcript: 0.6,
  email: 0.7,
  proposal_draft: 0.75,
  generic: 0.65,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParseJSON<T>(raw: string): T | null {
  const stripped = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    // Try to extract the first JSON array found in the string
    const match = stripped.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

/**
 * Extracts rich knowledge entries from a preprocessed document.
 * Captures preferences, concerns, decisions, and context that don't fit
 * into structured requirement fields. Returns up to 25 entries, each
 * with confidence capped by document type.
 */
export async function extractKnowledge(
  preprocessed: PreprocessedDocument,
  docType: DocumentType,
  fileName: string,
  llmFn: LLMGenerateFn,
): Promise<KnowledgeEntry[]> {
  const cleanContent = preprocessed.sections
    .map(
      (s) =>
        `## ${s.topic}\n${s.summary}\nFacts: ${s.keyFacts.join('; ')}\n` +
        `Decisions: ${s.decisions.join('; ')}\nConcerns: ${s.openQuestions.join('; ')}`,
    )
    .join('\n\n');

  const prompt = `
Extract knowledge entries from this document summary. Each entry should be a single
atomic fact, preference, concern, decision, or piece of context that would be useful
when writing a proposal or planning a project for this client.

Categories to use:
- requirement: explicit client need
- preference: client preference or opinion
- constraint: limitation or blocker
- context: background info about the company/project
- history: past interactions or previous work
- concern: risk, worry, or unresolved issue
- decision: firm decision that was made
- action_item: specific next step with an owner
- relationship: people, roles, and reporting structures

RULES:
1. Each entry must be a complete, standalone sentence
2. Do not include small talk or personal information
3. Mark confidence 0.7 for explicitly stated facts, 0.5 for inferred/implied ones
4. Maximum 25 entries — prioritize the most useful information
5. If the same fact appears in a structured requirement field, still include it
   as knowledge if the context adds nuance

Document summary:
---
${cleanContent}
---

Respond with ONLY a JSON array:
[
  { "content": "...", "category": "requirement", "confidence": 0.7 },
  { "content": "...", "category": "preference", "confidence": 0.5 }
]
`;

  let raw = '';
  try {
    raw = await llmFn(prompt);
  } catch (err) {
    console.warn('[KnowledgeExtractor] LLM call failed:', err);
    return [];
  }

  const parsed = safeParseJSON<Array<{ content: string; category: string; confidence: number }>>(
    raw,
  );

  if (!parsed || !Array.isArray(parsed)) return [];

  const now = new Date().toISOString();
  const confidenceCap = CONFIDENCE_CAP_BY_DOC_TYPE[docType];

  return parsed
    .filter(
      (e) =>
        e.content &&
        typeof e.content === 'string' &&
        VALID_KNOWLEDGE_CATEGORIES.includes(e.category as KnowledgeCategory) &&
        typeof e.confidence === 'number' &&
        e.confidence >= 0.3 &&
        e.confidence <= 1.0,
    )
    .slice(0, 25)
    .map((e) => ({
      id: randomUUID(),
      content: e.content,
      category: e.category as KnowledgeCategory,
      source: {
        type: 'document' as const,
        fileName,
      },
      extractedAt: now,
      confidence: Math.min(e.confidence, confidenceCap),
    }));
}
