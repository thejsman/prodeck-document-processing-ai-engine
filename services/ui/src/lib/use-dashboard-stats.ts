'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useExecutionStore } from '@/core/execution/execution-store';
import { fetchProposals, fetchTemplates, type ProposalFile } from './api';

// ── Types ─────────────────────────────────────────────────────────

export interface ActivityItem {
  id: string;
  type: 'proposal' | 'ingestion' | 'microsite' | 'agent';
  label: string;
  detail: string;
  timestamp: string;
  href?: string;
}

export interface ExecutionStats {
  activeExecutions: number;
  ingestionJobs: number;
  loading: boolean;
}

export interface KnowledgeStats {
  docCount: number;
  chunkCount: number;
  loading: boolean;
}

// ── Execution stats ───────────────────────────────────────────────

/** Live counts sourced from the execution Zustand store. */
export function useExecutionStats(): ExecutionStats {
  const activeExecutions = useExecutionStore((s) => s.getRunningCount());
  return { activeExecutions, ingestionJobs: 0, loading: false };
}

// ── Knowledge stats ───────────────────────────────────────────────

/**
 * Fetches proposal + template counts.
 * Document / chunk counts are reserved for a future `/api/stats` endpoint;
 * placeholders are shown until that endpoint exists.
 */
export function useKnowledgeStats(apiKey: string | null): KnowledgeStats {
  const [state, setState] = useState<KnowledgeStats>({
    docCount: 0,
    chunkCount: 0,
    loading: true,
  });

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    // Future: replace with a real /api/knowledge/stats endpoint
    const timer = setTimeout(() => {
      if (!cancelled) {
        setState({ docCount: 0, chunkCount: 0, loading: false });
      }
    }, 600);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [apiKey]);

  return state;
}

// ── Proposal stats ────────────────────────────────────────────────

interface ProposalStats {
  total: number;
  last7Days: number;
  loading: boolean;
}

export function useProposalStats(apiKey: string | null): ProposalStats {
  const [state, setState] = useState<ProposalStats>({ total: 0, last7Days: 0, loading: true });

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    fetchProposals(apiKey)
      .then((proposals: ProposalFile[]) => {
        if (cancelled) return;
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const last7Days = proposals.filter(
          (p) => p.createdAt && new Date(p.createdAt).getTime() > cutoff,
        ).length;
        setState({ total: proposals.length, last7Days, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ total: 0, last7Days: 0, loading: false });
      });

    return () => { cancelled = true; };
  }, [apiKey]);

  return state;
}

// ── Template count ────────────────────────────────────────────────

export function useTemplateCount(apiKey: string | null): { count: number; loading: boolean } {
  const [state, setState] = useState({ count: 0, loading: true });

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    fetchTemplates(apiKey)
      .then((t) => { if (!cancelled) setState({ count: t.length, loading: false }); })
      .catch(() => { if (!cancelled) setState({ count: 0, loading: false }); });

    return () => { cancelled = true; };
  }, [apiKey]);

  return state;
}

// ── Recent activity ───────────────────────────────────────────────

/**
 * Derives a unified recent activity feed from the proposals list and the
 * execution store history.
 *
 * Activity from the execution store (completed / failed) is merged with
 * proposals sorted by createdAt, deduplicated by id, and returned newest-first.
 */
export function useRecentActivity(apiKey: string | null): {
  items: ActivityItem[];
  loading: boolean;
} {
  const [loading, setLoading] = useState(true);
  const [proposalItems, setProposalItems] = useState<ActivityItem[]>([]);

  // Select the raw executions record — its reference only changes when a
  // mutation calls set(), so useMemo below won't run on every render.
  const executions = useExecutionStore((s) => s.executions);

  const executionItems = useMemo((): ActivityItem[] => {
    const all = Object.values(executions);
    const completed = all
      .filter((e) => e.status === 'completed')
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, 5);
    const failed = all
      .filter((e) => e.status === 'failed')
      .sort((a, b) => (b.failedAt ?? 0) - (a.failedAt ?? 0))
      .slice(0, 3);
    return [...completed, ...failed]
      .sort((a, b) => (b.completedAt ?? b.failedAt ?? 0) - (a.completedAt ?? a.failedAt ?? 0))
      .slice(0, 6)
      .map((ex): ActivityItem => ({
        id:        `exec-${ex.id}`,
        type:      ex.type === 'microsite' ? 'microsite' : ex.type === 'proposal' ? 'proposal' : 'agent',
        label:     ex.status === 'failed' ? 'Execution failed' : labelForType(ex.type),
        detail:    ex.title ?? ex.id,
        timestamp: formatRelative(ex.completedAt ?? ex.failedAt ?? Date.now()),
        href:      `/executions/${ex.id}`,
      }));
  }, [executions]);

  // Fetch recent proposals
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (!apiKey || fetchedRef.current) return;
    fetchedRef.current = true;

    fetchProposals(apiKey)
      .then((proposals) => {
        const items: ActivityItem[] = proposals
          .slice()
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 5)
          .map((p): ActivityItem => ({
            id:        `proposal-${p.fileName}`,
            type:      'proposal',
            label:     'Proposal generated',
            detail:    p.client,
            timestamp: formatRelative(new Date(p.createdAt).getTime()),
            href:      `/proposal`,
          }));
        setProposalItems(items);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiKey]);

  // Merge, deduplicate by id, sort by recency
  const seen = new Set<string>();
  const merged: ActivityItem[] = [];
  for (const item of [...executionItems, ...proposalItems]) {
    if (!seen.has(item.id)) { seen.add(item.id); merged.push(item); }
  }

  return { items: merged.slice(0, 8), loading };
}

// ── Helpers ───────────────────────────────────────────────────────

function labelForType(type: string): string {
  switch (type) {
    case 'proposal':  return 'Proposal generated';
    case 'microsite': return 'Microsite published';
    case 'diagram':   return 'Diagram generated';
    case 'analysis':  return 'Analysis complete';
    default:          return 'AI task completed';
  }
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000)       return 'just now';
  if (diff < 3_600_000)    return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000)   return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}
