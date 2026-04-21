'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ProposalFile, Presentation } from './api';

interface NamespaceData {
  proposals: ProposalFile[];
  microsites: Presentation[];
}

interface NamespacePanelStore {
  /** Proposal and microsite lists keyed by namespace */
  byNamespace: Record<string, NamespaceData>;
  setProposals(ns: string, proposals: ProposalFile[]): void;
  setMicrosites(ns: string, microsites: Presentation[]): void;
}

export const useNamespacePanelStore = create<NamespacePanelStore>()(
  persist(
    (set) => ({
      byNamespace: {},

      setProposals(ns, proposals) {
        set((state) => ({
          byNamespace: {
            ...state.byNamespace,
            [ns]: {
              microsites: state.byNamespace[ns]?.microsites ?? [],
              proposals,
            },
          },
        }));
      },

      setMicrosites(ns, microsites) {
        set((state) => ({
          byNamespace: {
            ...state.byNamespace,
            [ns]: {
              proposals: state.byNamespace[ns]?.proposals ?? [],
              microsites,
            },
          },
        }));
      },
    }),
    {
      name: 'ai-engine-namespace-panel',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
