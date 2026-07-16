'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { HelpMarkdown } from './HelpMarkdown';
import { FaqAccordion } from './FaqAccordion';
import { useHelp } from '@/lib/help/help-store';
import { getTopic } from '@/content/help';
import type { HelpTopic } from '@/lib/help/help-types';

interface Props {
  topic: HelpTopic;
  /** 'drawer' switches related links to in-drawer topic switches; 'page' uses /help links. */
  mode: 'drawer' | 'page';
}

/**
 * Shared renderer for a single help topic — used by both the HelpDrawer and
 * the /help Help Center page.
 */
export function HelpTopicView({ topic, mode }: Props) {
  const setActiveTopic = useHelp((s) => s.setActiveTopic);

  return (
    <article className="help-topic">
      <header className="help-topic-head">
        <h2 className="help-topic-title">{topic.title}</h2>
        <p className="help-topic-summary">{topic.summary}</p>
      </header>

      {topic.sections.map((section, i) => (
        <section className="help-topic-section" key={i}>
          <h3 className="help-topic-heading">{section.heading}</h3>
          <HelpMarkdown>{section.body}</HelpMarkdown>
        </section>
      ))}

      {topic.faqs.length > 0 && (
        <section className="help-topic-section">
          <h3 className="help-topic-heading">Frequently asked</h3>
          <FaqAccordion faqs={topic.faqs} />
        </section>
      )}

      {topic.related.length > 0 && (
        <section className="help-topic-related">
          <h3 className="help-topic-heading">Related</h3>
          <ul className="help-related-list">
            {topic.related.map((id) => {
              const rel = getTopic(id);
              if (!rel) return null;
              return (
                <li key={id}>
                  {mode === 'drawer' ? (
                    <button
                      type="button"
                      className="help-related-link"
                      onClick={() => setActiveTopic(id)}
                    >
                      <span>{rel.title}</span>
                      <Icon icon={ArrowRight} size="sm" />
                    </button>
                  ) : (
                    <Link className="help-related-link" href={`/help?topic=${id}`}>
                      <span>{rel.title}</span>
                      <Icon icon={ArrowRight} size="sm" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </article>
  );
}
