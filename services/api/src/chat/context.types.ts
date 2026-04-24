export interface RequirementField<T> {
  value: T;
  confidence: number; // 0.0 – 1.0
  source: 'user' | 'document' | 'inferred';
  updatedAt: string;
  sourceFile?: string; // which document (if source === 'document')
}

export type RequirementKey =
  | 'clientName'
  | 'industry'
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

export interface ContextSource {
  fileName: string;
  documentType: DocumentType;
  extractedAt: string;
  fieldsExtracted: RequirementKey[];
  knowledgeEntriesCreated: number;
  preprocessConfidence: number;
  warnings?: string[];
}

export interface NamespaceContext {
  namespace: string;
  requirements: StructuredRequirements;
  knowledge: KnowledgeEntry[];
  meetingSummary?: MeetingSummary;
  sources: ContextSource[];
  version: number;
  updatedAt: string;
}

export interface ExtractionResult {
  fields: Partial<Record<RequirementKey, RequirementField<unknown>>>;
  knowledge: KnowledgeEntry[];
  meetingSummary?: MeetingSummary;
  raw: string;
}
