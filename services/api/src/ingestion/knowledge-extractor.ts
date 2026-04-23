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
  'priority',
  'requirement',
  'metric',
  'action_item',
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
    case 'priority': return 5;
    case 'requirement': return 5;
    case 'problem': return 5;
    case 'opportunity': return 5;
    case 'action_item': return 4;
    case 'metric': return 4;
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
export interface KnowledgeExtractionResult {
  entries: KnowledgeEntry[];
  warnings: string[];
}

export async function extractKnowledge(
  preprocessed: PreprocessedDocument,
  docType: DocumentType,
  fileName: string,
  llmFn: LLMGenerateFn,
): Promise<KnowledgeExtractionResult> {
  const warnings: string[] = [];

  const cleanContent = preprocessed.sections
    .map(
      (s) =>
        `## ${s.topic}\n${s.summary}\nFacts: ${s.keyFacts.join('; ')}\n` +
        `Decisions: ${s.decisions.join('; ')}\nConcerns: ${s.openQuestions.join('; ')}`,
    )
    .join('\n\n');

  const prompt = `
You are extracting high-value business intelligence from a client conversation summary.

Your goal: produce a rich, specific set of entries that a proposal writer could use directly.

Each entry MUST reference at least one of:
- A specific business fact (what the company does, markets served, scale of operations)
- A concrete number or amount (budget, count, percentage, traffic, headcount, revenue)
- A named person with their role / organization
- A stated commitment or deliverable (what someone agreed to do)
- A ranked priority or explicit requirement
- A concrete pain point or problem the client is facing

DO NOT extract (these are noise — skip them entirely):
- Audio / video quality issues, connection delays, echo, "can you hear me" remarks
- Personal identity trivia (nationality, where someone lives, family, weather, sports)
- Small talk, greetings, goodbye sequences, scheduling back-and-forth
- Filler remarks that do not contain a business fact, number, commitment, or requirement
- Generic statements ("Chris mentioned something", "Jake confirmed") — if you cannot name WHAT they said, skip it

Categories (use the most specific one that fits):
- priority     : An explicitly ranked or numbered client priority (e.g. "Priority 1: ...", "most important thing is...")
- requirement  : A stated must-have or should-have feature, capability, or deliverable
- metric       : A business number or KPI (budget amounts, lead counts, traffic, conversion rates, team headcount, etc.)
- action_item  : A committed next step with a responsible party and/or deadline
- problem      : A business pain point, frustration, or challenge (NOT audio issues or technical glitches)
- opportunity  : A potential upside, growth area, or strategic opening
- decision     : A direction or choice that was agreed upon
- constraint   : A limitation, risk, or boundary condition on the engagement
- preference   : A stated preference or style choice about the work
- context      : Background about the company, people, or situation that a proposal writer would need

Rules:
- Extract EACH priority as its own separate entry — do not combine them
- Extract EACH metric (dollar amount, count, percentage, traffic number) as its own entry
- Extract EACH agency commitment as its own action_item entry
- Include specific numbers, names, and details in the content — generic summaries are useless
- Do NOT infer or embellish — only extract what is stated
- Quality over quantity: a shorter list of substantive entries beats a long list padded with filler

Document summary:
---
${cleanContent}
---

Return a JSON array aiming for 15–40 substantive entries:
[
  { "content": "...", "category": "priority|requirement|metric|action_item|problem|opportunity|decision|constraint|preference|context", "confidence": 0.7 }
]
`;

  let raw = '';
  try {
    raw = await llmFn(prompt);
  } catch (err) {
    const msg = `Knowledge LLM call failed: ${err instanceof Error ? err.message : String(err)}`;
    console.warn(`[KnowledgeExtractor] ${fileName}: ${msg}`);
    warnings.push(msg);
    return { entries: [], warnings };
  }

  let parsed = safeParseJSON<Array<{ content: string; category: string; confidence: number }>>(raw);

  if (!parsed || !Array.isArray(parsed)) {
    const msg = `Knowledge LLM returned invalid JSON — retrying with compact prompt (raw: ${raw.slice(0, 200)})`;
    console.warn(`[KnowledgeExtractor] ${fileName}: ${msg}`);
    warnings.push(msg);

    // Retry with a compact prompt using only key facts (no full summaries)
    const compactContent = preprocessed.sections
      .flatMap((s) => s.keyFacts)
      .filter(Boolean)
      .join('\n');

    const retryPrompt = `Extract business facts from these key facts as a JSON array.
Each item: { "content": "...", "category": "priority|requirement|metric|action_item|problem|opportunity|decision|constraint|preference|context", "confidence": 0.7 }
Return ONLY a JSON array, no other text.

Key facts:
${compactContent}`;

    try {
      raw = await llmFn(retryPrompt);
    } catch (retryErr) {
      const retryMsg = `Knowledge retry LLM call also failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`;
      console.warn(`[KnowledgeExtractor] ${fileName}: ${retryMsg}`);
      warnings.push(retryMsg);
      return { entries: [], warnings };
    }

    parsed = safeParseJSON(raw);
    if (!parsed || !Array.isArray(parsed)) {
      const failMsg = 'Knowledge retry also returned invalid JSON — giving up';
      console.warn(`[KnowledgeExtractor] ${fileName}: ${failMsg}`);
      warnings.push(failMsg);
      return { entries: [], warnings };
    }
  }

  const now = new Date().toISOString();
  const confidenceCap = CONFIDENCE_CAP_BY_DOC_TYPE[docType];

  const entries = parsed
    .filter(
      (e) =>
        e.content &&
        typeof e.content === 'string' &&
        VALID_KNOWLEDGE_CATEGORIES.includes(e.category as KnowledgeCategory) &&
        typeof e.confidence === 'number' &&
        e.confidence >= 0.3 &&
        e.confidence <= 1.0,
    )
    .slice(0, 60)
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

  if (entries.length === 0 && parsed.length > 0) {
    warnings.push(`Knowledge LLM returned ${parsed.length} entries but all failed validation (wrong category or confidence out of range)`);
  }

  return { entries, warnings };
}
