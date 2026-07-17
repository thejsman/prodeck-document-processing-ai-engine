'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { HelpTopicView } from '@/components/help/HelpTopicView';
import {
  HELP_CATEGORIES,
  HELP_TOPICS,
  getTopic,
  searchTopics,
  type HelpTopic,
} from '@/content/help';

/** High-traffic topics surfaced on the landing view. */
const POPULAR = [
  'proposals',
  'microsite-publishing',
  'deck-orientation',
  'export-formats',
  'super-client-workspace',
  'api-key-connect',
];

function HelpCenter() {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Sync selection from the URL (?topic=…) with a #hash fallback.
  useEffect(() => {
    const fromQuery = params.get('topic');
    const fromHash =
      typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
    const id = fromQuery || fromHash || null;
    setSelectedId(id && getTopic(id) ? id : null);
  }, [params]);

  const select = (id: string) => {
    setQuery('');
    setSelectedId(id);
    router.replace(`/help?topic=${id}`, { scroll: false });
  };

  const topicsByCat = useMemo(() => {
    const map: Record<string, HelpTopic[]> = {};
    for (const t of HELP_TOPICS) (map[t.category] ??= []).push(t);
    return map;
  }, []);

  const results = query.trim() ? searchTopics(query) : [];
  const selected = selectedId ? getTopic(selectedId) : undefined;

  return (
    <PageContainer>
      <PageHeader title="Help & FAQ" subtitle="Guides and answers for every ProDeck feature" />

      <div className="help-center">
        <aside className="help-center-nav" aria-label="Help topics">
          {HELP_CATEGORIES.map((c) => (
            <div className="help-center-cat" key={c.id}>
              <div className="help-center-cat-label">
                {c.icon && <Icon icon={c.icon} size="sm" />}
                <span>{c.label}</span>
              </div>
              <ul>
                {(topicsByCat[c.id] || []).map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={`help-center-nav-link${selectedId === t.id ? ' active' : ''}`}
                      onClick={() => select(t.id)}
                    >
                      {t.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <main className="help-center-main">
          <div className="help-center-search">
            <Icon icon={Search} size="sm" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search all help & FAQ…"
              aria-label="Search help"
            />
          </div>

          {query.trim() ? (
            results.length ? (
              <ul className="help-search-results">
                {results.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="help-search-result"
                      onClick={() => select(t.id)}
                    >
                      <span className="help-search-result-title">{t.title}</span>
                      <span className="help-search-result-summary">{t.summary}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="help-center-empty">No results for “{query.trim()}”.</div>
            )
          ) : selected ? (
            <HelpTopicView topic={selected} mode="page" />
          ) : (
            <div className="help-center-landing">
              <h2 className="help-center-landing-title">Popular questions</h2>
              <div className="help-popular">
                {POPULAR.map((id) => {
                  const t = getTopic(id);
                  if (!t) return null;
                  const label = t.faqs[0]?.q ?? t.title;
                  return (
                    <button
                      key={id}
                      type="button"
                      className="help-popular-chip"
                      onClick={() => select(id)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="help-center-hint">
                Pick a topic on the left, or search above.
              </p>
            </div>
          )}
        </main>
      </div>
    </PageContainer>
  );
}

export default function HelpPage() {
  return (
    <Suspense
      fallback={
        <PageContainer>
          <PageHeader title="Help & FAQ" subtitle="Guides and answers for every ProDeck feature" />
        </PageContainer>
      }
    >
      <HelpCenter />
    </Suspense>
  );
}
