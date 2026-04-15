import { randomUUID } from 'node:crypto';
import type { DocumentType, KnowledgeEntry, KnowledgeCategory } from '../chat/context.types.js';
import type { PreprocessedDocument, LLMGenerateFn } from './document-preprocessor.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VALID_KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = [
  'problem',
  'opportunity',
  'decision',
  'constraint',
  'preference',
  'context',
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

function scoreImportance(category: KnowledgeCategory): number {
  switch (category) {
    case 'problem': return 5;
    case 'opportunity': return 5;
    case 'decision': return 4;
    case 'constraint': return 3;
    case 'preference': return 2;
    case 'context': return 1;
  }
}

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
You are extracting high-value business intelligence from a client conversation.

Extract ONLY information that is useful for:
- building a proposal
- identifying problems
- identifying opportunities
- improving workflows
- increasing revenue

Prioritize:
1. Problems / pain points
2. Opportunities / automation ideas
3. Decisions / strategy direction
4. Constraints / risks
5. Context (lowest priority)

Rules:
- Each entry must be actionable or strategically useful
- Ignore casual conversation and filler
- Do NOT extract generic or obvious statements
- Do NOT infer beyond what is stated

Document summary:
---
${cleanContent}
---

Return JSON array:
[
  { "content": "...", "category": "problem|opportunity|decision|constraint|preference|context", "confidence": 0.7 }
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

  if (!parsed || !Array.isArray(parsed)) {
    console.warn('[KnowledgeExtractor] Failed to parse LLM response as JSON array for:', fileName, '| raw:', raw.slice(0, 200));
    return [];
  }

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
    .slice(0, 40)
    .map((e) => ({
      id: randomUUID(),
      content: e.content,
      category: e.category as KnowledgeCategory,
      importance: scoreImportance(e.category as KnowledgeCategory),
      source: {
        type: 'document' as const,
        fileName,
      },
      extractedAt: now,
      confidence: Math.min(e.confidence, confidenceCap),
    }));
}
