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
  return messages.slice(-CONVERSATION_WINDOW_SIZE).map((m) => ({
    role: m.role,
    content:
      m.content.length > MAX_MESSAGE_LENGTH
        ? m.content.slice(0, MAX_MESSAGE_LENGTH) + '…[trimmed]'
        : m.content,
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
export async function generateConversationSummary(
  messages: ChatMessage[],
  generateFn: GenerateFn,
): Promise<string> {
  const text = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const prompt = [
    'Summarise the following conversation in 2–3 sentences.',
    'Focus on what the user is trying to accomplish and any key decisions or inputs provided so far.',
    'Be concise.',
    '',
    text,
  ].join('\n');

  return generateFn(prompt);
}

// ---------------------------------------------------------------------------
// STEP 3 — Proposal requirements initialisation (handled by caller)
// ---------------------------------------------------------------------------
// Callers ensure instance.context.proposalRequirements is always an object.
// This module reads and enriches it via extractRequirementsFromMessage below.

// ---------------------------------------------------------------------------
// STEP 4 — Requirement status block
// ---------------------------------------------------------------------------

const REQUIREMENT_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'industry', label: 'industry' },
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
// STEP 1 — Input normalisation
// ---------------------------------------------------------------------------

function normalizeInput(text: string): string {
  return text
    .toLowerCase()
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// STEP 2 — Field pattern definitions
// ---------------------------------------------------------------------------

const FIELD_PATTERNS: Record<string, string[]> = {
  industry:    ['industry', 'domain', 'sector'],
  timeline:    ['timeline', 'duration', 'time'],
  budget:      ['budget', 'cost', 'price'],
  teamSize:    ['team size', 'team', 'members'],
  clientName:  ['client', 'customer'],
  projectType: ['project type', 'type', 'project'],
};

// ---------------------------------------------------------------------------
// STEP 3 — Generic field extractor (colon and "is/=" patterns)
// ---------------------------------------------------------------------------

function extractField(text: string, keys: string[]): string | null {
  for (const key of keys) {
    const escaped = key.replace(/\s+/g, '\\s+');

    // key: value  or  key = value
    const colonMatch = new RegExp(`${escaped}\\s*[:=]\\s*([^,\\n]+)`).exec(text);
    if (colonMatch) return colonMatch[1].trim();

    // key is value  or  key = value (with "is" keyword)
    const isMatch = new RegExp(`${escaped}\\s+(is|=)\\s+([^,\\n]+)`).exec(text);
    if (isMatch) return isMatch[2].trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// STEP 7 — Validation normalisation
// ---------------------------------------------------------------------------

function normalizeFieldValue(field: string, value: string): string {
  const v = value.trim();

  if (field === 'industry') {
    if (/^tech(nology)?$/i.test(v)) return 'technology';
  }

  if (field === 'budget') {
    // "$1500" → "$1,500" — keep as string with comma formatting
    const plain = v.replace(/,/g, '');
    const numMatch = /^\$?([\d.]+)\s*([kKmM]?)$/.exec(plain);
    if (numMatch) {
      let amount = parseFloat(numMatch[1]);
      const suffix = numMatch[2].toLowerCase();
      if (suffix === 'k') amount *= 1000;
      if (suffix === 'm') amount *= 1_000_000;
      return `$${amount.toLocaleString('en-US')}`;
    }
  }

  if (field === 'timeline') {
    // "12 weeks" → "12 weeks" (already structured), normalise casing
    const durationMatch = /^(\d+)\s*(weeks?|months?|days?|quarters?)$/i.exec(v);
    if (durationMatch) {
      return `${durationMatch[1]} ${durationMatch[2].toLowerCase()}`;
    }
  }

  return v;
}

// ---------------------------------------------------------------------------
// STEP 6 — Merge strategy
// ---------------------------------------------------------------------------

export function mergeRequirements(
  existing: Record<string, string>,
  extracted: Record<string, string>,
): Record<string, string> {
  const updated = { ...existing };
  for (const key in extracted) {
    if (extracted[key]) updated[key] = extracted[key];
  }
  return updated;
}

// ---------------------------------------------------------------------------
// STEP 7 — Requirement extraction from incoming message
// ---------------------------------------------------------------------------

const INDUSTRIES = [
  'fintech', 'finance', 'banking', 'healthcare', 'health', 'retail',
  'ecommerce', 'e-commerce', 'logistics', 'education', 'government',
  'telecom', 'insurance', 'real estate', 'manufacturing', 'energy',
  'media', 'saas', 'enterprise', 'technology', 'tech',
];

const PROJECT_TYPES: Record<string, string> = {
  'cloud migration': 'cloud migration',
  'migration': 'cloud migration',
  'digital transformation': 'digital transformation',
  'modernisation': 'modernisation',
  'modernization': 'modernisation',
  'integration': 'system integration',
  'data platform': 'data platform',
  'analytics': 'analytics',
  'security': 'security',
  'compliance': 'compliance',
  'mobile app': 'mobile application',
  'web app': 'web application',
  'api': 'API development',
};

/**
 * Extract structured requirement signals from a free-text user message.
 *
 * Strategy (in order):
 *   1. Colon/is patterns  (e.g. "industry: fintech", "budget is $50k")
 *   2. Keyword/regex fallback for each field
 *   3. LLM fallback for any fields still missing (requires generateFn)
 *
 * Returns a partial Record — only fields that were detected.
 * Callers merge this into the session's proposalRequirements.
 */
export async function extractRequirementsFromMessage(
  message: string,
  generateFn?: GenerateFn,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const normalized = normalizeInput(message);

  // --- STEP 3 — Colon/is pattern extraction for all fields ---
  for (const [field, keys] of Object.entries(FIELD_PATTERNS)) {
    const extracted = extractField(normalized, keys);
    if (extracted) {
      result[field] = normalizeFieldValue(field, extracted);
    }
  }

  // --- STEP 2 fallback — keyword/regex extraction for fields still missing ---

  if (!result.industry) {
    for (const ind of INDUSTRIES) {
      if (normalized.includes(ind)) {
        result.industry = normalizeFieldValue('industry', ind);
        break;
      }
    }
  }

  if (!result.timeline) {
    const timelineMatch = message.match(/(\d+)\s*(weeks?|months?|days?|quarters?)/i);
    if (timelineMatch) result.timeline = normalizeFieldValue('timeline', timelineMatch[0]);
  }

  if (!result.budget) {
    const budgetMatch = message.match(/\$[\d,]+\s*[kKmM]?|\$[\d,.]+\s*(k|m|million|thousand)/i);
    if (budgetMatch) result.budget = normalizeFieldValue('budget', budgetMatch[0].trim());
  }

  if (!result.teamSize) {
    const teamMatch = message.match(
      /(\d+)\s*(person|people|engineers?|developers?|team members?|consultants?)/i,
    );
    if (teamMatch) result.teamSize = teamMatch[0].trim();
  }

  if (!result.projectType) {
    for (const [keyword, label] of Object.entries(PROJECT_TYPES)) {
      if (normalized.includes(keyword)) {
        result.projectType = label;
        break;
      }
    }
  }

  // --- STEP 5 — LLM fallback for fields still missing ---
  const missingFields = Object.keys(FIELD_PATTERNS).filter((k) => !result[k]);

  if (missingFields.length > 0 && generateFn) {
    try {
      const prompt = [
        'Extract structured fields from the following user message.',
        `Fields to extract: ${missingFields.join(', ')}.`,
        'Return a JSON object with only the fields that are clearly present.',
        'Use null for any field not found. Return JSON only, no explanation.',
        '',
        `Message: "${message}"`,
      ].join('\n');

      const raw = await generateFn(prompt);
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;

      for (const field of missingFields) {
        const val = parsed[field];
        if (typeof val === 'string' && val.trim()) {
          result[field] = normalizeFieldValue(field, val.trim());
        }
      }
    } catch {
      // Non-fatal — proceed with what regex found
    }
  }

  // --- STEP 8 — Debug logging ---
  console.log({ input: message, extracted: result });

  return result;
}

// ---------------------------------------------------------------------------
// STEP 6 — System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  workflowState: string,
  requirementStatus: string,
  conversationSummary?: string,
): string {
  const parts = [
    'You are an AI proposal assistant guiding a structured workflow.',
    '',
    `Current workflow state: ${workflowState}`,
    '',
    'Proposal inputs:',
    requirementStatus,
  ];

  if (conversationSummary) {
    parts.push('', 'Conversation context:', conversationSummary);
  }

  parts.push(
    '',
    'Rules:',
    '- If required inputs are missing, ask for them one at a time',
    '- Do NOT generate the proposal until inputs are sufficient',
    '- Answer user questions using available knowledge',
    '- After answering a question, return to workflow progression',
  );

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// STEP 8 — Task instruction per state
// ---------------------------------------------------------------------------

const COLLECTING_STATES = new Set([
  'collecting_rfp', 'collecting_inputs', 'await_rfp_upload', 'checking_rfp',
]);

const GENERATING_STATES = new Set([
  'generating_outline', 'generating_sections',
  'analyzing_rfp', 'generating_template',
  'gap_analysis', 'go_no_go',
  'analyzing', 'applying_fix',
]);

const REVIEW_STATES = new Set([
  'recommend_template', 'review_template', 'name_template', 'qa_review', 'reviewing',
]);

/**
 * Return a concise, state-appropriate instruction appended to each handler
 * prompt so the LLM knows what to focus on in this turn.
 */
export function buildTaskInstruction(
  workflowState: string,
  requirements: Record<string, string>,
): string {
  const requirementCount = Object.keys(requirements).length;

  if (COLLECTING_STATES.has(workflowState)) {
    if (requirementCount < 2) {
      return 'Ask for the next missing requirement to move forward. Be brief and focused.';
    }
    return 'Proceed with document collection and intake.';
  }

  if (GENERATING_STATES.has(workflowState)) {
    return 'Proceed with generation using the available context and documents.';
  }

  if (REVIEW_STATES.has(workflowState)) {
    return 'Present findings clearly and await user confirmation or revision instructions.';
  }

  return 'Continue guiding the user through the proposal workflow.';
}

// ---------------------------------------------------------------------------
// STEP 9 — Interrupt detection
// ---------------------------------------------------------------------------

const QUESTION_STARTERS = [
  'what ', 'how ', 'why ', 'who ', 'when ', 'where ',
  'can you ', 'could you ', 'will you ', 'would you ',
  'is there ', 'are there ', 'does ', 'do you ',
  'tell me ', 'explain ', 'help me understand ',
  'what\'s ', 'whats ', 'how\'s ',
];

/**
 * Detect whether an incoming message is an off-workflow question.
 *
 * Heuristic: ends with "?" OR starts with a common question word/phrase.
 * The intent router already handles workflow triggers; this catches everything
 * else that looks like a question rather than a workflow action.
 */
export function detectInterrupt(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.endsWith('?')) return true;

  const lower = trimmed.toLowerCase();
  for (const starter of QUESTION_STARTERS) {
    if (lower.startsWith(starter)) return true;
  }

  return false;
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
  chatSessionId: string,
  workflowState: string,
  proposalRequirements: Record<string, string>,
  generateFn?: GenerateFn,
): Promise<LLMContext> {
  const history = await loadHistory(workdir, namespace, chatSessionId);
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
  const systemPrompt = buildSystemPrompt(workflowState, requirementStatus, conversationSummary);
  const taskInstruction = buildTaskInstruction(workflowState, proposalRequirements);

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
