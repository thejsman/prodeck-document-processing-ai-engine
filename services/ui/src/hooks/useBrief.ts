'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  fetchBriefReadiness,
  updateContextField,
  confirmExtraction,
  confirmExtractionCard,
  updateKnowledgeEntry,
  deleteKnowledgeEntry,
  type BriefReadiness,
  type BriefContext,
  type RequirementKey,
  type PendingExtraction,
} from '@/lib/api';
import { useExtractionCardStore } from '@/core/extraction/extraction-card-store';

export type { BriefReadiness, BriefContext, RequirementKey, PendingExtraction };

const POLL_INTERVAL_MS = 8000;

export function useBrief(namespace: string, apiKey: string) {
  const [context, setContext] = useState<BriefContext | null>(null);
  const [readiness, setReadiness] = useState<BriefReadiness | null>(null);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const allCards = useExtractionCardStore((s) => s.cards);
  const pendingCards = useMemo(
    () => Object.values(allCards).filter((c) => c.namespace === namespace),
    [allCards, namespace],
  );

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

  const confirmCard = useCallback(
    async (
      cardId: string,
      overrides?: Record<string, { value: string }>,
      resolvedConflicts?: Record<RequirementKey, string>,
    ) => {
      if (!apiKey || !namespace) return;
      const data = await confirmExtractionCard(apiKey, namespace, cardId, overrides, resolvedConflicts);
      setContext(data.context);
      setReadiness(data.readiness);
    },
    [apiKey, namespace],
  );

  // Merge pending card fields as pendingConfirmation entries so Brief Panel shows ◐
  const mergedContext = useMemo<BriefContext | null>(() => {
    if (!context) return context;
    const pendingFields: BriefContext['requirements']['fields'] = {};
    for (const card of pendingCards) {
      if (card.cardState !== 'pending') continue;
      for (const field of card.extractedFields) {
        if (pendingFields[field.key] || context.requirements.fields[field.key]) continue;
        pendingFields[field.key] = {
          value: field.value,
          confidence: field.confidence,
          source: 'document',
          updatedAt: new Date(card.addedAt).toISOString(),
          pendingConfirmation: true,
        };
      }
    }
    if (Object.keys(pendingFields).length === 0) return context;
    return {
      ...context,
      requirements: {
        ...context.requirements,
        fields: { ...pendingFields, ...context.requirements.fields },
      },
    };
  }, [context, pendingCards]);

  return {
    context: mergedContext,
    readiness,
    loading,
    refresh,
    updateField,
    confirm,
    confirmCard,
    updateKnowledge,
    deleteKnowledge,
    canGenerate: readiness?.canGenerate ?? false,
    blockingField: readiness?.blockingField ?? null,
    pendingExtractions: context?.pendingExtractions ?? [],
  };
}
