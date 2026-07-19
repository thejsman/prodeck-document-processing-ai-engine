// services/api/src/site-facts/site-classification.service.ts
//
// One-shot overall site classification (spec step 6). This is manifest
// metadata about the fact base, not a narrative section — it never touches
// facts.jsonl.

import type { GenerateFn } from '@ai-engine/planner';
import type { RawPageExtraction, SiteCategory } from './types.js';

const VALID_CATEGORIES: SiteCategory[] = [
  'e-commerce',
  'saas',
  'blog',
  'corporate',
  'portfolio',
  'docs',
  'nonprofit',
  'other',
];

function buildClassificationPrompt(siteUrl: string, pages: RawPageExtraction[]): string {
  const signals = pages
    .slice(0, 15)
    .map((p) => `- ${p.url} | title: ${p.title || '(none)'} | headings: ${p.headings.map((h) => h.text).join(', ') || '(none)'}`)
    .join('\n');

  return `Classify the overall type of this website based on the page signals below. Respond with exactly one word from this list, nothing else: e-commerce, saas, blog, corporate, portfolio, docs, nonprofit, other.

Site: ${siteUrl}

Pages crawled:
${signals}

Answer with exactly one of the category words above, no punctuation, no explanation:`;
}

export async function classifySite(
  siteUrl: string,
  pages: RawPageExtraction[],
  generateFn: GenerateFn,
): Promise<SiteCategory> {
  if (pages.length === 0) return 'other';
  try {
    const raw = await generateFn(buildClassificationPrompt(siteUrl, pages));
    const cleaned = raw.trim().toLowerCase().replace(/[^a-z-]/g, '');
    return VALID_CATEGORIES.includes(cleaned as SiteCategory) ? (cleaned as SiteCategory) : 'other';
  } catch {
    return 'other';
  }
}
