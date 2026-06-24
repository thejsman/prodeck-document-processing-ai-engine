// services/api/src/chat/boundary-response.ts
//
// Chat Pipeline Stage 1 short-circuit — GENERAL_CHAT and UNKNOWN handlers.
//
// Both intents exit the pipeline immediately after Stage 1 (intent classifier).
// They never reach planning, tools, or LLM response generation.
//
// Design principles (spec section 10.1):
//   1. Acknowledge what they asked — the user knows we understood them
//   2. Decline specifically — not a generic wall, but a reason tied to their question
//   3. Pivot naturally — every response ends with a bridge to what we *can* do
//   4. Zero LLM tokens — all boundary responses are pattern-matched templates
//   5. Ambiguous messages get project interpretation — handled upstream by classifier

import type { ChatResponse } from './response-builder.js';

// ---------------------------------------------------------------------------
// GENERAL_CHAT — pattern-matched decline + redirect
// ---------------------------------------------------------------------------

export function buildBoundaryResponse(message: string): ChatResponse {
  const text = matchBoundaryPattern(message);
  return {
    text,
    actionCards: [],
    requirementsUpdated: false,
    toolsCalled: [],
  };
}

function matchBoundaryPattern(message: string): string {
  const m = message.toLowerCase();

  // --- Category: General knowledge / trivia ---
  if (/weather|temperature|rain|forecast/.test(m)) {
    return (
      "I'm focused on proposal and project work, so weather is outside my scope. " +
      'But if your project has weather-related constraints, I can note that in the requirements.'
    );
  }

  if (/news|politics|stock|market|sports|score/.test(m)) {
    return (
      "I don't cover news or current events — I'm built for creating proposals, " +
      'templates, and presentation microsites. What project are you working on?'
    );
  }

  // --- Category: Tasks for a different tool ---
  // Coding check runs first — it has higher-specificity keywords (python, script,
  // debug, etc.) that must take priority over the broader "write...for" email pattern.
  if (/code|programming|python|javascript|debug|function|script|api/.test(m)) {
    return (
      "I'm built for proposal and presentation work, not coding. " +
      'If you need technical content in a proposal though, I can help with that.'
    );
  }

  if (/email|mail|write.*(to|for)|draft.*(message|letter|note)|slack/.test(m)) {
    return (
      "I can't draft emails or messages, but I can create a proposal or " +
      'presentation that you can share with your client. Want to start one?'
    );
  }

  if (/powerpoint|pptx|slides|keynote|google.slides/.test(m)) {
    return (
      "I don't create slide decks, but I can generate a presentation microsite " +
      "from an approved proposal — it's interactive and shareable. Want to try that?"
    );
  }

  if (/translate|translation|spanish|french|german|chinese/.test(m)) {
    return (
      "Translation isn't something I handle. I focus on generating proposals, " +
      'templates, and microsites for client work. How can I help with a project?'
    );
  }

  if (/spreadsheet|excel|csv|calculate|math/.test(m)) {
    return (
      "I don't work with spreadsheets or calculations directly. " +
      'If you need pricing in a proposal, I can add a pricing section — ' +
      'just tell me team size, duration, and rate.'
    );
  }

  // --- Category: Personal / social ---
  if (/joke|funny|entertain|bored|story|poem/.test(m)) {
    return (
      "I'm more of a proposals-and-presentations specialist than an entertainer. " +
      'Got a client project I can help with?'
    );
  }

  if (/how are you|what'?s up|how'?s it going/.test(m) && m.length < 30) {
    return (
      'All good on my end — ready to help with proposals, templates, or microsites. ' +
      'What are you working on?'
    );
  }

  if (/thank|thanks|thx/.test(m) && m.length < 30) {
    return "You're welcome! Let me know if you need anything else for your project.";
  }

  // --- Category: Self-identification ---
  if (/who are you|what can you|help me|what do you do|capabilities/.test(m)) {
    return (
      "I'm ProDeck AI — I help consulting teams create client proposals, " +
      'proposal templates, and presentation microsites. I work best when you ' +
      'upload project documents (RFPs, meeting notes, tech specs) and then ask me ' +
      'to generate or edit proposals from that context. What are you working on?'
    );
  }

  // --- Default: warm decline + redirect ---
  return (
    "That's outside what I can help with — I'm focused on proposals, templates, " +
    'and presentation microsites for client work. If there\'s a project you\'re ' +
    'working on, I\'d be happy to help.'
  );
}

// ---------------------------------------------------------------------------
// DOMAIN VIOLATION — format injection + prompt injection guard
// ---------------------------------------------------------------------------

// Patterns where the user tries to get raw artifact output (HTML, JSON, etc.)
// instead of going through the proper proposal/microsite workflow tools.
const FORMAT_INJECTION_PATTERNS: RegExp[] = [
  // "generate/write/output/give me [the] html/json/xml/markdown [for the] proposal/microsite"
  /\b(generate|create|write|output|give\s+me|show\s+me|produce|export|print)\b.{0,60}\b(html|json|xml|csv|markdown|raw\s+text|plain\s+text|source\s+code)\b.{0,40}\b(proposal|microsite|template|presentation)\b/i,
  // reversed: "proposal/microsite as/in html/json..."
  /\b(proposal|microsite|template|presentation)\b.{0,40}\b(as|in|to|into|format|formatted\s+as)\b.{0,20}\b(html|json|xml|csv|markdown|word|docx|pdf|code|raw)\b/i,
  // "download/export the proposal as html"
  /\b(download|export|convert)\b.{0,30}\b(proposal|microsite|template)\b.{0,20}\b(to|as|into)\b.{0,20}\b(html|json|xml|csv|word|pdf|docx|code|raw|markdown)\b/i,
  // direct: "give me the html", "output the json for this microsite"
  /\b(give\s+me|output|print|show\s+me)\b.{0,20}\b(the\s+)?(html|json|xml|source)\b.{0,30}\b(for|of)\b.{0,20}\b(this|the)?\b.{0,20}\b(proposal|microsite|template)\b/i,
];

// Patterns that attempt to override system instructions or assume a different persona.
const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass|skip)\b.{0,30}\b(your\s+)?(instructions?|rules?|guidelines?|system\s+prompt|previous\s+instructions?|constraints?|restrictions?|training)\b/i,
  /\b(pretend|act|roleplay|behave)\b.{0,20}\b(you\s+are|as\s+if|like\s+you('?re| are)|to\s+be)\b/i,
  /\byou\s+are\s+now\b/i,
  /\b(new|different|alternative|another)\s+(persona|personality|mode|identity|character|role|system)\b/i,
  /\bDAN\b/,  // "Do Anything Now" jailbreak
  /\bjailbreak\b/i,
  /\bprompt\s+injection\b/i,
  /\b(break\s+out|escape|get\s+around|circumvent)\b.{0,20}\b(your\s+)?(rules?|restrictions?|guidelines?|constraints?|safety)\b/i,
  /\bdo\s+anything\s+now\b/i,
];

/**
 * Returns the type of domain violation detected, or null if the message is clean.
 * Runs deterministically with zero LLM cost.
 */
export function detectDomainViolation(message: string): 'format_injection' | 'prompt_injection' | null {
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(message)) return 'prompt_injection';
  }
  for (const pattern of FORMAT_INJECTION_PATTERNS) {
    if (pattern.test(message)) return 'format_injection';
  }
  return null;
}

export function buildDomainViolationResponse(kind: 'format_injection' | 'prompt_injection'): ChatResponse {
  const text =
    kind === 'format_injection'
      ? "I don't output proposals, microsites, or templates as raw HTML, JSON, or code — " +
        'those are generated and saved through the proper workflow. ' +
        "Say \"Generate a proposal for [client]\" to start, and you'll be able to view and share the result from the proposals page."
      : "I'm purpose-built for proposal and project work and don't accept instruction overrides. " +
        'If you have a project to work on — a proposal, template, or microsite — I\'m ready to help.';
  return { text, actionCards: [], requirementsUpdated: false, toolsCalled: [] };
}

// ---------------------------------------------------------------------------
// UNKNOWN — deterministic "didn't understand" response
// ---------------------------------------------------------------------------

export function buildUnknownResponse(): ChatResponse {
  return {
    text:
      "I didn't quite understand that. I can help with creating proposals, " +
      'editing proposal sections, generating templates, building microsites, ' +
      'or answering questions about your project documents. What would you like to do?',
    actionCards: [],
    requirementsUpdated: false,
    toolsCalled: [],
  };
}
