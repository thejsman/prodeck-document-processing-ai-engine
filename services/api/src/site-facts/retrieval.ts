// services/api/src/site-facts/retrieval.ts
//
// Retrieval-readiness (spec step 7). This module has no opinion on how the
// facts get used downstream — it only loads and filters. Do not add
// generation logic here.

import { readFacts } from './store.js';
import type { Fact, FactCategory } from './types.js';

export interface FactFilter {
  category?: FactCategory;
  sourceUrl?: string;
}

export async function getFactsForSite(outputDir: string, filter: FactFilter = {}): Promise<Fact[]> {
  const facts = await readFacts(outputDir);
  return facts.filter(
    (f) => (!filter.category || f.category === filter.category) && (!filter.sourceUrl || f.source_url === filter.sourceUrl),
  );
}

export interface FactStatement {
  statement: string;
  confidence: Fact['confidence'];
  source_url: string;
}

/** Flat list of statements ready to drop into a prompt's context or an embeddings index. */
export async function getFactStatements(outputDir: string, filter: FactFilter = {}): Promise<FactStatement[]> {
  const facts = await getFactsForSite(outputDir, filter);
  return facts.map((f) => ({ statement: f.statement, confidence: f.confidence, source_url: f.source_url }));
}
