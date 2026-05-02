'use client';

import { useState, useEffect, useCallback } from 'react';
import type { LayoutAST } from '@/types/presentation';
import { saveMicrositeHistoryToServer, deleteMicrositeHistoryFromServer } from './api';

export interface MicrositeHistoryEntry {
  id: string;
  savedAt: string;
  namespace: string;
  ast: LayoutAST;
}

const STORAGE_KEY = 'ms_history';
const EVENT_NAME = 'ms-history-update';

export function getHistoryCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as unknown[]).length : 0;
  } catch {
    return 0;
  }
}

function readAll(): MicrositeHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const entries = JSON.parse(raw) as MicrositeHistoryEntry[];
    // Migration: if proposingCompany was incorrectly set to the client name, clear it
    // so the footer falls back gracefully rather than showing the client as the proposer.
    let dirty = false;
    for (const entry of entries) {
      const brief = entry.ast?.brief as { proposingCompany?: string } | undefined;
      const clientName = entry.ast?.brand?.companyName;
      if (brief && clientName && brief.proposingCompany === clientName) {
        brief.proposingCompany = '';
        dirty = true;
      }
    }
    if (dirty) writeAll(entries);
    return entries;
  } catch {
    return [];
  }
}

function writeAll(entries: MicrositeHistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent(EVENT_NAME));
    }, 0);
  } catch {
    // Quota exceeded — clear and retry with just the latest entry
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 1)));
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent(EVENT_NAME));
      }, 0);
    } catch {}
  }
}

export function useMicrositeHistory(namespace?: string, apiKey?: string) {
  const [all, setAll] = useState<MicrositeHistoryEntry[]>(() => readAll());

  // Re-sync when other hook instances write
  useEffect(() => {
    const handler = () => setAll(readAll());
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  // Filter by namespace if provided, else return all
  const history = namespace
    ? all.filter(e => e.namespace === namespace)
    : all;

  const addEntry = useCallback((ast: LayoutAST, ns?: string): MicrositeHistoryEntry => {
    // Strip base64 image data from brand.logoUrl before saving to localStorage
    // (base64 images can be hundreds of KB and exceed quota silently)
    const astForStorage: LayoutAST = ast.brand?.logoUrl?.startsWith('data:')
      ? { ...ast, brand: { ...ast.brand, logoUrl: null } }
      : ast;
    const entry: MicrositeHistoryEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      savedAt: new Date().toISOString(),
      namespace: ns ?? namespace ?? '',
      ast: astForStorage,
    };
    // Write to localStorage immediately (outside React state) so the entry is
    // persisted even if this runs after the component has unmounted (e.g. the
    // caller is inside a finally block of an async function that outlives the
    // component lifecycle).
    const current = readAll();
    const next = [entry, ...current].slice(0, 50);
    writeAll(next);
    // Sync React state so in-component views update too
    setAll(() => next);
    // Sync to server (fire-and-forget)
    if (apiKey && entry.namespace) {
      saveMicrositeHistoryToServer(apiKey, entry.namespace, astForStorage).catch(() => {});
    }
    return entry;
  }, [namespace, apiKey]);

  const updateEntry = useCallback((id: string, ast: LayoutAST): MicrositeHistoryEntry => {
    const astForStorage: LayoutAST = ast.brand?.logoUrl?.startsWith('data:')
      ? { ...ast, brand: { ...ast.brand, logoUrl: null } }
      : ast;
    const current = readAll();
    const existing = current.find(e => e.id === id);
    if (!existing) {
      // Not in localStorage (e.g. server-only entry) — create new entry instead
      const entry: MicrositeHistoryEntry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        savedAt: new Date().toISOString(),
        namespace: namespace ?? '',
        ast: astForStorage,
      };
      const next = [entry, ...current].slice(0, 50);
      writeAll(next);
      setAll(() => next);
      if (apiKey && entry.namespace) {
        saveMicrositeHistoryToServer(apiKey, entry.namespace, astForStorage).catch(() => {});
      }
      return entry;
    }
    const updated: MicrositeHistoryEntry = { ...existing, savedAt: new Date().toISOString(), ast: astForStorage };
    const next = current.map(e => e.id === id ? updated : e);
    writeAll(next);
    setAll(() => next);
    if (apiKey && updated.namespace) {
      saveMicrositeHistoryToServer(apiKey, updated.namespace, astForStorage).catch(() => {});
    }
    return updated;
  }, [namespace, apiKey]);

  const deleteEntry = useCallback((id: string) => {
    // Read current state synchronously so we can find the namespace before filtering
    const current = readAll();
    const deletedNs = current.find(e => e.id === id)?.namespace;
    const next = current.filter(e => e.id !== id);
    // Persist synchronously (same pattern as addEntry — avoids side-effects in updater)
    writeAll(next);
    setAll(() => next);
    // Sync delete to server (fire-and-forget, outside updater to avoid Strict Mode double-invoke)
    if (apiKey && deletedNs) {
      deleteMicrositeHistoryFromServer(apiKey, deletedNs).catch(() => {});
    }
  }, [apiKey]);

  const refresh = useCallback(() => {
    setAll(readAll());
  }, []);

  return { history, addEntry, updateEntry, deleteEntry, refresh };
}
