// services/api/src/chat/planner.ts
//
// Chat Pipeline Stage 5 — Planner (LLM → Strict JSON).
//
// Only reached when readiness passes. Receives intent, message, chatContext,
// and namespaceContext. Selects relevant knowledge entries (max 15), builds an
// LLM prompt, and returns a parsed AgentPlan — or null on failure.

import type { GenerateFn } from '@ai-engine/planner';
import type { KnowledgeCategory, KnowledgeEntry, NamespaceContext } from './context.types.js';
import type { ChatContext, Intent } from './intents.js';

// Proposal statuses that are eligible for microsite generation
const MICROSITE_ELIGIBLE_STATUSES = ['approved', 'finalized'] as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ToolName =
  | 'generate_proposal'
  | 'generate_template'
  | 'modify_template'
  | 'generate_microsite'
  | 'edit_proposal_section'
  | 'search_documents'
  | 'list_proposals'
  | 'list_templates'
  | 'get_proposal_status'
  | 'set_proposal_status'
  | 'recommend_template'
  | 'create_skill'
  | 'list_skills'

export type AgentAction =
  | { type: 'ASK'; question: string }
  | { type: 'UPDATE_REQUIREMENTS'; data: Record<string, unknown> }
  | { type: 'CALL_TOOL'; tool: ToolName; params: Record<string, unknown> }
  | { type: 'RESPOND'; message: string }

export interface AgentPlan {
  intent: Intent
  actions: AgentAction[]
}

// ---------------------------------------------------------------------------
// Safe JSON parsing (strips markdown code fences if present)
// ---------------------------------------------------------------------------

function safeParseJSON<T>(raw: string): T | null {
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim()
    return JSON.parse(cleaned) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Knowledge selection (spec section 8)
// ---------------------------------------------------------------------------

const CATEGORY_PRIORITY: Record<Intent, KnowledgeCategory[]> = {
  GENERATE_PROPOSAL: ['requirement', 'priority', 'problem', 'opportunity', 'preference', 'constraint', 'context', 'decision'],
  MODIFY_PROPOSAL: ['problem', 'opportunity', 'preference', 'constraint'],
  GENERATE_MICROSITE: ['preference', 'context'],
  GENERATE_TEMPLATE: ['problem', 'opportunity', 'context'],
  MODIFY_TEMPLATE: ['problem', 'opportunity'],
  UPDATE_REQUIREMENTS: ['problem', 'opportunity', 'context'],
  QUERY: ['problem', 'opportunity', 'context', 'constraint', 'decision'],
  STATUS_CHECK: [],
  INGEST_GUIDANCE: [],
  GREETING: ['context'],
  GENERAL_CHAT: [],
  UNKNOWN: [],
  CONFIRM_ENTITIES: ['context'],
  CONFIRM_TEMPLATE: ['context'],
  CREATE_SKILL: ['context'],
  MODIFY_SKILL: ['context'],
  LIST_SKILLS: [],
}

function selectRelevantKnowledge(intent: Intent, knowledge: KnowledgeEntry[]): KnowledgeEntry[] {
  const active = knowledge.filter((k) => !k.supersededBy)
  const relevant = CATEGORY_PRIORITY[intent] ?? []
  return active
    .filter((k) => relevant.includes(k.category))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 15)
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(
  intent: Intent,
  message: string,
  chatContext: ChatContext,
  nsContext: NamespaceContext,
  relevantKnowledge: KnowledgeEntry[],
): string {
  return `You are a plan builder for ProDeck, a consulting proposal tool.
Produce an action plan as strict JSON. Nothing else.

## Intent: ${intent}
## User Message: "${message}"

## Available Tools
- generate_proposal: params { client, industry, template?, skill?, teamSize?, duration?, ratePerWeek? }
- generate_template: params { description, name? }
- modify_template: params { templateName, instruction }
- generate_microsite: params { proposalFileName, companyName?, tagline?, primaryColor?, secondaryColor?, theme?, customInstructions? }
- edit_proposal_section: params { proposalFileName, sectionName, instruction }
- search_documents: params { query }
- list_proposals: params {}
- list_templates: params {}
- get_proposal_status: params { proposalFileName }
- set_proposal_status: params { proposalFileName, status }
- recommend_template: params {} — recommends the best template for this namespace
- create_skill: params { description, industries?, pricingModel?, tone? } — create a reusable proposal skill
- list_skills: params {} — list available skills

## Current Requirements
${JSON.stringify(nsContext.requirements.fields)}

## Relevant Project Knowledge
${relevantKnowledge.map((k) => `[${k.category}] ${k.content}`).join('\n')}

## Available Artifacts
- Proposals: ${JSON.stringify(chatContext.proposals)}
- Templates: ${JSON.stringify(chatContext.templates)}
- Documents: ${chatContext.ingestedDocuments.map((d) => d.fileName).join(', ') || 'none'}
${chatContext.skills?.length ? `\n## Available Skills\n${chatContext.skills.map((s) => `- ${s.slug}: ${s.displayName}`).join('\n')}` : ''}
${nsContext.selectedTemplate ? `\n## Confirmed Template\nThe user has already confirmed the template to use: "${nsContext.selectedTemplate.templateId}" (${nsContext.selectedTemplate.name}). Use this template ID when calling generate_proposal.` : ''}

## Rules
1. Each action MUST use the field name "type" (not "action"). Use ONLY these type values: ASK, UPDATE_REQUIREMENTS, CALL_TOOL, RESPOND. Examples: ASK: { "type": "ASK", "question": "..." } (field is "question", not "message"). RESPOND: { "type": "RESPOND", "message": "..." } (field is "message", not "question"). CALL_TOOL: { "type": "CALL_TOOL", "tool": "search_documents", "params": { "query": "..." } } — NEVER use the tool name as the "type" value. UPDATE_REQUIREMENTS: { "type": "UPDATE_REQUIREMENTS", "data": { "clientName": "...", ... } } (fields go inside "data", not on the action directly)
2. Use ONLY the tool names listed above
3. If user provides info to save, include UPDATE_REQUIREMENTS before CALL_TOOL
4. For MODIFY_PROPOSAL, use edit_proposal_section tool
5. For QUERY, use search_documents or RESPOND with known info
6. If multiple proposals exist and user doesn't specify, include ASK
7. NEVER invent tool names or action types
8. Use knowledge entries to enrich tool parameters when relevant
9. For STATUS_CHECK: if the user wants to CHANGE/SET/APPROVE/REJECT a proposal status, use set_proposal_status — NOT list_proposals. If only one proposal exists, use it. If the target status is clear from the message (e.g. "approved", "finalized"), include it in params. If the status is unknown, use ASK to ask for it first.

Respond with ONLY this JSON:
{ "intent": "${intent}", "actions": [...] }`
}

// ---------------------------------------------------------------------------
// Fallback plan builder (deterministic — no LLM)
// ---------------------------------------------------------------------------

export function buildFallbackPlan(
  intent: Intent,
  message: string,
  context: NamespaceContext,
  chatContext?: ChatContext,
): AgentPlan | null {
  const clientName =
    (context.requirements.fields.clientName?.value as string | undefined) ?? ''
  const industry =
    (context.requirements.fields.industry?.value as string | undefined) ?? ''

  switch (intent) {
    case 'GENERATE_PROPOSAL': {
      const params: Record<string, unknown> = { client: clientName, industry };
      if (context.selectedTemplate) {
        params.template = context.selectedTemplate.templateId;
      }
      return { intent, actions: [{ type: 'CALL_TOOL', tool: 'generate_proposal', params }] };
    }
    case 'GENERATE_MICROSITE': {
      const eligible = chatContext?.proposals.find((p) =>
        (MICROSITE_ELIGIBLE_STATUSES as readonly string[]).includes(p.status),
      )
      if (!eligible) return null
      return {
        intent,
        actions: [
          {
            type: 'CALL_TOOL',
            tool: 'generate_microsite',
            params: { proposalFileName: eligible.fileName },
          },
        ],
      }
    }
    case 'STATUS_CHECK':
      return {
        intent,
        actions: [{ type: 'CALL_TOOL', tool: 'list_proposals', params: {} }],
      }
    case 'QUERY':
      return {
        intent,
        actions: [
          { type: 'CALL_TOOL', tool: 'search_documents', params: { query: message } },
        ],
      }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Tool-type alias map — normalises LLM-returned tool names used as action types
// e.g. { "type": "SEARCH_DOCUMENTS", "query": "..." }
//   →  { "type": "CALL_TOOL", "tool": "search_documents", "params": { "query": "..." } }
// ---------------------------------------------------------------------------

const TOOL_TYPE_ALIASES: Record<string, string> = {
  SEARCH_DOCUMENTS: 'search_documents',
  GENERATE_PROPOSAL: 'generate_proposal',
  GENERATE_TEMPLATE: 'generate_template',
  MODIFY_TEMPLATE: 'modify_template',
  GENERATE_MICROSITE: 'generate_microsite',
  EDIT_PROPOSAL_SECTION: 'edit_proposal_section',
  LIST_PROPOSALS: 'list_proposals',
  LIST_TEMPLATES: 'list_templates',
  GET_PROPOSAL_STATUS: 'get_proposal_status',
  SET_PROPOSAL_STATUS: 'set_proposal_status',
  RECOMMEND_TEMPLATE: 'recommend_template',
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export class Planner {
  constructor(private readonly generateFn: GenerateFn) {}

  async buildPlan(
    intent: Intent,
    message: string,
    chatContext: ChatContext,
    nsContext: NamespaceContext,
  ): Promise<AgentPlan | null> {
    const relevantKnowledge = selectRelevantKnowledge(intent, nsContext.knowledge)
    const prompt = buildPrompt(intent, message, chatContext, nsContext, relevantKnowledge)

    try {
      const raw = await this.generateFn(prompt)
      const parsed = safeParseJSON<AgentPlan>(raw)
      if (parsed && Array.isArray(parsed.actions)) {
        parsed.actions = parsed.actions.map((a) => {
          const raw = a as Record<string, unknown>
          // Normalize "action" → "type", lowercase → uppercase
          const typeVal = raw['type'] ?? raw['action']
          const normalized: Record<string, unknown> = {
            ...raw,
            type: typeof typeVal === 'string' ? typeVal.toUpperCase() : typeVal,
          }
          // Normalize ASK: LLM sometimes uses "message" instead of "question"
          if (normalized['type'] === 'ASK' && !normalized['question'] && normalized['message']) {
            normalized['question'] = normalized['message']
            delete normalized['message']
          }
          // Normalize RESPOND: LLM sometimes uses "question" instead of "message"
          if (normalized['type'] === 'RESPOND' && !normalized['message'] && normalized['question']) {
            normalized['message'] = normalized['question']
            delete normalized['question']
          }
          // Normalize RESPOND: LLM sometimes returns an object instead of a string for message
          if (
            normalized['type'] === 'RESPOND' &&
            normalized['message'] !== undefined &&
            typeof normalized['message'] !== 'string'
          ) {
            const msg = normalized['message']
            if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
              const lines: string[] = []
              for (const [k, v] of Object.entries(msg as Record<string, unknown>)) {
                const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())
                if (Array.isArray(v)) {
                  lines.push(`**${label}:** ${v.join(', ')}`)
                } else if (v && typeof v === 'object' && 'value' in (v as object)) {
                  // RequirementField-like: { value, confidence, ... }
                  const raw = (v as { value: unknown }).value
                  const display = Array.isArray(raw) ? raw.join(', ') : String(raw)
                  lines.push(`**${label}:** ${display}`)
                } else {
                  lines.push(`**${label}:** ${String(v)}`)
                }
              }
              normalized['message'] = lines.join('\n').slice(0, 1990)
            } else {
              normalized['message'] = JSON.stringify(msg).slice(0, 1990)
            }
          }
          // Normalize CALL_TOOL: LLM sometimes uses "name" instead of "tool"
          if (normalized['type'] === 'CALL_TOOL' && !normalized['tool'] && normalized['name']) {
            normalized['tool'] = normalized['name']
            delete normalized['name']
          }
          // Normalize UPDATE_REQUIREMENTS: LLM sometimes puts fields directly on the action
          // instead of nesting them under "data"
          if (normalized['type'] === 'UPDATE_REQUIREMENTS' && !normalized['data']) {
            const { type, ...rest } = normalized
            normalized['data'] = rest
            // Remove the hoisted keys from the top level
            for (const key of Object.keys(rest)) {
              delete normalized[key]
            }
          }
          // Normalize tool-name-as-type: LLM sometimes uses the tool name directly as the
          // action type (e.g. { "type": "SEARCH_DOCUMENTS", "query": "..." })
          if (typeof normalized['type'] === 'string' && TOOL_TYPE_ALIASES[normalized['type']]) {
            const toolName = TOOL_TYPE_ALIASES[normalized['type']]
            if (!normalized['params']) {
              const params: Record<string, unknown> = {}
              for (const k of Object.keys(normalized)) {
                if (k !== 'type' && k !== 'tool' && k !== 'action') {
                  params[k] = normalized[k]
                  delete normalized[k]
                }
              }
              normalized['params'] = params
            }
            normalized['type'] = 'CALL_TOOL'
            normalized['tool'] = toolName
          }
          return normalized
        }) as AgentPlan['actions']
      }
      return parsed
    } catch {
      return null
    }
  }
}
