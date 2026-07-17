import type { HelpTopic, Faq } from './help-types';

/**
 * Lightweight, dependency-free search over the help registry.
 * Case-insensitive substring matching with field weighting — enough for a
 * few dozen topics, mirroring the CommandPalette filter approach.
 */

export interface FaqHit {
  topic: HelpTopic;
  faq: Faq;
}

function hit(haystack: string, term: string): number {
  const h = haystack.toLowerCase();
  if (!h.includes(term)) return 0;
  return h === term ? 5 : 1;
}

export function searchTopics(query: string, topics: HelpTopic[]): HelpTopic[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);

  const scored = topics.map((t) => {
    let score = 0;
    for (const term of terms) {
      score += hit(t.title, term) * 6;
      score += hit(t.summary, term) * 2;
      score += t.keywords.reduce((s, k) => s + hit(k, term) * 4, 0);
      score += t.sections.reduce(
        (s, sec) => s + hit(sec.heading, term) * 2 + hit(sec.body, term),
        0,
      );
      score += t.faqs.reduce(
        (s, f) => s + hit(f.q, term) * 3 + hit(f.a, term),
        0,
      );
    }
    return { t, score };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t);
}

export function searchFaqs(query: string, topics: HelpTopic[]): FaqHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);

  const results: { hit: FaqHit; score: number }[] = [];
  for (const topic of topics) {
    for (const faq of topic.faqs) {
      let score = 0;
      for (const term of terms) {
        score += hit(faq.q, term) * 3 + hit(faq.a, term);
      }
      if (score > 0) results.push({ hit: { topic, faq }, score });
    }
  }
  return results.sort((a, b) => b.score - a.score).map((x) => x.hit);
}
