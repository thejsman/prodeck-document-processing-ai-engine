'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useExecutionStore } from '@/core/execution/execution-store';
import { useProposalStats } from '@/lib/use-dashboard-stats';
import { useAuth } from '@/lib/auth-context';

interface Props {
  namespace: string;
  /** Dynamic suggestions from the namespace intelligence scan. */
  insights?: string[];
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

export function ChatContextPanel({ namespace, insights }: Props) {
  const { apiKey } = useAuth();
  const router = useRouter();
  const executions = useExecutionStore((s) => s.executions);
  const proposalStats = useProposalStats(apiKey);

  const activeExecs = useMemo(
    () => Object.values(executions).filter((e) => e.status === 'running' || e.status === 'queued'),
    [executions],
  );

  const recentExecs = useMemo(
    () =>
      Object.values(executions)
        .filter((e) => e.status === 'completed' || e.status === 'failed')
        .sort((a, b) => (b.completedAt ?? b.failedAt ?? 0) - (a.completedAt ?? a.failedAt ?? 0))
        .slice(0, 4),
    [executions],
  );

  return (
    <aside className="chat-ctx-panel">
      {/* Active tasks */}
      <div className="chat-ctx-section">
        <h4 className="chat-ctx-title">Active Tasks</h4>
        {activeExecs.length === 0 ? (
          <p className="chat-ctx-empty">No active tasks</p>
        ) : (
          <ul className="chat-ctx-list">
            {activeExecs.map((ex) => (
              <li key={ex.id} className="chat-ctx-item">
                <span className="chat-ctx-spinner" />
                <div className="chat-ctx-item-body">
                  <span className="chat-ctx-item-label">{ex.title ?? ex.type}</span>
                  <span className="chat-ctx-item-sub">{ex.message ?? 'Running…'}</span>
                </div>
                <button
                  className="chat-ctx-view-btn"
                  onClick={() => router.push(`/executions/${ex.id}`)}
                >
                  View
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recent executions */}
      {recentExecs.length > 0 && (
        <div className="chat-ctx-section">
          <h4 className="chat-ctx-title">Recent</h4>
          <ul className="chat-ctx-list">
            {recentExecs.map((ex) => (
              <li key={ex.id} className="chat-ctx-item">
                <span
                  className={`chat-ctx-dot ${ex.status === 'failed' ? 'chat-ctx-dot--failed' : 'chat-ctx-dot--done'}`}
                />
                <div className="chat-ctx-item-body">
                  <span className="chat-ctx-item-label">{ex.title ?? ex.type}</span>
                  <span className="chat-ctx-item-sub">
                    {formatAgo(ex.completedAt ?? ex.failedAt ?? Date.now())}
                  </span>
                </div>
                <button
                  className="chat-ctx-view-btn"
                  onClick={() => router.push(`/executions/${ex.id}`)}
                >
                  View
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Proposals */}
      <div className="chat-ctx-section">
        <h4 className="chat-ctx-title">Proposals</h4>
        <div className="chat-ctx-stat-row">
          <span className="chat-ctx-stat-value">
            {proposalStats.loading ? '…' : proposalStats.total}
          </span>
          <span className="chat-ctx-stat-label">total</span>
        </div>
        <Link href="/proposal" className="chat-ctx-link">View all <Icon icon={ArrowRight} size="xs" /></Link>
      </div>

      {/* Namespace insights */}
      {insights && insights.length > 0 && (
        <div className="chat-ctx-section">
          <h4 className="chat-ctx-title">Insights</h4>
          <ul className="chat-ctx-insights-list">
            {insights.map((s) => (
              <li key={s} className="chat-ctx-insights-item">{s}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Namespace */}
      <div className="chat-ctx-section">
        <h4 className="chat-ctx-title">Project</h4>
        <span className="chat-ctx-ns-badge">{namespace || 'default'}</span>
        <Link href="/ingest" className="chat-ctx-link" style={{ display: 'block', marginTop: 8 }}>
          Add documents <Icon icon={ArrowRight} size="xs" />
        </Link>
      </div>
    </aside>
  );
}
