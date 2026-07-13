import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PendingGeneration = {
  client: string;
  namespace: string;
  status: 'generating' | 'failed';
  startedAt: number;
  error?: string;
};

interface ProposalGenerationState {
  pending: PendingGeneration | null;
  start: (client: string, namespace: string) => void;
  finish: () => void;
  fail: (error: string) => void;
  clear: () => void;
}

export const useProposalGenerationStore = create<ProposalGenerationState>()(
  persist(
    (set) => ({
      pending: null,
      start: (client, namespace) =>
        set({ pending: { client, namespace, status: 'generating', startedAt: Date.now() } }),
      finish: () => set({ pending: null }),
      fail: (error) =>
        set((s) => ({
          pending: s.pending ? { ...s.pending, status: 'failed', error } : null,
        })),
      clear: () => set({ pending: null }),
    }),
    {
      name: 'prodeck-pending-generation',
      onRehydrateStorage: () => (state) => {
        if (state?.pending && Date.now() - state.pending.startedAt > 10 * 60 * 1000) {
          state.clear();
        }
      },
    }
  )
);
