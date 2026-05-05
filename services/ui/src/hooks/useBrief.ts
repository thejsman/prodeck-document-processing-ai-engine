'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchBriefReadiness,
  updateContextField,
  confirmExtraction,
  updateKnowledgeEntry,
  deleteKnowledgeEntry,
  type BriefReadiness,
  type BriefContext,
  type RequirementKey,
  type PendingExtraction,
} from '@/lib/api';

export type { BriefReadiness, BriefContext, RequirementKey, PendingExtraction };

const POLL_INTERVAL_MS = 8000;

export function useBrief(namespace: string, apiKey: string) {
  const [context, setContext] = useState<BriefContext | null>(null);
  const [readiness, setReadiness] = useState<BriefReadiness | null>(null);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!namespace || !apiKey) return;
    try {
      const data = await fetchBriefReadiness(apiKey, namespace);
      setContext(data.context);
      setReadiness(data.readiness);
    } catch {
      // Non-fatal — panel shows empty state
    }
  }, [namespace, apiKey]);

  // Initial load + polling
  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));

    intervalRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh]);

  const updateField = useCallback(
    async (key: RequirementKey, value: unknown) => {
      if (!apiKey || !namespace) return;
      try {
        const data = await updateContextField(apiKey, namespace, key, value);
        setReadiness(data.readiness);
        // Optimistic update of the field in context
        setContext((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            requirements: {
              ...prev.requirements,
              fields: {
                ...prev.requirements.fields,
                [key]: data.field,
              },
            },
          };
        });
      } catch (err) {
        throw err;
      }
    },
    [apiKey, namespace],
  );

  const confirm = useCallback(
    async (
      fields: Partial<Record<RequirementKey, { value: unknown; confidence: number; source: 'user' | 'document' | 'inferred' }>>,
      documentId?: string,
    ) => {
      if (!apiKey || !namespace) return;
      const data = await confirmExtraction(apiKey, namespace, fields, documentId);
      setContext(data.context);
      setReadiness(data.readiness);
    },
    [apiKey, namespace],
  );

  const updateKnowledge = useCallback(
    async (id: string, content: string) => {
      if (!apiKey || !namespace) return;
      const data = await updateKnowledgeEntry(apiKey, namespace, id, content);
      setContext(data.context);
    },
    [apiKey, namespace],
  );

  const deleteKnowledge = useCallback(
    async (id: string) => {
      if (!apiKey || !namespace) return;
      const data = await deleteKnowledgeEntry(apiKey, namespace, id);
      setContext(data.context);
    },
    [apiKey, namespace],
  );

  return {
    context,
    readiness,
    loading,
    refresh,
    updateField,
    confirm,
    updateKnowledge,
    deleteKnowledge,
    canGenerate: readiness?.canGenerate ?? false,
    blockingField: readiness?.blockingField ?? null,
    pendingExtractions: context?.pendingExtractions ?? [],
  };
}
