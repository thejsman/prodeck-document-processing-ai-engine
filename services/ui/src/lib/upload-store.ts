// Module-level store — survives component unmount/remount (page navigation).
// Tracks file upload progress for the chat composer attach flow.

export type UploadStatus = 'uploading' | 'done' | 'failed';

export interface UploadEntry {
  id: string;
  clientSlug: string;
  fileName: string;
  status: UploadStatus;
  pct: number;       // 0–100
  error?: string;
  addedAt: number;   // Date.now()
}

type Listener = (entries: UploadEntry[]) => void;

const store = new Map<string, UploadEntry>();
const listeners = new Set<Listener>();

// ── localStorage persistence ──────────────────────────────────────

const STORAGE_KEY = 'prodeck-uploads-v1';
const DONE_TTL_MS = 60_000; // keep done/failed entries visible for 60 s

function persist(entries: UploadEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    // Persist all entries — uploading entries are recovered as "failed" on reload (XHR died)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* ignore quota errors */ }
}

function hydrate(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data: UploadEntry[] = JSON.parse(raw);
    const now = Date.now();
    for (const e of data) {
      // Drop old done/failed entries and any stale "uploading" entries
      if (e.status === 'uploading') {
        // XHR died — mark as failed
        store.set(e.id, { ...e, status: 'failed', error: 'Upload interrupted' });
      } else if (now - e.addedAt < DONE_TTL_MS) {
        store.set(e.id, e);
      }
      // Silently drop entries older than TTL
    }
  } catch { /* ignore parse errors */ }
}

hydrate();

// ── Core ─────────────────────────────────────────────────────────

function snap(): UploadEntry[] {
  return [...store.values()];
}

function broadcast() {
  const s = snap();
  persist(s);
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
      addedAt: Date.now(),
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
      ...(serverFileName ? { fileName: serverFileName } : {}),
    });
    broadcast();
  },

  fail(id: string, error?: string): void {
    const e = store.get(id);
    if (!e) return;
    store.set(id, { ...e, status: 'failed', error });
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
