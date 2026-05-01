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
  | 'GENERAL_CHAT'     // off-topic but coherent — decline + redirect
  | 'UNKNOWN'          // gibberish, unparseable
  | 'CONFIRM_ENTITIES' // user confirming/correcting extracted client name & industry
  | 'CONFIRM_TEMPLATE' // user approving the recommended or generated template
  | 'CREATE_SKILL'     // create a new reusable proposal skill
  | 'MODIFY_SKILL'     // edit an existing skill
  | 'LIST_SKILLS'      // list available skills

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
  'CONFIRM_ENTITIES',
  'CONFIRM_TEMPLATE',
  'CREATE_SKILL',
  'MODIFY_SKILL',
  'LIST_SKILLS',
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
  /** Pending confirmation kind from the confirmation gate. Set when the
   *  pipeline halted at Stage 4.5 waiting for the user to say yes/no. */
  awaitingConfirmation?: {
    kind: 'confirm_entities' | 'confirm_template' | 'approve_generated_template'
    templateSlug?: string
  }
  /** Content of the last assistant message — used to give the extraction LLM
   *  context about which field was most recently asked for, so it can correctly
   *  map short user replies (e.g. "Software") to the right requirement key. */
  lastAssistantMessage?: string
  /** Available skills — populated by chat-agent for planner context. */
  skills?: Array<{ slug: string; displayName: string }>
}
