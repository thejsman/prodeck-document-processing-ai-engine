export interface RequirementField<T> {
  value: T;
  confidence: number; // 0.0 – 1.0
  source: 'user' | 'document' | 'inferred';
  updatedAt: string;
  sourceFile?: string; // which document (if source === 'document')
  /** Set when the user explicitly confirms or directly states this value. */
  confirmedByUser?: { at: string };
  /** True when extracted but not yet confirmed by the user via the Brief Panel. */
  pendingConfirmation?: boolean;
}

export type RequirementKey =
  | 'clientName'
  | 'clientIndustry'
  | 'projectType'
  | 'budget'
  | 'timeline'
  | 'teamSize'
  | 'technicalStack'
  | 'keyObjectives'
  | 'constraints'
  | 'deliverables'
  | 'stakeholders'
  | 'contactName';

export interface StructuredRequirements {
  fields: Partial<Record<RequirementKey, RequirementField<unknown>>>;
  customFields: Record<string, RequirementField<string>>;
}

// ---------------------------------------------------------------------------
// Meeting summary — structured output for meeting transcripts only
// ---------------------------------------------------------------------------

export interface AgendaItem {
  title: string;
  keyTakeaways: string[];
}

export interface ClientPriority {
  rank: number;
  title: string;
  bullets: string[];
}

export interface AgencyDeliverable {
  owner: string;
  deliverable: string;
  deadline?: string;
}

export interface BusinessMetric {
  metric: string;
  value: string;
  context: string;
}

export interface ClientOrganization {
  name: string;
  industry?: string;
  roles: string[];
}

export interface AgencyOrganization {
  name: string;
  services?: string[];
}

export interface EngagementModel {
  approach: string;
  phases: string[];
  pricingStructure?: string;
}

export interface RequirementsByPriority {
  must: string[];
  should: string[];
  could: string[];
}

export interface MeetingSummary {
  clientOrganization?: ClientOrganization;
  agencyOrganization?: AgencyOrganization;
  agenda?: AgendaItem[];
  clientPriorities?: ClientPriority[];
  requirementsByPriority?: RequirementsByPriority;
  agencyDeliverables?: AgencyDeliverable[];
  engagementModel?: EngagementModel;
  businessMetrics?: BusinessMetric[];
  updatedAt: string;
  sourceFile?: string;
}

export type KnowledgeCategory =
  | 'problem'
  | 'opportunity'
  | 'decision'
  | 'constraint'
  | 'preference'
  | 'context'
  | 'priority'
  | 'requirement'
  | 'metric'
  | 'action_item';

export interface KnowledgeEntry {
  id: string;
  content: string;
  category: KnowledgeCategory;
  importance: number; // 1–5 derived from category
  source: {
    type: 'document' | 'chat' | 'manual';
    fileName?: string;
    chatSessionId?: string;
    messageTimestamp?: string;
  };
  extractedAt: string;
  confidence: number; // 0.0 – 1.0
  supersededBy?: string; // id of newer entry that replaces this one
}

export type DocumentType =
  | 'rfp'
  | 'technical_spec'
  | 'meeting_transcript'
  | 'email'
  | 'proposal_draft'
  | 'generic';

/** User-assigned role for a document — controls whether its facts are written to the Brief. */
export type DocumentClassification =
  | 'client_source'
  | 'conversation'
  | 'provider_asset'
  | 'reference_example'
  | 'background';

export interface ContextSource {
  fileName: string;
  documentType: DocumentType;
  extractedAt: string;
  fieldsExtracted: RequirementKey[];
  knowledgeEntriesCreated: number;
  preprocessConfidence: number;
  warnings?: string[];
  classification?: DocumentClassification;
}

export interface SelectedTemplate {
  templateId: string;
  name: string;
  confirmedAt: string;
  generatedFromScratch: boolean;
}

export interface PendingExtraction {
  documentId: string;
  extractedAt: string;
  fields: Partial<Record<RequirementKey, RequirementField<unknown>>>;
}

export interface BriefFieldStatus {
  filled: boolean;
  confidence?: number;
  pendingConfirmation?: boolean;
  sourceFile?: string;
}

export type Tier1Key = 'clientName' | 'clientIndustry' | 'projectType';
export type Tier2Key = 'budget' | 'timeline' | 'keyObjectives' | 'contactName';

export interface BriefReadiness {
  tier1: {
    complete: boolean;
    fields: Record<Tier1Key, BriefFieldStatus>;
    missingFields: string[];
  };
  tier2: {
    complete: boolean;
    missingFields: string[];
  };
  canGenerate: boolean;
  blockingField?: string;
}

export interface NamespaceContext {
  namespace: string;
  requirements: StructuredRequirements;
  knowledge: KnowledgeEntry[];
  meetingSummary?: MeetingSummary;
  sources: ContextSource[];
  /** Extractions awaiting user confirmation in the Brief Panel. */
  pendingExtractions?: PendingExtraction[];
  /** Template the user confirmed to use for the next proposal generation. */
  selectedTemplate?: SelectedTemplate;
  /**
   * Persisted fallback for awaitingConfirmation when the pipeline halted waiting
   * for the user to approve a generated template. Cleared once the user confirms.
   * Stored here so it survives page navigations that lose in-memory state.
   */
  pendingTemplateApproval?: {
    kind: 'approve_generated_template';
    templateSlug: string;
  };
  version: number;
  updatedAt: string;
}

export interface ExtractionResult {
  fields: Partial<Record<RequirementKey, RequirementField<unknown>>>;
  knowledge: KnowledgeEntry[];
  meetingSummary?: MeetingSummary;
  raw: string;
}
