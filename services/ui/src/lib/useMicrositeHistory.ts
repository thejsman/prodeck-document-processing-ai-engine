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
    return raw ? (JSON.parse(raw) as MicrositeHistoryEntry[]) : [];
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

  const deleteEntry = useCallback((id: string) => {
    setAll(prev => {
      const deletedNs = prev.find(e => e.id === id)?.namespace;
      const next = prev.filter(e => e.id !== id);
      writeAll(next);
      // Sync delete to server (fire-and-forget)
      if (apiKey && deletedNs) {
        deleteMicrositeHistoryFromServer(apiKey, deletedNs).catch(() => {});
      }
      return next;
    });
  }, [apiKey]);

  const refresh = useCallback(() => {
    setAll(readAll());
  }, []);

  return { history, addEntry, deleteEntry, refresh };
}
