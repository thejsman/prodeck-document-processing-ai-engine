// Module-level store — survives component unmount/remount (page navigation).
// React state setters are never stored here; components subscribe and sync locally.

export type GenerationPhase = 'generating' | 'complete' | 'error';
export type GenerationType = 'proposal' | 'microsite';

export interface Generation {
  id: string;
  clientSlug: string;
  type: GenerationType;
  phase: GenerationPhase;
  title: string;
  steps: string[];
  error?: string;
  result?: {
    fileName?: string;    // proposal
    micrositeId?: string; // microsite
    ast?: unknown;        // microsite AST for instant view without re-fetch
  };
  readonly abort: () => void;
}

type Listener = (gens: Generation[]) => void;

const store = new Map<string, Generation>();
const listeners = new Set<Listener>();

// ── localStorage persistence ──────────────────────────────────────

const STORAGE_KEY = 'prodeck-gen-store-v1';

function persist(gens: Generation[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    // Only persist settled states — generating can't be recovered after reload
    const data = gens
      .filter(g => g.phase !== 'generating')
      .map(({ abort: _abort, ...rest }) => rest);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore quota errors */ }
}

function hydrate(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data: Omit<Generation, 'abort'>[] = JSON.parse(raw);
    for (const g of data) {
      store.set(g.id, { ...g, abort: () => {} });
    }
  } catch { /* ignore parse errors */ }
}

hydrate();

// ── Core ──────────────────────────────────────────────────────────

function snap(): Generation[] {
  return [...store.values()];
}

function broadcast() {
  const s = snap();
  persist(s);
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
  }): void {
    store.set(params.id, {
      id: params.id,
      clientSlug: params.clientSlug,
      type: params.type,
      phase: 'generating',
      title: params.title,
      steps: [],
      abort: params.abort,
    });
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
};
