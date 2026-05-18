'use client';

import { useState, useEffect, useCallback } from 'react';
import type { LayoutAST } from '@/types/presentation';
import { saveMicrositeHistoryToServer, deleteMicrositeHistoryFromServer, fetchAllMicrositeHistory } from './api';

export interface MicrositeHistoryEntry {
  id: string;
  savedAt: string;
  namespace: string;
  ast: LayoutAST;
  source?: string;
}

const STORAGE_KEY = 'microsite_history';

function readAll(): MicrositeHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function writeAll(entries: MicrositeHistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/**
 * Standalone (non-hook) utility: update or insert a history entry for the given
 * namespace in localStorage and sync to the server.  Call this from editor pages
 * after saving edits so the history list reflects the latest AST.
 */
export function persistMicrositeHistoryEntry(namespace: string, ast: LayoutAST, apiKey?: string): void {
  const astForStorage: LayoutAST = ast.brand?.logoUrl?.startsWith('data:')
    ? { ...ast, brand: { ...ast.brand, logoUrl: null } }
    : ast;
  const current = readAll();
  const idx = current.findIndex(e => e.namespace === namespace);
  let next: MicrositeHistoryEntry[];
  if (idx >= 0) {
    const updated: MicrositeHistoryEntry = { ...current[idx], savedAt: new Date().toISOString(), ast: astForStorage };
    next = current.map((e, i) => (i === idx ? updated : e));
  } else {
    const entry: MicrositeHistoryEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      savedAt: new Date().toISOString(),
      namespace,
      ast: astForStorage,
    };
    next = [entry, ...current].slice(0, 50);
  }
  writeAll(next);
  if (apiKey && namespace) {
    saveMicrositeHistoryToServer(apiKey, namespace, astForStorage).catch(() => {});
  }
}

export function useMicrositeHistory(namespace?: string, apiKey?: string) {
  const [entries, setEntries] = useState<MicrositeHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!apiKey) return;
    setLoading(true);
    fetchAllMicrositeHistory(apiKey)
      .then((items) => {
        setEntries(
          items
            .filter((item) => item.ast && (item.ast as { sections?: unknown[] }).sections?.length)
            .map((item) => ({
              id: `server::${item.id ?? item.namespace}`,
              savedAt: item.savedAt,
              namespace: item.namespace,
              ast: item.ast as LayoutAST,
              source: item.source,
            })),
        );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiKey]);

  useEffect(() => { load(); }, [load]);

  const history = namespace ? entries.filter((e) => e.namespace === namespace) : entries;

  const addEntry = useCallback((ast: LayoutAST, ns?: string): MicrositeHistoryEntry => {
    const targetNs = ns ?? namespace ?? '';
    const entry: MicrositeHistoryEntry = {
      id: `server::${targetNs}`,
      savedAt: new Date().toISOString(),
      namespace: targetNs,
      ast,
    };
    if (apiKey && targetNs) {
      saveMicrositeHistoryToServer(apiKey, targetNs, ast).then(() => load()).catch(() => {});
    }
    return entry;
  }, [namespace, apiKey, load]);

  const updateEntry = useCallback((id: string, ast: LayoutAST): MicrositeHistoryEntry => {
    const inner = id.startsWith('server::') ? id.slice(8) : (namespace ?? '');
    const targetNs = inner.endsWith('::chat') ? inner.slice(0, -6) : inner;
    const entry: MicrositeHistoryEntry = {
      id,
      savedAt: new Date().toISOString(),
      namespace: targetNs,
      ast,
    };
    if (apiKey && targetNs) {
      saveMicrositeHistoryToServer(apiKey, targetNs, ast).then(() => load()).catch(() => {});
    }
    return entry;
  }, [namespace, apiKey, load]);

  const deleteEntry = useCallback((id: string) => {
    const inner = id.startsWith('server::') ? id.slice(8) : (namespace ?? '');
    // inner is "<ns>::<mode>" (e.g. "lnp2::pro") or just "<ns>" for legacy
    const lastSep = inner.lastIndexOf('::');
    const targetNs = lastSep >= 0 ? inner.slice(0, lastSep) : inner;
    const rawMode = lastSep >= 0 ? inner.slice(lastSep + 2) : undefined;
    // 'unknown' means no generationMode — delete all files for the namespace
    const modeParam = (rawMode && rawMode !== 'unknown') ? rawMode : undefined;
    if (apiKey && targetNs) {
      deleteMicrositeHistoryFromServer(apiKey, targetNs, modeParam)
        .then(() => load()).catch(() => {});
    }
  }, [namespace, apiKey, load]);

  const refresh = useCallback(() => { load(); }, [load]);

  return { history, loading, addEntry, updateEntry, deleteEntry, refresh };
}
