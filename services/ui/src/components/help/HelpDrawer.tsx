'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { X, Search } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useHelp } from '@/lib/help/help-store';
import { getTopic, resolveTopicForPath, searchTopics } from '@/content/help';
import { HelpTopicView } from './HelpTopicView';

/**
 * Context-aware Help drawer, mounted once in ShellLayout (mirrors
 * ExecutionDrawer). When opened without a pinned topic it resolves help for the
 * current route; a search box switches to full-registry search; a footer link
 * opens the full Help Center.
 */
export function HelpDrawer() {
  const pathname = usePathname();
  const open = useHelp((s) => s.open);
  const activeTopicId = useHelp((s) => s.activeTopicId);
  const query = useHelp((s) => s.query);
  const closeHelp = useHelp((s) => s.closeHelp);
  const setQuery = useHelp((s) => s.setQuery);
  const setActiveTopic = useHelp((s) => s.setActiveTopic);

  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  const path = pathname ?? '/';
  const topic = activeTopicId ? getTopic(activeTopicId) ?? resolveTopicForPath(path) : resolveTopicForPath(path);
  const results = query.trim() ? searchTopics(query) : [];

  // Focus the search on open, Escape to close, Tab focus-loop within the panel.
  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => searchRef.current?.focus(), 40);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeHelp();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, closeHelp]);

  // Restore focus to the trigger when the drawer closes.
  useEffect(() => {
    if (!open && lastFocused.current) {
      lastFocused.current.focus?.();
      lastFocused.current = null;
    }
  }, [open]);

  return (
    <>
      {open && <div className="help-drawer-backdrop" onClick={closeHelp} aria-hidden="true" />}

      <div
        ref={panelRef}
        className={`help-drawer${open ? ' help-drawer--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Help & FAQ"
        aria-hidden={!open}
      >
        <div className="help-drawer-header">
          <span className="help-drawer-title">Help &amp; FAQ</span>
          <button className="help-drawer-close" onClick={closeHelp} aria-label="Close help panel">
            <Icon icon={X} size="md" />
          </button>
        </div>

        <div className="help-drawer-search">
          <Icon icon={Search} size="sm" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search help…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search help"
          />
        </div>

        <div className="help-drawer-body">
          {query.trim() ? (
            results.length ? (
              <ul className="help-search-results">
                {results.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="help-search-result"
                      onClick={() => setActiveTopic(t.id)}
                    >
                      <span className="help-search-result-title">{t.title}</span>
                      <span className="help-search-result-summary">{t.summary}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="help-drawer-empty">No results for “{query.trim()}”.</div>
            )
          ) : topic ? (
            <HelpTopicView topic={topic} mode="drawer" />
          ) : (
            <div className="help-drawer-empty">Help topic not found.</div>
          )}
        </div>

        <div className="help-drawer-footer">
          <Link href="/help" className="help-browse-all" onClick={closeHelp}>
            Browse all help &amp; FAQ →
          </Link>
        </div>
      </div>
    </>
  );
}
