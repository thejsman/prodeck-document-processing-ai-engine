// services/api/src/chat/industry-schema.ts
//
// Industry-aware adaptive schema registry.
//
// Defines which custom fields matter for each industry vertical,
// their priority (must-have vs nice-to-have), and the questions
// to ask when collecting them via chat.
//
// This module is pure data + lookup functions. No side effects, no LLM calls.
// It extends the base RequirementKey fields with industry-specific customFields
// that flow into context.json → customFields without touching the core schema.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FieldPriority = 'must_have' | 'should_have' | 'nice_to_have';

export interface IndustryField {
  /** Key used in context.json customFields (e.g. "hipaa_compliance") */
  key: string;
  /** Human-readable label for the right panel */
  label: string;
  /** Priority for completeness scoring */
  priority: FieldPriority;
  /** Question the chat asks to collect this field */
  question: string;
  /** Expected value type hint for the LLM extraction */
  valueType: 'string' | 'string[]' | 'number' | 'boolean';
  /** Category grouping for UI display */
  category: 'compliance' | 'technical' | 'business' | 'operations' | 'branding';
}

export interface EngagementModifier {
  /** Key identifier (e.g. "consulting", "implementation") */
  key: string;
  /** Human-readable label */
  label: string;
  /** Additional fields this engagement type adds */
  fields: IndustryField[];
  /** Sections that should be emphasized in the proposal */
  emphasizedSections: string[];
}

export interface IndustryModule {
  /** Industry identifier (lowercase, hyphenated) */
  id: string;
  /** Display name */
  name: string;
  /** Aliases and keywords that trigger this module */
  keywords: string[];
  /** Industry-specific fields beyond the base 12 */
  fields: IndustryField[];
  /** Default proposal tone for this vertical */
  defaultTone: string;
  /** Branding characteristics for microsite generation */
  brandingHints: {
    style: string;
    colorMood: string;
    layoutPreference: string;
  };
}

// ---------------------------------------------------------------------------
// Industry modules
// ---------------------------------------------------------------------------

const INDUSTRY_MODULES: IndustryModule[] = [
  {
    id: 'saas-tech',
    name: 'SaaS / Technology',
    keywords: ['saas', 'software', 'tech', 'startup', 'app', 'platform', 'api', 'cloud', 'ai', 'machine learning', 'fintech', 'edtech', 'healthtech', 'martech', 'devtools'],
    fields: [
      { key: 'tech_stack_current', label: 'Current tech stack', priority: 'should_have', question: 'What technology stack is the client currently using?', valueType: 'string[]', category: 'technical' },
      { key: 'integration_requirements', label: 'Integration requirements', priority: 'should_have', question: 'Are there specific systems or APIs we need to integrate with?', valueType: 'string[]', category: 'technical' },
      { key: 'scalability_requirements', label: 'Scalability needs', priority: 'nice_to_have', question: 'What are the expected user/traffic scale requirements?', valueType: 'string', category: 'technical' },
      { key: 'security_compliance', label: 'Security & compliance', priority: 'must_have', question: 'Are there specific security standards or compliance requirements? (SOC2, GDPR, etc.)', valueType: 'string[]', category: 'compliance' },
      { key: 'data_migration', label: 'Data migration needs', priority: 'nice_to_have', question: 'Is there existing data that needs to be migrated?', valueType: 'string', category: 'technical' },
      { key: 'sla_requirements', label: 'SLA / uptime requirements', priority: 'should_have', question: 'What uptime or SLA guarantees does the client expect?', valueType: 'string', category: 'operations' },
      { key: 'user_onboarding', label: 'User onboarding plan', priority: 'nice_to_have', question: 'How should end users be onboarded to the new system?', valueType: 'string', category: 'operations' },
      { key: 'success_metrics', label: 'Success metrics / KPIs', priority: 'should_have', question: 'What KPIs will define project success? (MRR impact, user adoption, performance benchmarks)', valueType: 'string[]', category: 'business' },
    ],
    defaultTone: 'modern, metrics-driven, ROI-focused',
    brandingHints: { style: 'minimal-clean', colorMood: 'cool-professional', layoutPreference: 'data-dense' },
  },
  {
    id: 'healthcare',
    name: 'Healthcare / Pharma',
    keywords: ['healthcare', 'hospital', 'clinic', 'pharma', 'pharmaceutical', 'medical', 'health', 'patient', 'clinical', 'biotech', 'wellness', 'telehealth', 'ehr', 'healthtech'],
    fields: [
      { key: 'hipaa_compliance', label: 'HIPAA compliance', priority: 'must_have', question: 'Does this project involve handling patient health information (PHI)? What HIPAA requirements apply?', valueType: 'string', category: 'compliance' },
      { key: 'regulatory_requirements', label: 'Regulatory requirements', priority: 'must_have', question: 'Are there specific regulatory bodies or standards to comply with? (FDA, NABH, HIPAA, etc.)', valueType: 'string[]', category: 'compliance' },
      { key: 'ehr_integration', label: 'EHR/EMR integration', priority: 'should_have', question: 'Which EHR/EMR systems need to be integrated? (Epic, Cerner, custom, etc.)', valueType: 'string[]', category: 'technical' },
      { key: 'patient_data_handling', label: 'Patient data protocols', priority: 'must_have', question: 'What are the requirements for patient data storage, access, and consent management?', valueType: 'string', category: 'compliance' },
      { key: 'clinical_workflow', label: 'Clinical workflow impact', priority: 'should_have', question: 'Which clinical workflows will be affected? How should disruption be minimized?', valueType: 'string', category: 'operations' },
      { key: 'credentialing', label: 'Certifications needed', priority: 'nice_to_have', question: 'Are there credentialing or certification requirements for our team?', valueType: 'string[]', category: 'compliance' },
    ],
    defaultTone: 'conservative, trust-building, compliance-first',
    brandingHints: { style: 'clinical-professional', colorMood: 'clean-trustworthy', layoutPreference: 'structured-spacious' },
  },
  {
    id: 'real-estate-construction',
    name: 'Real Estate / Construction',
    keywords: ['real estate', 'construction', 'property', 'building', 'architecture', 'developer', 'residential', 'commercial', 'infrastructure', 'interior design', 'renovation'],
    fields: [
      { key: 'project_site', label: 'Project site details', priority: 'must_have', question: 'What are the project site details? (Location, area, type of land/building)', valueType: 'string', category: 'operations' },
      { key: 'permits_regulatory', label: 'Permits & approvals', priority: 'must_have', question: 'What permits, zoning approvals, or regulatory clearances are needed?', valueType: 'string[]', category: 'compliance' },
      { key: 'material_specs', label: 'Material specifications', priority: 'should_have', question: 'Are there specific material or vendor preferences/requirements?', valueType: 'string[]', category: 'technical' },
      { key: 'project_phasing', label: 'Project phasing', priority: 'should_have', question: 'How should the project be phased? Are there milestone-based payment triggers?', valueType: 'string', category: 'operations' },
      { key: 'insurance_liability', label: 'Insurance & liability', priority: 'should_have', question: 'What insurance coverage and liability terms are expected?', valueType: 'string', category: 'compliance' },
      { key: 'sustainability_targets', label: 'Green/sustainability goals', priority: 'nice_to_have', question: 'Are there green building certifications or sustainability targets? (LEED, IGBC, etc.)', valueType: 'string[]', category: 'technical' },
    ],
    defaultTone: 'concrete, visual, milestone-heavy',
    brandingHints: { style: 'bold-structural', colorMood: 'earthy-professional', layoutPreference: 'visual-heavy' },
  },
  {
    id: 'ecommerce-retail',
    name: 'E-commerce / Retail',
    keywords: ['ecommerce', 'e-commerce', 'retail', 'shop', 'store', 'marketplace', 'd2c', 'dtc', 'shopify', 'woocommerce', 'amazon', 'fashion', 'fmcg', 'consumer'],
    fields: [
      { key: 'platform_details', label: 'Platform & integrations', priority: 'must_have', question: 'What e-commerce platform are they on? (Shopify, custom, marketplace, etc.) Any key integrations?', valueType: 'string', category: 'technical' },
      { key: 'catalog_size', label: 'Catalog complexity', priority: 'should_have', question: 'How large is their product catalog? How many SKUs/categories?', valueType: 'string', category: 'business' },
      { key: 'fulfillment_logistics', label: 'Fulfillment & logistics', priority: 'should_have', question: 'How is fulfillment handled? Any shipping/logistics challenges?', valueType: 'string', category: 'operations' },
      { key: 'seasonal_considerations', label: 'Seasonal timeline', priority: 'nice_to_have', question: 'Are there seasonal peaks or events that affect the timeline? (festive season, sales, launches)', valueType: 'string[]', category: 'business' },
      { key: 'conversion_targets', label: 'Conversion & AOV targets', priority: 'should_have', question: 'What are the target conversion rate, AOV, or revenue goals?', valueType: 'string', category: 'business' },
      { key: 'customer_demographics', label: 'Target audience', priority: 'should_have', question: 'Who is the target customer? Age group, geography, buying behavior?', valueType: 'string', category: 'business' },
    ],
    defaultTone: 'growth-oriented, data-heavy, conversion-focused',
    brandingHints: { style: 'vibrant-modern', colorMood: 'energetic-brand-forward', layoutPreference: 'visual-product-centric' },
  },
  {
    id: 'legal-professional-services',
    name: 'Legal / Professional Services',
    keywords: ['legal', 'law firm', 'attorney', 'lawyer', 'consulting', 'advisory', 'accounting', 'audit', 'compliance', 'professional services', 'management consulting'],
    fields: [
      { key: 'engagement_scope', label: 'Matter/engagement scope', priority: 'must_have', question: 'What is the scope of this engagement? (Matter type, jurisdiction, practice area)', valueType: 'string', category: 'business' },
      { key: 'conflict_check', label: 'Conflict of interest', priority: 'must_have', question: 'Has a conflict of interest check been completed?', valueType: 'string', category: 'compliance' },
      { key: 'billing_structure', label: 'Billing structure', priority: 'must_have', question: 'What billing model is preferred? (Hourly, retainer, fixed fee, success-based)', valueType: 'string', category: 'business' },
      { key: 'confidentiality_terms', label: 'Confidentiality terms', priority: 'must_have', question: 'Are there specific confidentiality or NDA requirements?', valueType: 'string', category: 'compliance' },
      { key: 'jurisdictional_scope', label: 'Jurisdictional scope', priority: 'should_have', question: 'Which jurisdictions are involved?', valueType: 'string[]', category: 'compliance' },
      { key: 'reporting_cadence', label: 'Reporting requirements', priority: 'nice_to_have', question: 'What reporting cadence and format does the client expect?', valueType: 'string', category: 'operations' },
    ],
    defaultTone: 'precise, formal, trust-centric',
    brandingHints: { style: 'typographic-minimal', colorMood: 'subdued-authoritative', layoutPreference: 'text-dense-structured' },
  },
  {
    id: 'marketing-creative',
    name: 'Marketing / Creative Agency',
    keywords: ['marketing', 'advertising', 'creative', 'branding', 'agency', 'digital marketing', 'social media', 'content', 'seo', 'performance marketing', 'pr', 'communications'],
    fields: [
      { key: 'brand_positioning', label: 'Brand positioning', priority: 'should_have', question: 'How does the client position their brand? What is their unique value proposition?', valueType: 'string', category: 'business' },
      { key: 'target_audience', label: 'Target demographic', priority: 'must_have', question: 'Who is the target audience? Demographics, psychographics, online behavior?', valueType: 'string', category: 'business' },
      { key: 'current_ad_spend', label: 'Current ad spend & ROAS', priority: 'should_have', question: 'What is their current marketing/ad spend? What ROAS or CAC are they seeing?', valueType: 'string', category: 'business' },
      { key: 'channel_strategy', label: 'Channel strategy', priority: 'should_have', question: 'Which channels should we focus on? (Social, search, email, content, influencer, etc.)', valueType: 'string[]', category: 'operations' },
      { key: 'content_deliverables', label: 'Content deliverables', priority: 'should_have', question: 'What content deliverables are expected? (Photo, video, UGC, blog, etc.)', valueType: 'string[]', category: 'operations' },
      { key: 'campaign_kpis', label: 'Campaign KPIs', priority: 'must_have', question: 'What are the primary campaign KPIs? (Leads, ROAS, brand awareness, engagement, etc.)', valueType: 'string[]', category: 'business' },
    ],
    defaultTone: 'energetic, visual, results-oriented',
    brandingHints: { style: 'bold-creative', colorMood: 'vibrant-expressive', layoutPreference: 'portfolio-visual' },
  },
  {
    id: 'manufacturing-industrial',
    name: 'Manufacturing / Industrial',
    keywords: ['manufacturing', 'industrial', 'factory', 'production', 'supply chain', 'logistics', 'automotive', 'aerospace', 'engineering', 'iot', 'automation'],
    fields: [
      { key: 'production_specs', label: 'Production specifications', priority: 'must_have', question: 'What are the production specifications and tolerances?', valueType: 'string', category: 'technical' },
      { key: 'supply_chain', label: 'Supply chain requirements', priority: 'should_have', question: 'What are the supply chain requirements? Sourcing, vendors, lead times?', valueType: 'string', category: 'operations' },
      { key: 'quality_certifications', label: 'Quality certifications', priority: 'must_have', question: 'Which quality certifications are required? (ISO 9001, ISO 14001, Six Sigma, etc.)', valueType: 'string[]', category: 'compliance' },
      { key: 'lead_times_moq', label: 'Lead times & MOQs', priority: 'should_have', question: 'What are the expected lead times and minimum order quantities?', valueType: 'string', category: 'operations' },
      { key: 'equipment_tooling', label: 'Equipment & tooling', priority: 'nice_to_have', question: 'Are there specific equipment or tooling requirements?', valueType: 'string[]', category: 'technical' },
      { key: 'safety_requirements', label: 'Safety & environmental', priority: 'should_have', question: 'What safety standards and environmental regulations apply?', valueType: 'string[]', category: 'compliance' },
    ],
    defaultTone: 'technical, specification-driven, precise',
    brandingHints: { style: 'clean-technical', colorMood: 'industrial-neutral', layoutPreference: 'spec-table-heavy' },
  },
  {
    id: 'education',
    name: 'Education / EdTech',
    keywords: ['education', 'edtech', 'university', 'school', 'college', 'e-learning', 'lms', 'training', 'academic', 'curriculum', 'student'],
    fields: [
      { key: 'institution_type', label: 'Institution type', priority: 'must_have', question: 'What type of educational institution is this? (K-12, university, corporate training, etc.)', valueType: 'string', category: 'business' },
      { key: 'learner_demographics', label: 'Learner demographics', priority: 'should_have', question: 'Who are the learners? Age group, tech literacy, accessibility needs?', valueType: 'string', category: 'business' },
      { key: 'lms_integration', label: 'LMS/platform integration', priority: 'should_have', question: 'Which LMS or learning platforms need to be integrated? (Moodle, Canvas, custom, etc.)', valueType: 'string[]', category: 'technical' },
      { key: 'accreditation', label: 'Accreditation requirements', priority: 'should_have', question: 'Are there accreditation or regulatory standards to meet?', valueType: 'string[]', category: 'compliance' },
      { key: 'content_format', label: 'Content format needs', priority: 'should_have', question: 'What content formats are needed? (Video, interactive, assessments, SCORM, etc.)', valueType: 'string[]', category: 'operations' },
      { key: 'accessibility_standards', label: 'Accessibility standards', priority: 'must_have', question: 'What accessibility standards must be met? (WCAG, Section 508, etc.)', valueType: 'string[]', category: 'compliance' },
    ],
    defaultTone: 'approachable, evidence-based, outcome-focused',
    brandingHints: { style: 'warm-structured', colorMood: 'approachable-academic', layoutPreference: 'content-rich-organized' },
  },
];

// ---------------------------------------------------------------------------
// Engagement modifiers
// ---------------------------------------------------------------------------

const ENGAGEMENT_MODIFIERS: EngagementModifier[] = [
  {
    key: 'consulting',
    label: 'Consulting / Strategy',
    fields: [
      { key: 'methodology', label: 'Methodology / framework', priority: 'should_have', question: 'What methodology or framework will be used for this engagement?', valueType: 'string', category: 'operations' },
      { key: 'discovery_phase', label: 'Discovery phase scope', priority: 'should_have', question: 'What does the discovery/assessment phase look like?', valueType: 'string', category: 'operations' },
      { key: 'strategic_recommendations', label: 'Recommendation format', priority: 'nice_to_have', question: 'How should strategic recommendations be delivered? (Report, presentation, workshop)', valueType: 'string', category: 'operations' },
    ],
    emphasizedSections: ['methodology', 'team_credentials', 'case_studies', 'strategic_approach'],
  },
  {
    key: 'implementation',
    label: 'Implementation / Build',
    fields: [
      { key: 'architecture_approach', label: 'Technical architecture', priority: 'should_have', question: 'What is the preferred technical architecture approach?', valueType: 'string', category: 'technical' },
      { key: 'sprint_structure', label: 'Sprint/iteration plan', priority: 'should_have', question: 'What sprint or iteration structure is preferred?', valueType: 'string', category: 'operations' },
      { key: 'testing_strategy', label: 'Testing & QA strategy', priority: 'should_have', question: 'What testing and QA approach is expected?', valueType: 'string', category: 'technical' },
      { key: 'launch_plan', label: 'Launch/go-live plan', priority: 'should_have', question: 'What does the launch or go-live plan look like?', valueType: 'string', category: 'operations' },
    ],
    emphasizedSections: ['technical_architecture', 'sprint_plan', 'resource_allocation', 'launch_plan'],
  },
  {
    key: 'retainer',
    label: 'Retainer / Ongoing Service',
    fields: [
      { key: 'monthly_scope', label: 'Monthly scope', priority: 'must_have', question: 'What is the expected monthly scope of work? (Hours, deliverables, activities)', valueType: 'string', category: 'business' },
      { key: 'sla_terms', label: 'SLA terms', priority: 'should_have', question: 'What SLA terms apply? (Response time, resolution time, availability)', valueType: 'string', category: 'operations' },
      { key: 'escalation_process', label: 'Escalation process', priority: 'nice_to_have', question: 'What escalation process should be in place?', valueType: 'string', category: 'operations' },
      { key: 'reporting_rhythm', label: 'Reporting rhythm', priority: 'should_have', question: 'How often should progress/performance reports be delivered?', valueType: 'string', category: 'operations' },
      { key: 'renewal_terms', label: 'Renewal terms', priority: 'nice_to_have', question: 'What are the renewal or termination terms?', valueType: 'string', category: 'business' },
    ],
    emphasizedSections: ['monthly_scope', 'sla', 'reporting', 'renewal_terms'],
  },
  {
    key: 'project',
    label: 'One-time Project',
    fields: [
      { key: 'acceptance_criteria', label: 'Acceptance criteria', priority: 'must_have', question: 'What are the acceptance criteria for project completion?', valueType: 'string[]', category: 'operations' },
      { key: 'payment_milestones', label: 'Payment milestones', priority: 'should_have', question: 'How should payments be structured? (Milestone-based, upfront, on completion)', valueType: 'string', category: 'business' },
      { key: 'warranty_support', label: 'Post-delivery support', priority: 'nice_to_have', question: 'Is post-delivery warranty or support expected?', valueType: 'string', category: 'operations' },
    ],
    emphasizedSections: ['scope', 'milestones', 'acceptance_criteria', 'payment_schedule'],
  },
];

// ---------------------------------------------------------------------------
// Lookup functions
// ---------------------------------------------------------------------------

/**
 * Detect industry from a string (client industry field value, website content, etc.).
 * Returns the best matching module or null if no match.
 * Matches against keywords — case insensitive, partial match.
 */
export function detectIndustry(input: string): IndustryModule | null {
  if (!input) return null;
  const normalized = input.toLowerCase().trim();

  // Exact ID match first
  const exact = INDUSTRY_MODULES.find(m => m.id === normalized);
  if (exact) return exact;

  // Keyword match — score by number of matching keywords
  let bestMatch: IndustryModule | null = null;
  let bestScore = 0;

  for (const mod of INDUSTRY_MODULES) {
    let score = 0;
    for (const kw of mod.keywords) {
      if (normalized.includes(kw) || kw.includes(normalized)) {
        // Boost exact word matches
        score += normalized === kw ? 3 : normalized.includes(kw) ? 2 : 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = mod;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

/**
 * Detect industry from multiple signals (more robust).
 * Tries each signal in order, returns the first strong match.
 */
export function detectIndustryFromSignals(signals: {
  clientIndustry?: string;
  clientName?: string;
  websiteContent?: string;
  documentContent?: string;
}): IndustryModule | null {
  // Strongest signal: explicit industry field
  if (signals.clientIndustry) {
    const match = detectIndustry(signals.clientIndustry);
    if (match) return match;
  }

  // Try website content (about page, meta description, etc.)
  if (signals.websiteContent) {
    const match = detectIndustry(signals.websiteContent);
    if (match) return match;
  }

  // Try document content (first 500 chars)
  if (signals.documentContent) {
    const match = detectIndustry(signals.documentContent.slice(0, 500));
    if (match) return match;
  }

  return null;
}

/**
 * Get the active schema for a given industry + engagement type.
 * Returns the combined set of custom fields (industry + engagement modifier).
 */
export function getActiveSchema(
  industryId: string | null,
  engagementKey?: string | null,
): {
  industryModule: IndustryModule | null;
  engagementModifier: EngagementModifier | null;
  allFields: IndustryField[];
  mustHaveFields: IndustryField[];
  shouldHaveFields: IndustryField[];
  niceToHaveFields: IndustryField[];
} {
  const industryModule = industryId
    ? INDUSTRY_MODULES.find(m => m.id === industryId) ?? null
    : null;

  const engagementModifier = engagementKey
    ? ENGAGEMENT_MODIFIERS.find(m => m.key === engagementKey) ?? null
    : null;

  const allFields = [
    ...(industryModule?.fields ?? []),
    ...(engagementModifier?.fields ?? []),
  ];

  return {
    industryModule,
    engagementModifier,
    allFields,
    mustHaveFields: allFields.filter(f => f.priority === 'must_have'),
    shouldHaveFields: allFields.filter(f => f.priority === 'should_have'),
    niceToHaveFields: allFields.filter(f => f.priority === 'nice_to_have'),
  };
}

/**
 * Compute completeness score for custom fields, weighted by priority.
 * Returns 0-100 percentage.
 */
export function computeIndustryCompleteness(
  industryId: string | null,
  engagementKey: string | null,
  filledCustomFields: Record<string, unknown>,
): {
  score: number;
  total: number;
  filled: number;
  missingMustHave: IndustryField[];
  missingShouldHave: IndustryField[];
  missingNiceToHave: IndustryField[];
} {
  const { allFields, mustHaveFields, shouldHaveFields, niceToHaveFields } = getActiveSchema(industryId, engagementKey);

  if (allFields.length === 0) {
    return { score: 100, total: 0, filled: 0, missingMustHave: [], missingShouldHave: [], missingNiceToHave: [] };
  }

  // Weighted scoring: must_have = 3, should_have = 2, nice_to_have = 1
  const WEIGHTS: Record<FieldPriority, number> = {
    must_have: 3,
    should_have: 2,
    nice_to_have: 1,
  };

  let totalWeight = 0;
  let filledWeight = 0;
  let filledCount = 0;

  const missingMustHave: IndustryField[] = [];
  const missingShouldHave: IndustryField[] = [];
  const missingNiceToHave: IndustryField[] = [];

  for (const field of allFields) {
    const weight = WEIGHTS[field.priority];
    totalWeight += weight;

    const value = filledCustomFields[field.key];
    const isFilled = value !== undefined && value !== null && value !== '' &&
      !(Array.isArray(value) && value.length === 0);

    if (isFilled) {
      filledWeight += weight;
      filledCount++;
    } else {
      if (field.priority === 'must_have') missingMustHave.push(field);
      else if (field.priority === 'should_have') missingShouldHave.push(field);
      else missingNiceToHave.push(field);
    }
  }

  const score = totalWeight > 0 ? Math.round((filledWeight / totalWeight) * 100) : 100;

  return {
    score,
    total: allFields.length,
    filled: filledCount,
    missingMustHave,
    missingShouldHave,
    missingNiceToHave,
  };
}

/**
 * Get all available industry modules (for UI dropdowns, etc.)
 */
export function getAllIndustries(): Array<{ id: string; name: string }> {
  return INDUSTRY_MODULES.map(m => ({ id: m.id, name: m.name }));
}

/**
 * Get all engagement modifiers (for UI selection)
 */
export function getAllEngagementTypes(): Array<{ key: string; label: string }> {
  return ENGAGEMENT_MODIFIERS.map(m => ({ key: m.key, label: m.label }));
}

/**
 * Get the next most important question to ask, given what's already filled.
 * Returns questions in priority order: must_have first, then should_have.
 * Skips fields that already have values.
 */
export function getNextQuestions(
  industryId: string | null,
  engagementKey: string | null,
  filledCustomFields: Record<string, unknown>,
  maxQuestions = 2,
): IndustryField[] {
  const { mustHaveFields, shouldHaveFields } = getActiveSchema(industryId, engagementKey);

  const isFilled = (key: string) => {
    const value = filledCustomFields[key];
    return value !== undefined && value !== null && value !== '' &&
      !(Array.isArray(value) && value.length === 0);
  };

  const missing = [
    ...mustHaveFields.filter(f => !isFilled(f.key)),
    ...shouldHaveFields.filter(f => !isFilled(f.key)),
  ];

  return missing.slice(0, maxQuestions);
}
