/**
 * Intent router — hybrid message classification.
 *
 * Two-pass approach:
 *   1. Rule-based: deterministic pattern matching on lowercased text (fast, zero cost).
 *   2. LLM-based: sends the message + recent conversation to an LLM when
 *      rule-based matching returns null (handles natural language).
 *
 * Returns null for messages that do not match any known workflow trigger,
 * allowing callers to fall through to generic RAG query handling.
 */

import type { GenerateFn } from '@ai-engine/planner';

export interface IntentRouteResult {
  workflowId: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Reset / start-over triggers.
 * Checked by the orchestrator BEFORE workflow dispatch to allow clearing an
 * active instance and starting fresh.
 */
const RESET_TRIGGERS = [
  'start over',
  'start again',
  'restart',
  'reset',
  'clear workflow',
  'new session',
  'cancel workflow',
  'cancel this',
  'forget this',
  'discard',
  'begin again',
  'start fresh',
];

/**
 * Returns true if the message is a request to reset the current workflow.
 */
export function isResetIntent(message: string): boolean {
  const lower = message.toLowerCase().trim();
  for (const trigger of RESET_TRIGGERS) {
    if (lower.includes(trigger)) return true;
  }
  return false;
}

/**
 * Patterns that signal the user wants to analyse an RFP.
 * Checked before proposal triggers — more specific intent.
 */
const RFP_ANALYSIS_TRIGGERS = [
  'analyze rfp',
  'analyse rfp',
  'analyze this rfp',
  'analyse this rfp',
  'rfp analysis',
  'analyse the rfp',
  'analyze the rfp',
  'should we bid',
  'should we respond',
  'bid or no bid',
  'go no go',
  'go/no-go',
  'evaluate rfp',
  'evaluate the rfp',
  'review rfp',
  'review the rfp',
  'rfp review',
];

/**
 * Patterns that signal the user wants version control or inline editing operations.
 * Checked before proposal triggers — more specific intent.
 */
const VERSION_CONTROL_TRIGGERS = [
  // History / rollback
  'rollback',
  'roll back',
  'revert',
  'revert to',
  'undo changes',
  'undo edit',
  'go back to version',
  'restore version',
  'show history',
  'show versions',
  'version history',
  'proposal history',
  'list versions',
  'proposal versions',
  // Inline section editing
  'update the summary',
  'update the timeline',
  'update the budget',
  'update the team',
  'update the solution',
  'update the approach',
  'update section',
  'edit section',
  'edit the summary',
  'edit the timeline',
  'change the tone',
  'change the summary',
  'change the timeline',
  'change the budget',
  'rewrite the summary',
  'rewrite the timeline',
  'rewrite section',
  'make it more',
  'make the tone',
  'make the summary',
  'make the proposal',
];

/**
 * Patterns that signal the user wants to create a custom proposal template.
 * Checked before proposal triggers — more specific intent.
 */
const TEMPLATE_CREATION_TRIGGERS = [
  'create template',
  'generate template',
  'build template',
  'make a template',
  'create a template',
  'build a template',
  'generate a template',
  'create proposal template',
  'generate proposal template',
  'new template',
  'design a template',
  'design template',
  'make template',
];

/**
 * Patterns that signal the user wants a compliance / legal review of the proposal.
 * Checked before proposal triggers — more specific intent.
 */
const COMPLIANCE_TRIGGERS = [
  'check compliance',
  'compliance check',
  'compliance review',
  'review compliance',
  'review for compliance',
  'review for legal',
  'legal review',
  'legal check',
  'redline',
  'red line',
  'check for legal risks',
  'check for risks',
  'flag legal issues',
  'flag compliance',
  'compliance issues',
  'legal issues',
  'validate proposal',
  'proposal validation',
];

/**
 * Patterns that signal the user wants to generate a presentation microsite
 * from an existing proposal.
 * Checked before proposal triggers — more specific intent.
 */
const MICROSITE_TRIGGERS = [
  'generate microsite',
  'create microsite',
  'build microsite',
  'make microsite',
  'create a microsite',
  'generate a microsite',
  'build a microsite',
  'make a microsite',
  'turn this into a microsite',
  'turn proposal into microsite',
  'convert to microsite',
  'convert proposal to microsite',
  'proposal to microsite',
  'create presentation',
  'generate presentation',
  'build presentation',
  'make a presentation',
  'create a presentation',
  'generate a presentation',
  'proposal presentation',
  'turn this into a presentation',
  'turn proposal into presentation',
  'convert to presentation',
  'microsite from proposal',
  'presentation from proposal',
  'create a site',
  'generate a site',
  'build a site',
  'proposal site',
];

/**
 * Patterns that signal the user wants to create a proposal.
 * Checked in order; first match wins.
 */
const PROPOSAL_TRIGGERS = [
  'create proposal',
  'generate proposal',
  'make a proposal',
  'write a proposal',
  'build a proposal',
  'draft a proposal',
  'proposal for',
  'proposal about',
  'new proposal',
  'i need a proposal',
  'help me write a proposal',
  'help me create a proposal',
  'help me build a proposal',
  'prepare a proposal',
];

/**
 * Route the user's message to a workflow ID, or return null.
 *
 * @example
 * routeIntent('Analyze this RFP')           // → { workflowId: 'rfp_analysis' }
 * routeIntent('Create proposal for cloud')  // → { workflowId: 'proposal_generation' }
 * routeIntent('What is RAG?')               // → null
 */
/**
 * Returns true for messages that are clearly NOT workflow triggers and should
 * go straight to Q&A / knowledge retrieval, bypassing all workflow routing
 * including the LLM classifier.
 *
 * This prevents heavy proposal-related conversation history from causing the
 * LLM to misclassify unrelated messages (e.g. "give me JS code for X").
 */
export function isDefinitelyNotWorkflow(message: string): boolean {
  const lower = message.toLowerCase().trim();

  // Programming / code requests
  if (/\b(code|function|snippet|script|algorithm|syntax|loop|array|object|class|method|variable|import|export|return|print|console\.log)\b/.test(lower) &&
      /\b(javascript|js|python|typescript|ts|java|go|rust|c\+\+|ruby|php|sql|html|css|bash|shell|node)\b/.test(lower)) {
    return true;
  }
  // "give me code", "write me a function", "show me how to code"
  if (/\b(give me|write me|show me|can you write|can you give)\b.{0,30}\b(code|function|script|example|snippet)\b/.test(lower)) {
    return true;
  }
  // Pure location/status questions about existing content
  if (/\b(where (is|can i find|are)|find the|locate the|show me the)\b.{0,40}\b(proposal|document|file)\b/.test(lower) &&
      !/\b(creat|generat|build|writ|draft|start)\b/.test(lower)) {
    return true;
  }
  // General knowledge / factual questions clearly unrelated to workflow actions
  if (/^(what is|what are|who is|when is|where is|why is|explain|define|tell me about|describe)\b/.test(lower) &&
      !/\b(proposal|rfp|template|microsite|compliance)\b/.test(lower)) {
    return true;
  }

  return false;
}

export function routeIntent(message: string): IntentRouteResult | null {
  const lower = message.toLowerCase().trim();

  // RFP analysis checked first — more specific than proposal triggers
  for (const trigger of RFP_ANALYSIS_TRIGGERS) {
    if (lower.includes(trigger)) {
      return { workflowId: 'rfp_analysis' };
    }
  }

  // Microsite generation — checked before proposal triggers
  for (const trigger of MICROSITE_TRIGGERS) {
    if (lower.includes(trigger)) {
      return { workflowId: 'microsite_generation' };
    }
  }

  // Template creation — checked before proposal triggers
  for (const trigger of TEMPLATE_CREATION_TRIGGERS) {
    if (lower.includes(trigger)) {
      return { workflowId: 'template_creation' };
    }
  }

  // Compliance redline — checked before proposal triggers
  for (const trigger of COMPLIANCE_TRIGGERS) {
    if (lower.includes(trigger)) {
      return { workflowId: 'compliance_redline' };
    }
  }

  // Version control — checked before proposal triggers
  for (const trigger of VERSION_CONTROL_TRIGGERS) {
    if (lower.includes(trigger)) {
      return { workflowId: 'proposal_version_control' };
    }
  }

  // Catch natural language section edit requests not covered by static triggers above
  // e.g. "rewrite the executive summary", "update the project overview", "edit the risk section"
  if (/\b(update|edit|change|rewrite|revise|modify|improve)\b.{0,30}\b(executive|summary|overview|solution|approach|team|timeline|budget|pricing|risk|deliverable|quality|objective|section|proposal|introduction|conclusion|scope|methodology)\b/i.test(lower)) {
    return { workflowId: 'proposal_version_control' };
  }

  // Guard: informational/how-to questions about proposals should NOT start the workflow.
  // e.g. "how to generate the proposal?", "what is needed to generate a proposal?",
  // "how does proposal generation work?", "can you explain the proposal process?"
  const isInfoQuestion =
    /^(how|what|why|can you|could you|explain|tell me|help me understand)\b/.test(lower) ||
    /\b(how to|how do i|how does|what('s| is) needed|what do i need|what are the steps|what is the process)\b/.test(lower);

  if (!isInfoQuestion) {
    // Multi-word proposal patterns
    for (const trigger of PROPOSAL_TRIGGERS) {
      if (lower.includes(trigger)) {
        return { workflowId: 'proposal_generation' };
      }
    }

    // Fallback: any message containing the word "proposal"
    if (lower.includes('proposal')) {
      return { workflowId: 'proposal_generation' };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// LLM-based intent classification (second pass)
// ---------------------------------------------------------------------------

const KNOWN_WORKFLOWS = new Set([
  'proposal_generation',
  'rfp_analysis',
  'microsite_generation',
  'template_creation',
  'compliance_redline',
  'proposal_version_control',
]);

const INTENT_CLASSIFICATION_PROMPT = `You are an intent classifier for a proposal management system.

Given the user's message and recent conversation history, determine if the user wants to trigger one of these workflows:

- proposal_generation: The user wants to create, write, draft, or generate a business proposal.
- rfp_analysis: The user wants to analyze an RFP document, evaluate a bid, or make a go/no-go decision.
- microsite_generation: The user wants to convert a proposal into a presentation or microsite.
- template_creation: The user wants to create a reusable proposal template.
- compliance_redline: The user wants a legal or compliance review of a proposal.
- proposal_version_control: The user wants to edit, rollback, or view version history of proposal sections.

Rules:
- Only classify as a workflow if the user's CURRENT message clearly and explicitly requests that action.
- Do NOT infer workflow intent from history alone — the current message must contain a clear trigger.
- Return null for: general questions, coding questions, factual questions, greetings, document Q&A, anything unrelated to the workflows above.
- Return null if the user is asking HOW to use the system, or asking about documents, or asking a general knowledge question.
- The presence of proposal-related history does NOT mean the current message is a workflow trigger.
- Examples that must return null: "give me code for X", "what is X?", "how does X work?", "is the proposal good?", "where is the proposal?", "explain X".

Respond with ONLY a JSON object: { "intent": "<workflow_id>" } or { "intent": null }
Do not include any explanation or markdown formatting.`;

/**
 * LLM-based intent classification — called when rule-based matching returns null.
 *
 * Sends the user message plus recent conversation context to the LLM, which
 * classifies the intent against the known workflow set.
 *
 * Returns null on any failure (invalid JSON, unknown workflow, LLM error) so
 * the caller falls through to RAG as before.
 */
export async function classifyIntentWithLLM(
  message: string,
  conversationContext: ConversationMessage[],
  generateFn: GenerateFn,
): Promise<IntentRouteResult | null> {
  try {
    const historyBlock = conversationContext.length > 0
      ? [
          'Recent conversation:',
          ...conversationContext.map(
            (m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`,
          ),
          '',
        ].join('\n')
      : '';

    const prompt = [
      INTENT_CLASSIFICATION_PROMPT,
      '',
      historyBlock,
      `User message: ${message}`,
    ].join('\n');

    const raw = await generateFn(prompt);
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    const parsed = JSON.parse(cleaned) as { intent: string | null };

    if (!parsed.intent || !KNOWN_WORKFLOWS.has(parsed.intent)) {
      return null;
    }

    return { workflowId: parsed.intent };
  } catch {
    return null;
  }
}
