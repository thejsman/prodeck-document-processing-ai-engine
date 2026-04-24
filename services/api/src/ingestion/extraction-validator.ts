import { z } from 'zod';
import type {
  ExtractionResult,
  KnowledgeEntry,
  MeetingSummary,
  RequirementKey,
} from '../chat/context.types.js';
import { VALID_REQUIREMENT_KEYS } from './requirement-extractor.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const KnowledgeEntrySchema = z.object({
  content: z.string().min(5).max(500),
  category: z.enum([
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
  ]),
  confidence: z.number().min(0.3).max(1.0),
});

const MeetingSummaryShape = z.object({
  clientOrganization: z
    .object({
      name: z.string().min(1),
      industry: z.string().optional(),
      roles: z.array(z.string()).default([]),
    })
    .optional(),
  agencyOrganization: z
    .object({
      name: z.string().min(1),
      services: z.array(z.string()).optional(),
    })
    .optional(),
  agenda: z
    .array(
      z.object({
        title: z.string().min(1),
        keyTakeaways: z.array(z.string()).default([]),
      }),
    )
    .optional(),
  clientPriorities: z
    .array(
      z.object({
        rank: z.number(),
        title: z.string().min(1),
        bullets: z.array(z.string()).default([]),
      }),
    )
    .optional(),
  requirementsByPriority: z
    .object({
      must: z.array(z.string()).default([]),
      should: z.array(z.string()).default([]),
      could: z.array(z.string()).default([]),
    })
    .optional(),
  agencyDeliverables: z
    .array(
      z.object({
        owner: z.string().min(1),
        deliverable: z.string().min(1),
        deadline: z.string().optional(),
      }),
    )
    .optional(),
  engagementModel: z
    .object({
      approach: z.string().min(1),
      phases: z.array(z.string()).default([]),
      pricingStructure: z.string().optional(),
    })
    .optional(),
  businessMetrics: z
    .array(
      z.object({
        metric: z.string().min(1),
        value: z.string().min(1),
        context: z.string(),
      }),
    )
    .optional(),
  updatedAt: z.string(),
  sourceFile: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractionValidationResult {
  validFields: ExtractionResult['fields'];
  validKnowledge: KnowledgeEntry[];
  validMeetingSummary?: MeetingSummary;
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
  meetingSummary?: MeetingSummary,
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

  // Validate meeting summary shape (if provided)
  let validMeetingSummary: MeetingSummary | undefined;
  if (meetingSummary) {
    const result = MeetingSummaryShape.safeParse(meetingSummary);
    if (result.success) {
      validMeetingSummary = result.data as MeetingSummary;
    } else {
      errors.push(`Invalid meeting summary: ${result.error.errors[0]?.message ?? 'unknown error'}`);
    }
  }

  return { validFields, validKnowledge, validMeetingSummary, errors };
}
