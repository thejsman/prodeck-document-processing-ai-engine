import type { DocumentType, ExtractionResult, RequirementKey } from '../chat/context.types.js';
import type { PreprocessedDocument, LLMGenerateFn } from './document-preprocessor.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VALID_REQUIREMENT_KEYS: RequirementKey[] = [
  'clientName',
  'industry',
  'projectType',
  'budget',
  'timeline',
  'teamSize',
  'technicalStack',
  'keyObjectives',
  'constraints',
  'deliverables',
  'stakeholders',
  'contactName',
];

// Spec section 3.5 — confidence per document type (must match exactly)
const CONFIDENCE_BY_DOC_TYPE: Record<DocumentType, number> = {
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
    const match = stripped.match(/\{[\s\S]*\}/);
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
 * Extracts structured requirement fields from a preprocessed document.
 * Takes PreprocessedDocument (NOT raw content) — noise has already been removed.
 * Confidence is capped by document type per spec section 3.5.
 */
export async function extractRequirementsFromPreprocessed(
  preprocessed: PreprocessedDocument,
  docType: DocumentType,
  llmFn: LLMGenerateFn,
): Promise<ExtractionResult> {
  const cleanContent = preprocessed.sections
    .map(
      (s) =>
        `## ${s.topic}\n${s.summary}\nFacts: ${s.keyFacts.join('; ')}\nDecisions: ${s.decisions.join('; ')}`,
    )
    .join('\n\n');

  const participantContext =
    preprocessed.participants
      ?.map((p) => `${p.name} — ${p.role} at ${p.organization}`)
      .join('\n') ?? 'No participants identified';

  const baseConfidence = CONFIDENCE_BY_DOC_TYPE[docType];

  const prompt = `
Extract structured project/client information from this preprocessed document summary.
This content has already been cleaned and structured — extract only facts that are
clearly stated or strongly implied.

Return ONLY a JSON object. Omit fields not mentioned. Do NOT guess or infer
values that are not supported by the content.

Extractable fields:
- clientName (string)
- industry (string)
- projectType (string)
- budget (string, include currency and qualifiers like "approximately")
- timeline (string)
- teamSize (number)
- technicalStack (string[])
- keyObjectives (string[])
- constraints (string[])
- deliverables (string[])
- stakeholders (string[])
- contactName (string)

Participants identified:
${participantContext}

Document summary:
---
${cleanContent}
---

JSON output (empty {} if nothing to extract):
`;

  let raw = '';
  try {
    raw = await llmFn(prompt);
  } catch (err) {
    console.warn('[RequirementExtractor] LLM call failed:', err);
    return { fields: {}, knowledge: [], raw: '' };
  }

  const parsed = safeParseJSON<Record<string, unknown>>(raw);

  if (!parsed || typeof parsed !== 'object') {
    return { fields: {}, knowledge: [], raw: raw ?? '' };
  }

  const fields: ExtractionResult['fields'] = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined) continue;
    if (!VALID_REQUIREMENT_KEYS.includes(key as RequirementKey)) continue;
    fields[key as RequirementKey] = {
      value,
      confidence: baseConfidence,
      source: 'document',
      updatedAt: new Date().toISOString(),
    };
  }

  return { fields, knowledge: [], raw };
}
