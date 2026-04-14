import { z } from 'zod';

export const ParticipantSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.string().max(200).default('unknown'),
  organization: z.string().max(200).default('unknown'),
  inferredFrom: z.string().max(500).default(''),
});

export const SectionSchema = z.object({
  topic: z.string().min(1).max(200),
  summary: z.string().min(1).max(2000),
  keyFacts: z.array(z.string().max(500)).max(20).default([]),
  decisions: z.array(z.string().max(500)).max(10).default([]),
  openQuestions: z.array(z.string().max(500)).max(10).default([]),
  sentiment: z.enum(['positive', 'neutral', 'concern']).default('neutral'),
  relevantQuotes: z.array(z.string().max(200)).max(3).default([]),
});

export const ActionItemSchema = z.object({
  owner: z.string().min(1).max(200),
  action: z.string().min(1).max(500),
  deadline: z.string().max(100).optional(),
  status: z.enum(['open', 'in_progress', 'done']).default('open'),
});

export const PreprocessedDocumentSchema = z.object({
  participants: z.array(ParticipantSchema).max(20).default([]),
  sections: z.array(SectionSchema).min(1).max(30),
  actionItems: z.array(ActionItemSchema).max(20).default([]),
});

export type ValidatedParticipant = z.infer<typeof ParticipantSchema>;
export type ValidatedSection = z.infer<typeof SectionSchema>;
export type ValidatedActionItem = z.infer<typeof ActionItemSchema>;
export type ValidatedPreprocessedDocument = z.infer<typeof PreprocessedDocumentSchema>;

export interface ValidationResult {
  valid: boolean;
  document?: ValidatedPreprocessedDocument;
  errors: string[];
}

export function validatePreprocessedDocument(raw: unknown): ValidationResult {
  const result = PreprocessedDocumentSchema.safeParse(raw);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
    };
  }
  return { valid: true, document: result.data, errors: [] };
}
