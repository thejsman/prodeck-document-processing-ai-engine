// services/api/src/skills/skill.validator.ts
// Zod validation schemas for the Skills system.

import { z } from 'zod';

export const SectionConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['exists', 'equals', 'contains']),
  value: z.string().optional(),
});

export const SectionDefinitionSchema = z.object({
  id: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Section ID must be kebab-case'),
  title: z.string().min(1).max(200),
  order: z.number().int().positive(),
  required: z.boolean(),
  promptHint: z.string().min(1).max(1000),
  maxWords: z.number().int().positive().optional(),
  minWords: z.number().int().positive().optional(),
  assetRef: z.string().max(200).optional(),
  useRagContext: z.boolean().default(false),
  ragQuery: z.string().max(500).optional(),
  condition: SectionConditionSchema.optional(),
});

export const PricingTierSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  priceRange: z.string().max(100).optional(),
  features: z.array(z.string().max(200)).max(20),
  duration: z.string().max(100).optional(),
});

export const MicrositeDefaultsSchema = z.object({
  theme: z.string().max(100).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color').optional(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color').optional(),
  tagline: z.string().max(200).optional(),
  logoAsset: z.string().max(200).optional(),
});

export const PricingDefaultsSchema = z.object({
  model: z.enum(['hourly', 'fixed', 'tiered', 'retainer']),
  rates: z.record(z.number().positive()).optional(),
  tiers: z.array(PricingTierSchema).max(6).optional(),
  discounts: z.array(z.string().max(200)).max(10).optional(),
  currency: z.string().length(3).default('USD'),
});

export const ClarifyingQuestionSchema = z.object({
  id: z.string().min(1).max(50),
  question: z.string().min(1).max(500),
  required: z.boolean(),
  contextField: z.string().max(100).optional(),
});

export const SkillSchema = z.object({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase kebab-case'),
  displayName: z.string().min(1).max(200),
  description: z.string().max(1000),
  industries: z.array(z.string().max(100)).max(10),
  projectTypes: z.array(z.string().max(100)).max(10),
  tags: z.array(z.string().max(50)).max(20),
  defaultTemplate: z.string().max(100).optional(),
  toneDescription: z.string().max(500),
  micrositeDefaults: MicrositeDefaultsSchema,
  pricingDefaults: PricingDefaultsSchema.optional(),
  author: z.string(),
  version: z.string().regex(/^\d+\.\d+$/, 'Version must be semver like 1.0'),
  createdAt: z.string(),
  updatedAt: z.string(),
  scope: z.enum(['global', 'namespace']),
  namespace: z.string().optional(),
  // Document generation fields
  type: z.enum(['proposal', 'document']).optional(),
  structureMode: z.enum(['free', 'guided', 'strict']).optional(),
  triggers: z.array(z.string().max(100)).max(30).optional(),
  outputFormats: z.array(z.enum(['md', 'txt', 'pdf', 'docx', 'pptx', 'notion'])).optional(),
  clarifyingQuestions: z.array(ClarifyingQuestionSchema).max(10).optional(),
});

export const SkillSectionsSchema = z.object({
  sections: z.array(SectionDefinitionSchema),
});

export const GeneratedSkillSchema = z.object({
  displayName: z.string().min(1),
  description: z.string(),
  industries: z.array(z.string()),
  projectTypes: z.array(z.string()),
  tags: z.array(z.string()),
  toneDescription: z.string(),
  instructions: z.string(),
  sections: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      order: z.number(),
      required: z.boolean(),
      promptHint: z.string(),
      maxWords: z.number().optional().nullable(),
      minWords: z.number().optional().nullable(),
      assetRef: z.string().optional().nullable(),
      useRagContext: z.boolean().default(false),
      ragQuery: z.string().optional().nullable(),
      condition: SectionConditionSchema.optional().nullable(),
    }),
  ),
  pricingDefaults: PricingDefaultsSchema.optional(),
  micrositeDefaults: MicrositeDefaultsSchema.optional(),
  suggestedAssets: z
    .array(
      z.object({
        fileName: z.string(),
        description: z.string(),
        content: z.string(),
      }),
    )
    .optional(),
  type: z.enum(['proposal', 'document']).optional(),
  structureMode: z.enum(['free', 'guided', 'strict']).optional(),
  triggers: z.array(z.string()).optional(),
  outputFormats: z.array(z.enum(['md', 'txt', 'pdf', 'docx', 'pptx', 'notion'])).optional(),
  clarifyingQuestions: z.array(ClarifyingQuestionSchema).optional(),
});

// Inferred type aliases
export type SkillSchemaType = z.infer<typeof SkillSchema>;
export type SectionDefinitionSchemaType = z.infer<typeof SectionDefinitionSchema>;
export type GeneratedSkillSchemaType = z.infer<typeof GeneratedSkillSchema>;
