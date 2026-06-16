/**
 * Pure helpers for the Author Voice extraction pass: build the LLM prompt and
 * parse + sanitize its JSON response into an {@link ExtractedStyle}.
 *
 * PURE: no fs/net. Adapters load the document text and call the LLM; they pass
 * the raw text in here for prompting and the raw LLM output here for parsing,
 * so the prompt and the no-facts sanitization are identical across API and CLI.
 */

import type { VoiceFormality } from './voice-types.js';

/** The behavioral-DNA fields extracted from one past proposal (no facts). */
export interface ExtractedStyle {
  tone: string[];
  formality: VoiceFormality;
  sectionPatterns: string[];
  openingStyle: string;
  closingStyle: string;
  recurringPhrases: string[];
  vocabulary: string[];
  persuasionPatterns: string[];
  formatting: string[];
}

/** Conservative excerpt cap; matches the value used elsewhere in the codebase. */
export const STYLE_EXCERPT_MAX_CHARS = 80_000;

const ALLOWED_FORMALITY: readonly string[] = ['casual', 'neutral', 'formal', 'highly-formal'];

export function buildStylePrompt(fileName: string, text: string): string {
  const excerpt = text.slice(0, STYLE_EXCERPT_MAX_CHARS);
  return `You are a writing-style analyst. Study the proposal below and capture the AUTHOR'S STYLE — HOW they write — so a future proposal can be written in the same voice.

CRITICAL: Extract STYLE ONLY. Do NOT include any client-specific facts: no company names, people's names, product names, prices, numbers, dates, metrics, or industry-specific facts. If a phrase only makes sense for this specific client, leave it out. Capture reusable, content-agnostic patterns.

DOCUMENT (${fileName}):
${excerpt}

Return ONLY valid JSON in exactly this shape:
{
  "tone": ["3-6 adjectives, e.g. confident, consultative, warm"],
  "formality": "casual | neutral | formal | highly-formal",
  "sectionPatterns": ["recurring section names in the order they typically appear, e.g. Executive Summary, Approach, Timeline, Pricing, Why Us"],
  "openingStyle": "one sentence describing HOW proposals open (style, not content)",
  "closingStyle": "one sentence describing HOW proposals close / the call-to-action style",
  "recurringPhrases": ["signature reusable phrasings the author favors, with NO client names/numbers"],
  "vocabulary": ["characteristic word choices / power words the author leans on"],
  "persuasionPatterns": ["how they persuade, e.g. roi-led, social-proof-led, timeline-led, risk-reduction-led, vision-led, authority-led"],
  "formatting": ["formatting habits, e.g. short paragraphs, bold key terms, bulleted deliverables, numbered phases"]
}`;
}

/** Heuristic guard: a phrase carrying money/percent/long numbers is a fact, not style. */
export function looksLikeFact(s: string): boolean {
  return /[$£€]/.test(s) || /\d+\s?%/.test(s) || /\b\d{2,}\b/.test(s);
}

function cleanList(arr: unknown, opts: { dropFacts?: boolean } = {}): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const v = item.trim();
    if (!v) continue;
    if (opts.dropFacts && looksLikeFact(v)) continue;
    out.push(v);
  }
  return out;
}

/**
 * Parse the raw LLM response (which may include preamble/code fences) into a
 * sanitized ExtractedStyle. Throws if no JSON object can be found/parsed.
 */
export function parseStyleResponse(raw: string): ExtractedStyle {
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  const parsed = JSON.parse(json) as Record<string, unknown>;

  const formalityRaw =
    typeof parsed.formality === 'string' ? parsed.formality.trim().toLowerCase() : '';
  const formality: VoiceFormality = ALLOWED_FORMALITY.includes(formalityRaw)
    ? (formalityRaw as VoiceFormality)
    : 'neutral';

  return {
    tone: cleanList(parsed.tone),
    formality,
    sectionPatterns: cleanList(parsed.sectionPatterns),
    openingStyle: typeof parsed.openingStyle === 'string' ? parsed.openingStyle.trim() : '',
    closingStyle: typeof parsed.closingStyle === 'string' ? parsed.closingStyle.trim() : '',
    recurringPhrases: cleanList(parsed.recurringPhrases, { dropFacts: true }),
    vocabulary: cleanList(parsed.vocabulary, { dropFacts: true }),
    persuasionPatterns: cleanList(parsed.persuasionPatterns),
    formatting: cleanList(parsed.formatting),
  };
}
