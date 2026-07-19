// services/api/src/site-facts/summary-doc.service.ts
//
// Narrative summary document generated FROM the fact base. This is a
// downstream consumer of the site-facts pipeline, not part of it — the
// pipeline's contract (produce facts, nothing else) is unchanged. The doc
// is auditable by construction: the LLM must cite facts inline as [F#],
// invalid citations are stripped, and the Sources section is built
// deterministically from the citations rather than written by the model.

import type { GenerateFn } from '@ai-engine/planner';
import type { Fact, SiteCategory, SiteManifest } from './types.js';

const CONDITIONAL_SECTION_BY_CATEGORY: Record<SiteCategory, string> = {
  'e-commerce': 'Products & Pricing',
  saas: 'Product & Features',
  blog: 'Content Themes',
  corporate: 'Services',
  portfolio: 'Work & Projects',
  docs: 'Documentation Coverage',
  nonprofit: 'Mission & Programs',
  other: 'Additional Details',
};

/**
 * The summary-doc prompt. Exported as a constant so it can be reviewed and
 * tuned independently of the calling code, same as the fact-extraction prompt.
 */
export const SUMMARY_DOC_PROMPT_TEMPLATE = `You are writing a factual summary document about a website. You must work ONLY from the numbered facts below — every factual claim in your document must be traceable to at least one fact, cited inline as [F#] (e.g. [F12]). Do not use any outside knowledge about this company, and do not invent, infer, or embellish anything the facts do not state.

Rules (follow exactly):
1. Every sentence that makes a factual claim must end with one or more inline citations like [F3] or [F3][F7].
2. Facts marked confidence "low" are marketing claims — present them as claims ("the site describes itself as...", "the company claims..."), never as objective truth.
3. If the facts do not support a section, write a single line: "Not established by the crawled content." Do not pad sections with speculation.
4. Follow the document outline below exactly, using ## for section headers.
5. Do NOT write a Sources section — it is appended automatically from your citations.
6. Write in clear, neutral prose. No hype, no filler.

Document outline:
# {{SITE_NAME}} — Summary

## Overview
## Executive Summary
## Purpose & Value Proposition
## Target Audience
## Site Structure
## Key Pages
## Organization / Contact Info
## Notable Features
## {{CONDITIONAL_SECTION}}

Site metadata (usable for Site Structure / Key Pages, cite as [M]):
- Site URL: {{SITE_URL}}
- Site category: {{SITE_CATEGORY}}
- Pages crawled ({{PAGES_CRAWLED}}):
{{PAGE_URLS}}

Facts:
{{FACTS}}

Return ONLY the markdown document, starting with the # title line. No preamble, no code fences.`;

export function buildSummaryDocPrompt(siteName: string, manifest: SiteManifest, facts: Fact[]): string {
  const factLines = facts
    .map((f, i) => `[F${i + 1}] (${f.category}, confidence: ${f.confidence}) ${f.statement} — source: ${f.source_url}`)
    .join('\n');
  const pageUrls = manifest.page_urls.map((u) => `  - ${u}`).join('\n');

  return SUMMARY_DOC_PROMPT_TEMPLATE.replace('{{SITE_NAME}}', siteName)
    .replace('{{CONDITIONAL_SECTION}}', CONDITIONAL_SECTION_BY_CATEGORY[manifest.site_category])
    .replace('{{SITE_URL}}', manifest.site_url)
    .replace('{{SITE_CATEGORY}}', manifest.site_category)
    .replace('{{PAGES_CRAWLED}}', String(manifest.pages_crawled))
    .replace('{{PAGE_URLS}}', pageUrls)
    .replace('{{FACTS}}', factLines);
}

const CITATION_REGEX = /\[F(\d+)\]/g;

/**
 * Strip citations pointing at facts that don't exist, and collect the valid
 * ones. Exported for tests.
 */
export function processCitations(body: string, factCount: number): { body: string; citedIndices: number[] } {
  const cited = new Set<number>();
  const cleaned = body.replace(CITATION_REGEX, (match, num: string) => {
    const index = Number(num);
    if (index >= 1 && index <= factCount) {
      cited.add(index);
      return match;
    }
    return '';
  });
  return { body: cleaned, citedIndices: [...cited].sort((a, b) => a - b) };
}

/**
 * Deterministic Sources section: every cited fact with its statement,
 * source_url, and confidence. If the model cited nothing (shouldn't happen,
 * but must not silently produce an unauditable doc), all facts are listed.
 */
export function buildSourcesSection(facts: Fact[], citedIndices: number[]): string {
  const indices = citedIndices.length > 0 ? citedIndices : facts.map((_, i) => i + 1);
  const lines = indices.map((i) => {
    const f = facts[i - 1];
    return `- [F${i}] "${f.statement}" — ${f.source_url} (confidence: ${f.confidence})`;
  });
  return `## Sources\n\n${lines.join('\n')}`;
}

function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

export interface GenerateSummaryDocOptions {
  siteName: string;
  manifest: SiteManifest;
  facts: Fact[];
  generateFn: GenerateFn;
}

/** Generate the full summary document (LLM body + deterministic Sources). */
export async function generateSummaryDoc(opts: GenerateSummaryDocOptions): Promise<string> {
  const raw = await opts.generateFn(buildSummaryDocPrompt(opts.siteName, opts.manifest, opts.facts));
  const { body, citedIndices } = processCitations(stripFences(raw), opts.facts.length);
  return `${body}\n\n${buildSourcesSection(opts.facts, citedIndices)}\n`;
}
