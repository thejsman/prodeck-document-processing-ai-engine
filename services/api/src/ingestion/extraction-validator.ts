import { z } from 'zod';
import type { ExtractionResult, KnowledgeEntry, RequirementKey } from '../chat/context.types.js';
import { VALID_REQUIREMENT_KEYS } from './requirement-extractor.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const KnowledgeEntrySchema = z.object({
  content: z.string().min(5).max(500),
  category: z.enum([
    'requirement',
    'preference',
    'constraint',
    'context',
    'history',
    'concern',
    'decision',
    'action_item',
    'relationship',
  ]),
  confidence: z.number().min(0.3).max(1.0),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractionValidationResult {
  validFields: ExtractionResult['fields'];
  validKnowledge: KnowledgeEntry[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Deterministic validator for extraction outputs (spec section 3.7).
 * Drops unknown requirement keys, empty values, and malformed knowledge entries.
 * Never throws — returns errors as strings.
 */
export function validateExtractionResults(
  fields: ExtractionResult['fields'],
  knowledge: KnowledgeEntry[],
): ExtractionValidationResult {
  const errors: string[] = [];

  // Validate structured requirement fields
  const validFields: ExtractionResult['fields'] = {};
  for (const [key, field] of Object.entries(fields)) {
    if (!field) continue;
    if (!VALID_REQUIREMENT_KEYS.includes(key as RequirementKey)) {
      errors.push(`Unknown requirement key: ${key}`);
      continue;
    }
    if (field.value === null || field.value === undefined || field.value === '') {
      errors.push(`Empty value for key: ${key}`);
      continue;
    }
    validFields[key as RequirementKey] = field;
  }

  // Validate knowledge entries
  const validKnowledge: KnowledgeEntry[] = [];
  for (const entry of knowledge) {
    const result = KnowledgeEntrySchema.safeParse(entry);
    if (result.success) {
      validKnowledge.push(entry);
    } else {
      errors.push(`Invalid knowledge entry: ${result.error.errors[0]?.message ?? 'unknown error'}`);
    }
  }

  return { validFields, validKnowledge, errors };
}
