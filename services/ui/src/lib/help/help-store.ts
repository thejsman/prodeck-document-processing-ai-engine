'use client';

import { create } from 'zustand';
import { useExecutionStore } from '@/core/execution/execution-store';

/**
 * Global Help UI state. Templated on `mobile-nav-store` — a tiny zustand store
 * consumed by the globally-mounted HelpDrawer / HelpLauncher (mirroring the
 * ExecutionDrawer + execution-store precedent).
 *
 * `activeTopicId === null` means "resolve the topic from the current route"
 * (the drawer does this via usePathname); a non-null id pins a specific topic.
 */
interface HelpState {
  open: boolean;
  activeTopicId: string | null;
  query: string;
  openHelp: (topicId?: string) => void;
  closeHelp: () => void;
  setQuery: (q: string) => void;
  setActiveTopic: (id: string | null) => void;
}

export const useHelp = create<HelpState>((set) => ({
  open: false,
  activeTopicId: null,
  query: '',
  openHelp: (topicId) => {
    // The AI-Activity drawer shares the same right edge — close it so the two
    // never stack on top of each other.
    try {
      useExecutionStore.getState().closeDrawer();
    } catch {
      /* execution store not ready — ignore */
    }
    set({ open: true, activeTopicId: topicId ?? null, query: '' });
  },
  closeHelp: () => set({ open: false }),
  setQuery: (q) => set({ query: q }),
  setActiveTopic: (id) => set({ activeTopicId: id, query: '' }),
}));
