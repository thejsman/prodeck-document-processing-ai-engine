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

export type KnowledgeCategory =
  | 'problem'
  | 'opportunity'
  | 'decision'
  | 'constraint'
  | 'preference'
  | 'context';

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
}

export interface NamespaceContext {
  namespace: string;
  requirements: StructuredRequirements;
  knowledge: KnowledgeEntry[];
  sources: ContextSource[];
  version: number;
  updatedAt: string;
}

export interface ExtractionResult {
  fields: Partial<Record<RequirementKey, RequirementField<unknown>>>;
  knowledge: KnowledgeEntry[];
  raw: string;
}
