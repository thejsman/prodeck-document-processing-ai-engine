'use client';

import { useEffect } from 'react';
import { useHelp } from '@/lib/help/help-store';
import { HelpButton } from './HelpButton';

/**
 * Mounted once in ShellLayout. Provides the always-visible floating Help
 * button (the only affordance guaranteed to reach the frozen ProposalPage and
 * mobile immersive routes) plus a global `?` keyboard shortcut.
 */
export function HelpLauncher() {
  const open = useHelp((s) => s.open);
  const openHelp = useHelp((s) => s.openHelp);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (open) return; // already open — let Escape close it

      // Don't hijack `?` while the user is typing.
      const el = document.activeElement as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) {
          return;
        }
      }

      e.preventDefault();
      openHelp();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, openHelp]);

  // Hide the FAB while the drawer is open (it would sit behind the backdrop).
  return open ? null : <HelpButton variant="fab" />;
}
