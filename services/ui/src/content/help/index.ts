import type { HelpTopic } from '@/lib/help/help-types';
import { resolveTopicForPath as resolve } from '@/lib/help/resolve-topic';
import { searchTopics as search, searchFaqs as searchF } from '@/lib/help/search';
import { HELP_CATEGORIES } from './categories';

import { gettingStartedTopics } from './getting-started';
import { superClientTopics } from './super-client';
import { proposalsTopics } from './proposals';
import { micrositesTopics } from './microsites';
import { contentKnowledgeTopics } from './content-knowledge';
import { inspirationSkillsTopics } from './inspiration-skills';
import { publishingExportTopics } from './publishing-export';
import { insightsTopics } from './insights';
import { adminTopics } from './admin';
import { accountTopics } from './account';

/** Every help topic, in category order. */
export const HELP_TOPICS: HelpTopic[] = [
  ...gettingStartedTopics,
  ...superClientTopics,
  ...proposalsTopics,
  ...micrositesTopics,
  ...contentKnowledgeTopics,
  ...inspirationSkillsTopics,
  ...publishingExportTopics,
  ...insightsTopics,
  ...adminTopics,
  ...accountTopics,
];

export const TOPICS_BY_ID: Record<string, HelpTopic> = Object.fromEntries(
  HELP_TOPICS.map((t) => [t.id, t]),
);

export function getTopic(id: string | null | undefined): HelpTopic | undefined {
  if (!id) return undefined;
  return TOPICS_BY_ID[id];
}

export function resolveTopicForPath(pathname: string): HelpTopic {
  return resolve(pathname, HELP_TOPICS);
}

export function searchTopics(query: string) {
  return search(query, HELP_TOPICS);
}

export function searchFaqs(query: string) {
  return searchF(query, HELP_TOPICS);
}

export { HELP_CATEGORIES };
export type { HelpTopic };

// ── Dev-only integrity checks — surface duplicate ids / dangling links early.
if (process.env.NODE_ENV !== 'production') {
  const ids = new Set<string>();
  for (const t of HELP_TOPICS) {
    if (ids.has(t.id)) {
      // eslint-disable-next-line no-console
      console.error(`[help] duplicate topic id: "${t.id}"`);
    }
    ids.add(t.id);
  }
  for (const t of HELP_TOPICS) {
    for (const r of t.related) {
      if (!ids.has(r)) {
        // eslint-disable-next-line no-console
        console.error(`[help] topic "${t.id}" references missing related id "${r}"`);
      }
    }
  }
}
