// services/api/src/site-facts/fact-extraction.service.ts
//
// LLM-based atomic fact extraction (spec step 4) — the only stage of this
// pipeline that touches an LLM. Deterministic extraction (crawler +
// dom-extraction) always runs first; this module only ever restates what
// deterministic extraction already found, never invents new claims.

import type { GenerateFn } from '@ai-engine/planner';
import type { Fact, FactCategory, FactConfidence, RawPageExtraction } from './types.js';

const VALID_CATEGORIES: FactCategory[] = [
  'company_info',
  'product',
  'pricing',
  'audience',
  'feature',
  'contact',
  'policy',
  'team',
  'other',
];
const VALID_CONFIDENCES: FactConfidence[] = ['high', 'medium', 'low'];

const BODY_TEXT_CHAR_LIMIT = 8000;

/**
 * The extraction prompt. Exported as a constant so it can be reviewed/tuned
 * independently of the calling code.
 */
export const FACT_EXTRACTION_PROMPT_TEMPLATE = `You are a fact extractor. Your only job is to pull atomic, verifiable claims out of the page content below — you are not writing a summary, and you must not add anything the page does not literally state.

Rules (follow exactly):
1. No inference beyond the text. If the page does not state something, do not produce a fact for it. Never fill gaps with plausible-sounding assumptions.
2. One claim per fact. Split compound sentences into separate facts (e.g. "Founded in 2019 and headquartered in Austin" -> two facts).
3. Every fact must include "verbatim_support": the exact sentence or fragment (max 200 characters) from the page that the fact was derived from, so it can be traced back to its origin.
4. Set "confidence" to "low" for anything marketing-toned, superlative, or otherwise unverifiable (e.g. "industry-leading", "best-in-class", "world's most trusted"). Still capture these as facts about what the company *claims* — just flag them "low" so they are not mistaken for objective truth.
5. Set "confidence" to "medium" for facts that are stated but vague, and "high" for concrete, specific, unambiguous statements.
6. "category" must be exactly one of: company_info, product, pricing, audience, feature, contact, policy, team, other.
7. "source_section" is the nearest heading text this fact appeared under (e.g. "h2: Our Story"), or "" if there is none.
8. Do not extract facts from navigation labels, cookie banners, or boilerplate — that content has already been stripped from what you're given.

Page URL: {{PAGE_URL}}
Page title: {{PAGE_TITLE}}
Meta description: {{META_DESCRIPTION}}

Headings on this page:
{{HEADINGS}}

Page content:
{{BODY_TEXT}}

Return ONLY a JSON array (no markdown fences, no prose) of objects shaped exactly like:
[
  {
    "category": "company_info",
    "statement": "Founded in 2019, the company is headquartered in Austin, TX.",
    "confidence": "high",
    "source_section": "h2: Our Story",
    "verbatim_support": "Founded in 2019 and headquartered in Austin, TX"
  }
]

If the page contains no extractable facts, return an empty array: []`;

export function buildFactExtractionPrompt(page: RawPageExtraction): string {
  const headingsBlock = page.headings.length
    ? page.headings.map((h) => `h${h.level}: ${h.text}`).join('\n')
    : '(none)';

  return FACT_EXTRACTION_PROMPT_TEMPLATE.replace('{{PAGE_URL}}', page.url)
    .replace('{{PAGE_TITLE}}', page.title || '(none)')
    .replace('{{META_DESCRIPTION}}', page.meta_description || '(none)')
    .replace('{{HEADINGS}}', headingsBlock)
    .replace('{{BODY_TEXT}}', page.body_text.slice(0, BODY_TEXT_CHAR_LIMIT));
}

interface RawFactItem {
  category?: unknown;
  statement?: unknown;
  confidence?: unknown;
  source_section?: unknown;
  verbatim_support?: unknown;
}

function safeParseJsonArray(raw: string): RawFactItem[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

/** Extract atomic facts for a single already-crawled page. Malformed items are dropped, not thrown. */
export async function extractFactsForPage(
  page: RawPageExtraction,
  siteUrl: string,
  generateFn: GenerateFn,
): Promise<Fact[]> {
  if (!page.body_text.trim()) return [];

  const raw = await generateFn(buildFactExtractionPrompt(page));
  const items = safeParseJsonArray(raw);
  const now = new Date().toISOString();

  const facts: Fact[] = [];
  for (const item of items) {
    const statement = typeof item.statement === 'string' ? item.statement.trim() : '';
    if (!statement) continue;

    const category = VALID_CATEGORIES.includes(item.category as FactCategory)
      ? (item.category as FactCategory)
      : 'other';
    const confidence = VALID_CONFIDENCES.includes(item.confidence as FactConfidence)
      ? (item.confidence as FactConfidence)
      : 'low';
    const verbatimSupport = typeof item.verbatim_support === 'string' ? item.verbatim_support.slice(0, 200) : '';
    const sourceSection = typeof item.source_section === 'string' ? item.source_section : '';

    facts.push({
      fact_id: crypto.randomUUID(),
      site_url: siteUrl,
      source_url: page.url,
      source_section: sourceSection,
      category,
      statement,
      confidence,
      extracted_at: now,
      verbatim_support: verbatimSupport,
    });
  }
  return facts;
}

function normalizeForDedup(statement: string): string {
  return statement.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Drop near-identical facts (e.g. the same contact info repeated on every page). Keeps first occurrence. */
export function dedupeFacts(facts: Fact[]): Fact[] {
  const seen = new Set<string>();
  const result: Fact[] = [];
  for (const fact of facts) {
    const key = `${fact.category}:${normalizeForDedup(fact.statement)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(fact);
  }
  return result;
}
