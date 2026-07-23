// Module-level store — survives component unmount/remount (page navigation).
// React state setters are never stored here; components subscribe and sync locally.

export type GenerationPhase = 'generating' | 'complete' | 'error';
export type GenerationType = 'proposal' | 'microsite' | 'document' | 'slide';

export interface Generation {
  id: string;
  clientSlug: string;
  type: GenerationType;
  phase: GenerationPhase;
  title: string;
  steps: string[];
  createdAt: string;
  charCount?: number; // HTML chars written so far — updated live during microsite generation
  error?: string;
  // Server-assigned filename(s) attached alongside the message that triggered
  // this generation, if any — shown on the card so it's clear which upload(s)
  // this proposal/document is being drafted from while it's still generating.
  attachedFileNames?: string[];
  result?: {
    fileName?: string;       // proposal
    micrositeId?: string;    // microsite
    ast?: unknown;           // microsite AST for instant view without re-fetch
    documentId?: string;     // generated document
    documentType?: string;   // kebab-case type slug, e.g. "strategy-document"
    preferredFormat?: string; // document format (docx, pdf, pptx, txt, notion, md)
    downloadUrl?: string;    // auto-export download URL for non-md formats
    slideId?: string;        // saved presentation
  };
  readonly abort: () => void;
}

type Listener = (gens: Generation[]) => void;

const store = new Map<string, Generation>();
const listeners = new Set<Listener>();

// Intentionally NOT persisted to localStorage — completed generation cards
// re-appearing on every page load causes stale duplicate cards in the chat.
// Clear any previously stored data from the old implementation.
if (typeof localStorage !== 'undefined') {
  localStorage.removeItem('prodeck-gen-store-v1');
}

// ── Core ──────────────────────────────────────────────────────────

function snap(): Generation[] {
  return [...store.values()];
}

function broadcast() {
  const s = snap();
  for (const l of listeners) l(s);
}

export const generationStore = {
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(snap()); // immediately deliver current state on subscribe
    return () => { listeners.delete(fn); };
  },

  start(params: {
    id: string;
    clientSlug: string;
    type: GenerationType;
    title: string;
    abort: () => void;
    attachedFileNames?: string[];
  }): void {
    store.set(params.id, {
      id: params.id,
      clientSlug: params.clientSlug,
      type: params.type,
      phase: 'generating',
      title: params.title,
      steps: [],
      createdAt: new Date().toISOString(),
      abort: params.abort,
      ...(params.attachedFileNames?.length ? { attachedFileNames: params.attachedFileNames } : {}),
    });
    broadcast();
  },

  // Throttled: only broadcasts when charCount grows by ≥2 000 to avoid flooding listeners.
  updateChars(id: string, count: number): void {
    const g = store.get(id);
    if (!g || g.phase !== 'generating') return;
    if (g.charCount !== undefined && count - g.charCount < 2000) return;
    store.set(id, { ...g, charCount: count });
    broadcast();
  },

  addStep(id: string, step: string): void {
    const g = store.get(id);
    if (!g || g.phase !== 'generating') return;
    store.set(id, { ...g, steps: [...g.steps, step] });
    broadcast();
  },

  complete(id: string, result: Generation['result'], title?: string): void {
    const g = store.get(id);
    if (!g) return;
    store.set(id, { ...g, phase: 'complete', result, ...(title ? { title } : {}) });
    broadcast();
  },

  error(id: string, message: string): void {
    const g = store.get(id);
    if (!g) return;
    store.set(id, { ...g, phase: 'error', error: message });
    broadcast();
  },

  dismiss(id: string): void {
    const g = store.get(id);
    if (g) { try { g.abort(); } catch { /* ignore */ } }
    store.delete(id);
    broadcast();
  },

  get(id: string): Generation | undefined {
    return store.get(id);
  },

  forClient(slug: string): Generation[] {
    return snap().filter((g) => g.clientSlug === slug);
  },

  // Bulk-load server-fetched generations into the store without overwriting any
  // entry that is already active (e.g. a generation started in the current tab).
  // 'generating' entries are kept as-is so other tabs can poll for completion.
  hydrateFromServer(gens: Omit<Generation, 'abort'>[]): void {
    let changed = false;
    for (const g of gens) {
      if (store.has(g.id)) continue; // never clobber an active entry
      store.set(g.id, { ...g, abort: () => {} });
      changed = true;
    }
    if (changed) broadcast();
  },

  // Refresh entries that are 'generating' in the store with the latest server data.
  // Updates steps and charCount during active generation, and transitions phase when done.
  // Called by polling in tabs/browsers that didn't start the generation.
  refreshFromServer(gens: Omit<Generation, 'abort'>[]): void {
    let changed = false;
    for (const g of gens) {
      const existing = store.get(g.id);
      if (!existing || existing.phase !== 'generating') continue;
      store.set(g.id, { ...g, abort: existing.abort });
      changed = true;
    }
    if (changed) broadcast();
  },
};
