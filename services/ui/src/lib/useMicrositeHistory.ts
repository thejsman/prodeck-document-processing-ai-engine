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
    // inner may be "<ns>::chat" for chat-generated entries
    const isChatEntry = inner.endsWith('::chat');
    const targetNs = isChatEntry ? inner.slice(0, -6) : inner;
    if (apiKey && targetNs) {
      deleteMicrositeHistoryFromServer(apiKey, targetNs, isChatEntry ? 'chat' : undefined)
        .then(() => load()).catch(() => {});
    }
  }, [namespace, apiKey, load]);

  const refresh = useCallback(() => { load(); }, [load]);

  return { history, loading, addEntry, updateEntry, deleteEntry, refresh };
}
