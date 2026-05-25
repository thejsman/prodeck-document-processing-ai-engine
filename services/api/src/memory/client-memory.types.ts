export type StableRequirementKey = 'clientName' | 'clientIndustry' | 'contactName' | 'projectType';

export interface MemoryField {
  value: string | string[];
  confidence: number;
  sourceEngagements: string[];
  firstSeenAt: string;
  lastConfirmedAt: string;
}

export interface ClientKnowledgeEntry {
  id: string;
  content: string;
  category:
    | 'preference' | 'constraint' | 'relationship' | 'context'
    | 'requirement' | 'priority' | 'problem' | 'opportunity'
    | 'decision' | 'metric' | 'action_item';
  confidence: number;
  sourceEngagements: string[];
  sourceDocument?: string;
  firstSeenAt: string;
  lastConfirmedAt: string;
  supersededBy?: string;
}

export interface StakeholderRecord {
  id: string;
  name: string;
  role: string;
  email?: string;
  notes?: string;
  sourceEngagements: string[];
  lastSeenAt: string;
}

export interface EngagementSummary {
  namespace: string;
  projectType: string;
  closedAt: string;
  fieldsContributed: StableRequirementKey[];
  knowledgeContributed: number;
}

export interface MemoryConflict {
  id: string;
  existingId: string;
  existingContent: string;
  incomingContent: string;
  reason: string;
  status: 'needs_review' | 'resolved';
  resolution?: 'keep_old' | 'use_new' | 'keep_both';
  createdAt: string;
  resolvedAt?: string;
}

export interface ClientMemory {
  clientSlug: string;
  clientName: string;
  clientIndustry: string;
  stableFields: Partial<Record<StableRequirementKey, MemoryField>>;
  knowledge: ClientKnowledgeEntry[];
  stakeholders: StakeholderRecord[];
  engagements: EngagementSummary[];
  conflicts: MemoryConflict[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface DistillationResult {
  stableFields: Partial<
    Record<StableRequirementKey, { value: string | string[]; confidence: number }>
  >;
  newKnowledge: Array<{
    content: string;
    category: string;
    confidence: number;
  }>;
  confirmedKnowledge: Array<{ existingId: string; confidence: number }>;
  contradictions: Array<{
    existingId: string;
    incomingContent: string;
    reason: string;
  }>;
  stakeholders: Array<{
    name: string;
    role: string;
    notes?: string;
    email?: string;
  }>;
}

export interface DistillResult {
  clientSlug: string;
  fieldsUpdated: number;
  knowledgeAdded: number;
  knowledgeConfirmed: number;
  contradictionsFound: number;
  stakeholdersUpdated: number;
}

export interface PrepopulateResult {
  found: boolean;
  stableFields: Partial<Record<StableRequirementKey, MemoryField>>;
  knowledge: ClientKnowledgeEntry[];
  stakeholders: StakeholderRecord[];
  engagementCount: number;
  lastEngagementDate: string;
}
