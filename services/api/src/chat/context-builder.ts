/**
 * Context Builder — assembles the full LLM context for each chat turn.
 *
 * Responsibilities:
 *   1. Build a conversation window from persisted history (last 8–10 messages).
 *   2. Optionally summarise old messages when history exceeds 20 turns.
 *   3. Extract proposal requirements (industry, timeline, budget, etc.) from
 *      an incoming user message via lightweight regex patterns.
 *   4. Format a requirement status block (known vs. missing inputs).
 *   5. Generate a workflow-aware system prompt.
 *   6. Produce a per-state task instruction string.
 *
 * The assembled LLMContext is attached to HandlerContext so every AgentExecutor
 * call in every handler receives both a system prompt and a conversation window
 * as priorContext — making every LLM call context-aware.
 */

import { loadHistory } from './chat-history.service.js';
import type { ChatMessage } from './chat-history.service.js';
import type { GenerateFn } from '@ai-engine/planner';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONVERSATION_WINDOW_SIZE = 10;
const MAX_MESSAGE_LENGTH = 1000;
const SUMMARY_THRESHOLD = 20;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMContext {
  /** Full workflow-aware system prompt to prepend to every LLM call. */
  systemPrompt: string;
  /** Last N messages, trimmed to MAX_MESSAGE_LENGTH each. */
  conversationWindow: ConversationMessage[];
  /** Optional summary of earlier conversation (populated when history > SUMMARY_THRESHOLD). */
  conversationSummary?: string;
  /** Current workflow state name (e.g. "collecting_rfp"). */
  workflowState: string;
  /** Requirements gathered so far in the session. */
  proposalRequirements: Record<string, string>;
  /** Formatted known/missing requirement block for inclusion in prompts. */
  requirementStatus: string;
  /** State-specific action instruction to append to each handler prompt. */
  taskInstruction: string;
}

// ---------------------------------------------------------------------------
// STEP 1 — Conversation window
// ---------------------------------------------------------------------------

/**
 * Return the last CONVERSATION_WINDOW_SIZE messages, trimming each to
 * MAX_MESSAGE_LENGTH characters so they don't bloat the prompt.
 */
export function buildConversationWindow(messages: ChatMessage[]): ConversationMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-CONVERSATION_WINDOW_SIZE)
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content.length > MAX_MESSAGE_LENGTH ? m.content.slice(0, MAX_MESSAGE_LENGTH) + '…[trimmed]' : m.content,
    }));
}

/**
 * Format a ConversationMessage[] as an array of plain strings suitable for
 * AgentExecutorInput.priorContext.
 */
export function formatConversationForContext(window: ConversationMessage[]): string[] {
  return window.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`);
}

// ---------------------------------------------------------------------------
// STEP 2 — Conversation summary (optional)
// ---------------------------------------------------------------------------

/**
 * Generate a 2–3 sentence summary of the full message history.
 * Called only when messages.length > SUMMARY_THRESHOLD.
 * Non-fatal: callers should catch and ignore failures.
 */
export async function generateConversationSummary(messages: ChatMessage[], generateFn: GenerateFn): Promise<string> {
  const text = messages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');

  const prompt = [
    'Summarise the following conversation into structured bullet points.',
    '',
    'Output MUST follow this format:',
    '',
    '1. User Goal:',
    '- What the user is trying to achieve (be specific)',
    '',
    '2. Key Inputs Provided:',
    '- List all important details shared (industry, timeline, budget, etc.)',
    '',
    '3. Decisions / Progress:',
    '- What has already been decided or completed',
    '',
    '4. Open Items / Missing Information:',
    '- What is still needed to move forward',
    '',
    'Rules:',
    '- Use bullet points only (no paragraphs)',
    '- Be slightly detailed but avoid fluff',
    '- Do NOT invent information',
    '- Keep it compact but informative',
    '',
    text,
  ].join('\n\n');

  return generateFn(prompt);
}

// ---------------------------------------------------------------------------
// STEP 3 — Proposal requirements initialisation (handled by caller)
// ---------------------------------------------------------------------------
// Callers ensure instance.context.proposalRequirements is always an object.
// This module reads the requirement status for inclusion in LLM prompts.

// ---------------------------------------------------------------------------
// STEP 4 — Requirement status block
// ---------------------------------------------------------------------------

const REQUIREMENT_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'clientIndustry', label: 'client industry' },
  { key: 'timeline', label: 'timeline' },
  { key: 'budget', label: 'budget' },
  { key: 'teamSize', label: 'team size' },
  { key: 'clientName', label: 'client name' },
  { key: 'projectType', label: 'project type' },
];

/**
 * Build a human-readable requirement status block.
 *
 * Example output:
 *   Known Inputs:
 *   - industry: fintech
 *   - timeline: missing
 *   - budget: $50k
 *   ...
 */
export function buildRequirementStatus(requirements: Record<string, string>): string {
  const lines = ['Known Inputs:'];
  for (const { key, label } of REQUIREMENT_FIELDS) {
    const value = requirements[key];
    lines.push(`- ${label}: ${value ?? 'missing'}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// STEP 6 — System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  workflowState: string,
  requirementStatus: string,
  taskInstruction: string,
  conversationSummary?: string,
): string {
  const parts = [
    'You are a workflow-driven AI assistant.',
    '',
    'FORMATTING: Never use bold (**text**), never use em dashes (—). Write in plain prose only.',
    '',
    'You MUST follow the workflow strictly. You are NOT a general chatbot.',
    '',
    '---',
    '',
    '## CURRENT STATE',
    `State: ${workflowState}`,
    '',
    '---',
    '',
    '## REQUIREMENTS STATE (SOURCE OF TRUTH)',
    requirementStatus,
    '',
    '---',
    '',
    '## OPERATING RULES (MANDATORY)',
    '',
    '1. You operate in ONE of two modes:',
    '   - WORKFLOW MODE (default)',
    '   - KNOWLEDGE MODE (only if user asks a clear question)',
    '',
    '2. WORKFLOW MODE:',
    '   - Your job is to move the workflow forward',
    '   - If required inputs are missing → ask for EXACTLY ONE missing field',
    '   - Do NOT ask multiple questions',
    '   - Do NOT generate proposal early',
    '',
    '3. KNOWLEDGE MODE:',
    '   - Trigger ONLY if user asks a clear question',
    '   - Answer concisely',
    '   - AFTER answering → return to workflow',
    '',
    '4. NEVER:',
    '   - Mix workflow progression and knowledge answers',
    '   - Ask vague or open-ended questions',
    '   - Repeat already known inputs',
    '',
    '---',
    '',
    '## DECISION LOGIC',
    '',
    '- If missing requirements exist → ask next missing field',
    '- If enough inputs → proceed to next workflow step',
    '- If interrupt detected → switch to KNOWLEDGE MODE',
    '',
    '---',
    '',
    '## OUTPUT FORMAT (STRICT)',
    '',
    'You MUST respond in this structure:',
    '',
    'INTENT: <workflow | question | generate | confirm>',
    '',
    'ACTION: <what you are doing>',
    '',
    'RESPONSE:',
    '<final user-facing message>',
    '',
    '---',
    '',
    '## TASK',
    taskInstruction,
  ];

  if (conversationSummary) {
    parts.splice(2, 0, '', 'Conversation context:', conversationSummary);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// STEP 8 — Task instruction per state
// ---------------------------------------------------------------------------

const GENERATING_STATES = new Set([
  'generating_outline',
  'generating_sections',
  'analyzing_rfp',
  'generating_template',
  'gap_analysis',
  'go_no_go',
  'analyzing',
  'applying_fix',
]);

const REVIEW_STATES = new Set(['recommend_template', 'review_template', 'name_template', 'qa_review', 'reviewing']);

const REQUIRED_FIELDS = ['clientIndustry', 'projectType', 'timeline', 'budget', 'teamSize', 'clientName'];

/**
 * Return a structured MODE/ACTION instruction for the current turn.
 *
 * Priority order:
 *   1. Interrupt detected → KNOWLEDGE MODE (answer question, return to workflow)
 *   2. Missing required fields → WORKFLOW MODE (ask for exactly one field)
 *   3. Generating state → GENERATION MODE
 *   4. Review state → REVIEW MODE
 *   5. Default → WORKFLOW MODE (continue progressing)
 */
export function buildTaskInstruction(
  workflowState: string,
  requirements: Record<string, string>,
  interruptDetected = false,
): string {
  if (interruptDetected) {
    return [
      'MODE: KNOWLEDGE',
      'ACTION:',
      "- Answer the user's question directly",
      '- Do NOT advance workflow',
      '- After answering, return control to workflow',
    ].join('\n');
  }

  const missingFields = REQUIRED_FIELDS.filter((f) => !requirements[f]);

  if (missingFields.length > 0) {
    return [
      'MODE: WORKFLOW',
      'ACTION:',
      `- Ask for the next missing field: ${missingFields[0]}`,
      '- Ask ONLY ONE question',
      '- Do NOT ask multiple fields',
      '- Do NOT generate proposal',
    ].join('\n');
  }

  if (GENERATING_STATES.has(workflowState)) {
    return [
      'MODE: GENERATION',
      'ACTION:',
      '- Generate content using all available inputs',
      '- Follow proposal structure strictly',
      '- Do NOT ask questions',
    ].join('\n');
  }

  if (REVIEW_STATES.has(workflowState)) {
    return [
      'MODE: REVIEW',
      'ACTION:',
      '- Present output clearly',
      '- Ask for confirmation or edits',
      '- Do NOT generate new content unless asked',
    ].join('\n');
  }

  return ['MODE: WORKFLOW', 'ACTION:', '- Continue progressing the workflow step-by-step'].join('\n');
}

// ---------------------------------------------------------------------------
// STEP 9 — Interrupt detection
// ---------------------------------------------------------------------------

export type IntentType = 'QUESTION' | 'WORKFLOW_INPUT' | 'CONFIRMATION' | 'COMMAND';

export interface IntentResult {
  intent: IntentType;
  confidence: number;
  source: 'rule' | 'llm';
}

/**
 * Workflow confirmations/affirmatives and confusion expressions.
 * Hard-classified as CONFIRMATION — never treated as questions.
 */
const WORKFLOW_AFFIRMATIVES = new Set([
  'yes',
  'y',
  'no',
  'n',
  'proceed',
  'continue',
  'go ahead',
  'go on',
  'ok',
  'okay',
  'sure',
  'alright',
  'fine',
  'great',
  'use this',
  'use that',
  'use it',
  'accept',
  'confirm',
  'approve',
  'approved',
  'looks good',
  'looks great',
  'perfect',
  'that works',
  'sounds good',
  'sounds great',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'next',
  'skip',
  'back',
  'done',
  // Confusion expressions — re-ask the current step, never knowledge queries
  'what?',
  'huh?',
  'sorry?',
  'pardon?',
  'excuse me?',
  'what do you mean?',
  "i don't understand",
  'i dont understand',
  'can you repeat?',
  'come again?',
  'repeat that',
]);

/**
 * Synchronous scoring-based intent classifier.
 *
 * Returns CONFIRMATION (confidence 10) for known affirmatives.
 * Returns QUESTION or WORKFLOW_INPUT based on a weighted score against a
 * dynamic threshold that tightens for short messages.
 *
 * Ambiguous zone (confidence 2–3): callers should use classifyMessageIntent
 * to resolve via LLM.
 */
export function detectIntent(message: string): { intent: IntentType; confidence: number } {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // Hard guard — affirmatives are always CONFIRMATION
  if (WORKFLOW_AFFIRMATIVES.has(lower)) {
    return { intent: 'CONFIRMATION', confidence: 10 };
  }

  let score = 0;

  // Positive signals
  if (trimmed.endsWith('?') && trimmed.length > 5) score += 2;
  if (/^(what|how|why|who|when|where)\b/.test(lower)) score += 2;
  if (/^(can|could|will|would|is|are|does|do)\b/.test(lower)) score += 1;
  if (/(explain|tell me|help me understand)/.test(lower)) score += 2;
  if (/(summarize|summarise|summary)/.test(lower)) score += 2;

  // Negative signals — command-like starters are not questions
  if (/^(use|select|choose|apply|generate|proceed)\b/.test(lower)) score -= 2;

  // Dynamic threshold — short messages need a stronger signal
  const threshold = trimmed.length < 10 ? 4 : trimmed.length < 20 ? 3 : 2;

  return {
    intent: score >= threshold ? 'QUESTION' : 'WORKFLOW_INPUT',
    confidence: score,
  };
}

/**
 * Builds the LLM prompt for intent classification in the ambiguous zone.
 */
function buildIntentPrompt(message: string): string {
  return [
    'Classify the user message into exactly one of: QUESTION, WORKFLOW_INPUT, CONFIRMATION, COMMAND',
    '',
    'QUESTION        — asking for information, explanation, or clarification',
    'WORKFLOW_INPUT  — providing data or answering a question the system asked',
    'CONFIRMATION    — confirming, approving, or acknowledging something',
    'COMMAND         — requesting an action (generate, create, build, convert, etc.)',
    '',
    `Message: "${message}"`,
    '',
    'Return ONLY the label, nothing else.',
  ].join('\n');
}

/**
 * Two-pass message intent classifier.
 *
 * Pass 1 (synchronous): score-based detectIntent.
 * Pass 2 (LLM): called only when confidence is in the ambiguous zone (2–3).
 * Clear determinations (confidence < 2 or > 3) skip the LLM entirely.
 */
export async function classifyMessageIntent(message: string, generateFn?: GenerateFn): Promise<IntentResult> {
  const result = detectIntent(message);

  const isAmbiguous = result.confidence >= 2 && result.confidence <= 3;

  if (!isAmbiguous || !generateFn) {
    return { ...result, source: 'rule' };
  }

  // Ambiguous zone — ask the LLM
  try {
    const raw = await generateFn(buildIntentPrompt(message));
    const label = raw.trim().toUpperCase() as IntentType;
    const VALID: IntentType[] = ['QUESTION', 'WORKFLOW_INPUT', 'CONFIRMATION', 'COMMAND'];
    if (VALID.includes(label)) {
      return { intent: label, confidence: result.confidence, source: 'llm' };
    }
  } catch {
    // Non-fatal — fall back to rule result
  }

  return { ...result, source: 'rule' };
}

// ---------------------------------------------------------------------------
// Interrupt context builder
// ---------------------------------------------------------------------------

/**
 * Build a rich context string for interrupt answers.
 *
 * Includes:
 *   - Recent conversation (last 4 messages from the conversation window)
 *   - Current workflow state
 *   - Relevant workflow artifacts (template info, proposal artifact, requirements)
 *
 * This string is injected into `answerFromKnowledge` so the LLM can answer
 * questions like "is there a matching template?" using what was just shown
 * in the conversation, rather than blindly searching the knowledge base.
 */
export function buildInterruptContext(
  workflowState: string,
  conversationContext: LLMContext,
  workflowCtx: Record<string, unknown>,
): string {
  const parts: string[] = [];

  parts.push(`Current workflow state: ${workflowState}`);

  // Recent conversation (last 4 messages)
  const recentMessages = conversationContext.conversationWindow.slice(-4);
  if (recentMessages.length > 0) {
    parts.push('', 'Recent conversation:');
    for (const msg of recentMessages) {
      parts.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`);
    }
  }

  // Template recommendation (shown during recommend_template state)
  const templateRec = workflowCtx.templateRecommendation as Record<string, unknown> | undefined;
  if (templateRec) {
    const confidence =
      typeof templateRec.confidence === 'number' ? `${(templateRec.confidence * 100).toFixed(0)}%` : 'unknown';
    const reasoning = typeof templateRec.reasoning === 'string' ? templateRec.reasoning : '';
    parts.push('', `Template match confidence: ${confidence}`);
    if (reasoning) parts.push(`Template reasoning: ${reasoning}`);
  }

  // Selected template info
  const selectedTemplate = workflowCtx.selectedTemplate as Record<string, unknown> | undefined;
  if (selectedTemplate) {
    const name = typeof selectedTemplate.name === 'string' ? selectedTemplate.name : 'Unknown';
    const structure = Array.isArray(selectedTemplate.structure)
      ? (selectedTemplate.structure as string[]).join(', ')
      : '';
    parts.push('', `Selected template: ${name}`);
    if (structure) parts.push(`Template sections: ${structure}`);
  }

  // Proposal artifact (if one has been saved)
  if (typeof workflowCtx.proposalArtifactId === 'string') {
    parts.push('', `Generated proposal: ${workflowCtx.proposalArtifactId}`);
  }

  // Requirements gathered so far
  const reqs = workflowCtx.proposalRequirements as Record<string, string> | undefined;
  if (reqs && Object.keys(reqs).length > 0) {
    parts.push('', 'Requirements gathered:', buildRequirementStatus(reqs));
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Main builder — assembles the full LLMContext
// ---------------------------------------------------------------------------

/**
 * Build the complete LLMContext for a single chat turn.
 *
 * Loads history from disk, builds the conversation window, optionally
 * generates a summary, assembles the system prompt, and returns the context
 * object ready to be attached to HandlerContext.
 *
 * @param generateFn  Optional — used only for conversation summary generation.
 *                    Pass null/undefined to skip summarisation.
 */
export async function buildLLMContext(
  workdir: string,
  namespace: string,
  apiKeyHash: string,
  chatSessionId: string,
  workflowState: string,
  proposalRequirements: Record<string, string>,
  generateFn?: GenerateFn,
  interruptDetected = false,
): Promise<LLMContext> {
  const history = await loadHistory(workdir, namespace, apiKeyHash, chatSessionId);
  const messages = history?.messages ?? [];

  // Step 1 — conversation window
  const conversationWindow = buildConversationWindow(messages);

  // Step 2 — optional summary
  let conversationSummary: string | undefined;
  if (messages.length > SUMMARY_THRESHOLD && generateFn) {
    try {
      conversationSummary = await generateConversationSummary(messages, generateFn);
    } catch {
      // Non-fatal — proceed without summary
    }
  }

  // Steps 4, 6, 8
  const requirementStatus = buildRequirementStatus(proposalRequirements);
  const taskInstruction = buildTaskInstruction(workflowState, proposalRequirements, interruptDetected);
  const systemPrompt = buildSystemPrompt(workflowState, requirementStatus, taskInstruction, conversationSummary);

  return {
    systemPrompt,
    conversationWindow,
    conversationSummary,
    workflowState,
    proposalRequirements,
    requirementStatus,
    taskInstruction,
  };
}
