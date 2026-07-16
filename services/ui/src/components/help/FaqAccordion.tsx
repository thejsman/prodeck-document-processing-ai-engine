'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { HelpMarkdown } from './HelpMarkdown';
import type { Faq } from '@/lib/help/help-types';

/**
 * Accessible FAQ accordion. Multiple items can be open at once. Each row is a
 * real button with aria-expanded / aria-controls pointing at its answer region.
 */
export function FaqAccordion({ faqs }: { faqs: Faq[] }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const baseId = useId();

  if (!faqs.length) return null;

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className="faq-list">
      {faqs.map((faq, i) => {
        const isOpen = open.has(i);
        const btnId = `${baseId}-q-${i}`;
        const panelId = `${baseId}-a-${i}`;
        return (
          <div className={`faq-item${isOpen ? ' faq-item--open' : ''}`} key={i}>
            <button
              id={btnId}
              className="faq-q"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggle(i)}
              type="button"
            >
              <span>{faq.q}</span>
              <span className={`faq-chevron${isOpen ? ' faq-chevron--open' : ''}`} aria-hidden="true">
                <Icon icon={ChevronDown} size="sm" />
              </span>
            </button>
            {isOpen && (
              <div id={panelId} role="region" aria-labelledby={btnId} className="faq-a">
                <HelpMarkdown>{faq.a}</HelpMarkdown>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
