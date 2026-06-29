// services/api/src/skills/skill.types.ts
// TypeScript interfaces for the Skills system.

export type SkillType = 'proposal' | 'document'

export type StructureMode = 'free' | 'guided' | 'strict'
// free   → LLM invents document structure (default for document skills)
// guided → sections are a suggested starting point, LLM adapts
// strict → LLM must follow sections.json exactly (compliance, SOPs)

export type OutputFormat = 'md' | 'txt' | 'pdf' | 'docx' | 'rtf' | 'pptx' | 'notion'

export interface ClarifyingQuestion {
  id: string
  question: string
  required: boolean
  contextField?: string  // skip if this field already exists in client context
}

export interface SectionCondition {
  field: string
  operator: 'exists' | 'equals' | 'contains'
  value?: string
}

export interface SectionDefinition {
  id: string
  title: string
  order: number
  required: boolean
  promptHint: string
  maxWords?: number
  minWords?: number
  assetRef?: string
  useRagContext: boolean
  ragQuery?: string
  condition?: SectionCondition
}

export interface PricingTier {
  name: string
  description: string
  priceRange?: string
  features: string[]
  duration?: string
}

export interface MicrositeDefaults {
  theme?: string
  primaryColor?: string
  secondaryColor?: string
  tagline?: string
  logoAsset?: string
}

export interface PricingDefaults {
  model: 'hourly' | 'fixed' | 'tiered' | 'retainer'
  rates?: Record<string, number>
  tiers?: PricingTier[]
  discounts?: string[]
  currency: string
}

export interface Skill {
  slug: string
  displayName: string
  description: string
  industries: string[]
  projectTypes: string[]
  tags: string[]
  defaultTemplate?: string
  toneDescription: string
  micrositeDefaults: MicrositeDefaults
  pricingDefaults?: PricingDefaults
  author: string
  version: string
  createdAt: string
  updatedAt: string
  scope: 'global' | 'namespace'
  namespace?: string
  // Document generation fields (optional — omit for proposal skills)
  type?: SkillType            // defaults to 'proposal' when absent
  structureMode?: StructureMode
  triggers?: string[]         // keyword phrases that activate this skill in chat
  outputFormats?: OutputFormat[]
  clarifyingQuestions?: ClarifyingQuestion[]
}

export interface SkillSummary {
  slug: string
  displayName: string
  description: string
  industries: string[]
  version: string
  updatedAt: string
  type?: SkillType
  triggers?: string[]
  outputFormats?: OutputFormat[]
}

export interface GeneratedDocumentMeta {
  id: string
  title: string
  documentType: string     // free-form kebab-case slug inferred by LLM
  skillSlug?: string       // which skill was used (optional)
  preferredFormat: OutputFormat
  status: 'draft' | 'complete'
  createdAt: string
  updatedAt: string
  downloadUrl?: string     // set when auto-export ran (non-md formats)
}

export interface LoadedSkill {
  skill: Skill
  instructionsMd: string
  sections: SectionDefinition[]
  loadedAssets: Record<string, string>
}

export interface GeneratedSkill {
  displayName: string
  description: string
  industries: string[]
  projectTypes: string[]
  tags: string[]
  toneDescription: string
  instructions: string
  sections: SectionDefinition[]
  pricingDefaults?: PricingDefaults
  micrositeDefaults?: MicrositeDefaults
  suggestedAssets?: Array<{ fileName: string; description: string; content: string }>
  type?: SkillType
  structureMode?: StructureMode
  triggers?: string[]
  outputFormats?: OutputFormat[]
  clarifyingQuestions?: ClarifyingQuestion[]
}

export interface SkillVersion {
  versionLabel: string
  slug: string
  createdAt: string
  summary?: string
}

export interface AssetInfo {
  fileName: string
  sizeBytes: number
  mimeType: string
  referencedBySections: string[]
}

export interface CreateSkillInput {
  slug: string
  displayName: string
  description: string
  industries: string[]
  projectTypes: string[]
  tags: string[]
  toneDescription: string
  micrositeDefaults: MicrositeDefaults
  pricingDefaults?: PricingDefaults
  defaultTemplate?: string
  scope: 'global' | 'namespace'
  namespace?: string
  author: string
  version: string
  instructionsMd?: string
  sections?: SectionDefinition[]
  type?: SkillType
  structureMode?: StructureMode
  triggers?: string[]
  outputFormats?: OutputFormat[]
  clarifyingQuestions?: ClarifyingQuestion[]
}
