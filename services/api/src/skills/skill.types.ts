// services/api/src/skills/skill.types.ts
// TypeScript interfaces for the Skills system.

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
}

export interface SkillSummary {
  slug: string
  displayName: string
  description: string
  industries: string[]
  version: string
  updatedAt: string
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
}
