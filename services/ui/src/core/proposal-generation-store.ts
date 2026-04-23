import { create } from 'zustand';

export type PendingGeneration = {
  client: string;
  namespace: string;
  status: 'generating' | 'failed';
  error?: string;
};

interface ProposalGenerationState {
  pending: PendingGeneration | null;
  start: (client: string, namespace: string) => void;
  finish: () => void;
  fail: (error: string) => void;
  clear: () => void;
}

export const useProposalGenerationStore = create<ProposalGenerationState>((set) => ({
  pending: null,
  start: (client, namespace) =>
    set({ pending: { client, namespace, status: 'generating' } }),
  finish: () => set({ pending: null }),
  fail: (error) =>
    set((s) => ({
      pending: s.pending ? { ...s.pending, status: 'failed', error } : null,
    })),
  clear: () => set({ pending: null }),
}));
