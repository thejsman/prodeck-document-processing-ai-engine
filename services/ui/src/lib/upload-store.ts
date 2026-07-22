// Module-level store — survives component unmount/remount within a session.
// Intentionally NOT persisted to localStorage — stale upload cards cause stuck UI state.
// Clear any previously stored data from the old implementation.
if (typeof localStorage !== 'undefined') {
  localStorage.removeItem('prodeck-uploads-v1');
}

export type UploadStatus = 'uploading' | 'done' | 'failed' | 'duplicate';

export interface UploadEntry {
  id: string;
  clientSlug: string;
  fileName: string;        // original browser filename — used for display
  storedFileName?: string; // server-assigned stored filename — used for doc lookup
  status: UploadStatus;
  pct: number;       // 0–100
  error?: string;
  // Set only when status === 'duplicate' — the fileName of the pre-existing
  // upload this content matches.
  duplicateOfFileName?: string;
}

type Listener = (entries: UploadEntry[]) => void;

const store = new Map<string, UploadEntry>();
const listeners = new Set<Listener>();

// ── Core ─────────────────────────────────────────────────────────

function snap(): UploadEntry[] {
  return [...store.values()];
}

function broadcast() {
  const s = snap();
  for (const l of listeners) l(s);
}

export const uploadStore = {
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(snap()); // deliver current state immediately
    return () => { listeners.delete(fn); };
  },

  start(params: { id: string; clientSlug: string; fileName: string }): void {
    store.set(params.id, {
      id: params.id,
      clientSlug: params.clientSlug,
      fileName: params.fileName,
      status: 'uploading',
      pct: 0,
    });
    broadcast();
  },

  progress(id: string, pct: number): void {
    const e = store.get(id);
    if (!e || e.status !== 'uploading') return;
    store.set(id, { ...e, pct: Math.min(100, Math.round(pct)) });
    broadcast();
  },

  done(id: string, serverFileName?: string): void {
    const e = store.get(id);
    if (!e) return;
    store.set(id, {
      ...e,
      status: 'done',
      pct: 100,
      ...(serverFileName ? { storedFileName: serverFileName } : {}),
    });
    broadcast();
  },

  fail(id: string, error?: string): void {
    const e = store.get(id);
    if (!e) return;
    store.set(id, { ...e, status: 'failed', error });
    broadcast();
  },

  duplicate(id: string, duplicateOfFileName: string): void {
    const e = store.get(id);
    if (!e) return;
    store.set(id, { ...e, status: 'duplicate', pct: 100, duplicateOfFileName });
    broadcast();
  },

  dismiss(id: string): void {
    store.delete(id);
    broadcast();
  },

  get(id: string): UploadEntry | undefined {
    return store.get(id);
  },

  forClient(slug: string): UploadEntry[] {
    return snap().filter(e => e.clientSlug === slug);
  },
};
