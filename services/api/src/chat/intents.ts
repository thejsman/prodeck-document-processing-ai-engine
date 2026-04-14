// services/api/src/chat/intents.ts
// Intent enum and shared chat context types for the V2 chat pipeline.

export type Intent =
  | 'GENERATE_PROPOSAL'
  | 'MODIFY_PROPOSAL'
  | 'GENERATE_TEMPLATE'
  | 'MODIFY_TEMPLATE'
  | 'GENERATE_MICROSITE'
  | 'UPDATE_REQUIREMENTS'
  | 'QUERY'
  | 'STATUS_CHECK'
  | 'INGEST_GUIDANCE'
  | 'GREETING'
  | 'GENERAL_CHAT'   // off-topic but coherent — decline + redirect
  | 'UNKNOWN'        // gibberish, unparseable

export const VALID_INTENTS: readonly Intent[] = [
  'GENERATE_PROPOSAL',
  'MODIFY_PROPOSAL',
  'GENERATE_TEMPLATE',
  'MODIFY_TEMPLATE',
  'GENERATE_MICROSITE',
  'UPDATE_REQUIREMENTS',
  'QUERY',
  'STATUS_CHECK',
  'INGEST_GUIDANCE',
  'GREETING',
  'GENERAL_CHAT',
  'UNKNOWN',
] as const

export interface ClassificationResult {
  intent: Intent
  confidence: number
  source: 'rule' | 'llm'
  matchedRule?: string
}

export interface ProposalRef {
  fileName: string
  status: 'draft' | 'under_review' | 'approved' | 'finalized' | string
}

export interface TemplateRef {
  fileName: string
  name?: string
}

export interface IngestedDocumentRef {
  fileName: string
}

export interface ChatContext {
  namespace: string
  proposals: ProposalRef[]
  templates: TemplateRef[]
  ingestedDocuments: IngestedDocumentRef[]
  recentTopic?: string
  awaitingInput?: { intent: string }
  /** Content of the last assistant message — used to give the extraction LLM
   *  context about which field was most recently asked for, so it can correctly
   *  map short user replies (e.g. "Software") to the right requirement key. */
  lastAssistantMessage?: string
}
