'use client';

import { useState, useEffect, useCallback } from 'react';
import type { LayoutAST } from '@/types/presentation';

export interface MicrositeHistoryEntry {
  id: string;
  savedAt: string;
  namespace: string;
  ast: LayoutAST;
}

const STORAGE_KEY = 'ms_history';
const EVENT_NAME = 'ms-history-update';

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

export function useMicrositeHistory(namespace?: string) {
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
    setAll(prev => {
      const next = [entry, ...prev].slice(0, 50);
      writeAll(next);
      return next;
    });
    return entry;
  }, [namespace]);

  const deleteEntry = useCallback((id: string) => {
    setAll(prev => {
      const next = prev.filter(e => e.id !== id);
      writeAll(next);
      return next;
    });
  }, []);

  return { history, addEntry, deleteEntry };
}
