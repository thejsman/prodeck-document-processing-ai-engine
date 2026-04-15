import type { DocumentType, ExtractionResult, RequirementKey } from '../chat/context.types.js';
import type { PreprocessedDocument, LLMGenerateFn } from './document-preprocessor.js';
import { z } from 'zod';

const ExtractionSchema = z.object({
  clientName: z.string().optional(),
  industry: z.string().optional(),
  projectType: z.string().optional(),
  budget: z.string().optional(),
  timeline: z.string().optional(),
  teamSize: z.number().optional(),
  technicalStack: z.array(z.string()).optional(),
  keyObjectives: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  deliverables: z.array(z.string()).optional(),
  stakeholders: z.array(z.string()).optional(),
  contactName: z.string().optional(),
});

function normalizeValue(key: RequirementKey, value: unknown) {
  if (key === 'teamSize' && typeof value === 'string') {
    const num = parseInt(value.replace(/\D/g, ''), 10);
    return isNaN(num) ? undefined : num;
  }

  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }

  return value;
}

function computeFieldConfidence(value: unknown, base: number) {
  if (Array.isArray(value) && value.length === 0) return base - 0.2;
  if (typeof value === 'string' && value.length < 3) return base - 0.2;
  return base;
}

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
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
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
    .map((s) => `## ${s.topic}\n${s.summary}\nFacts: ${s.keyFacts.join('; ')}\nDecisions: ${s.decisions.join('; ')}`)
    .join('\n\n');

  const participantContext =
    preprocessed.participants?.map((p) => `${p.name} — ${p.role} at ${p.organization}`).join('\n') ??
    'No participants identified';

  const baseConfidence = CONFIDENCE_BY_DOC_TYPE[docType];

  const prompt = `
You are an information extraction system.

Extract ONLY explicitly stated facts from the document.
DO NOT infer, guess, or assume missing values.

Return STRICT JSON only. No explanations.

Schema:
{
  "clientName": string,
  "industry": string,
  "projectType": string,
  "budget": string,
  "timeline": string,
  "teamSize": number,
  "technicalStack": string[],
  "keyObjectives": string[],
  "constraints": string[],
  "deliverables": string[],
  "stakeholders": string[],
  "contactName": string
}

Rules:
- Omit fields not present
- teamSize MUST be a number (not text)
- Arrays MUST be arrays (not comma-separated strings)
- If unsure, omit the field
- DO NOT hallucinate

Participants:
${participantContext}

Content:
${cleanContent}

Return JSON only:
`;

  let raw = '';
  try {
    raw = await llmFn(prompt);
  } catch (err) {
    console.warn('[RequirementExtractor] LLM call failed:', err);
    return { fields: {}, knowledge: [], raw: '' };
  }

  let parsed = safeParseJSON(raw);

  if (!parsed) {
    const retryPrompt = prompt + '\n\nFix your output. Return valid JSON only.';
    try {
      raw = await llmFn(retryPrompt);
    } catch {
      // ignore retry failure, fall through to empty result
    }
    parsed = safeParseJSON(raw);
  }

  const validated = ExtractionSchema.safeParse(parsed);

  if (!validated.success) {
    return { fields: {}, knowledge: [], raw };
  }

  const fields: ExtractionResult['fields'] = {};
  for (const [key, value] of Object.entries(validated.data)) {
    if (!VALID_REQUIREMENT_KEYS.includes(key as RequirementKey)) continue;

    const normalized = normalizeValue(key as RequirementKey, value);
    if (normalized === undefined) continue;

    fields[key as RequirementKey] = {
      value: normalized,
      confidence: computeFieldConfidence(normalized, baseConfidence),
      source: 'document',
      updatedAt: new Date().toISOString(),
    };
  }

  return { fields, knowledge: [], raw };
}
