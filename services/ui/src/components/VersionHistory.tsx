'use client';

import { useEffect, useState } from 'react';
import { fetchProposals, type ProposalFile, type ProposalStatus } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface Props {
  refreshKey: number;
  onSelect?: (file: ProposalFile) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: 'Draft',
  under_review: 'Review',
  approved: 'Approved',
  finalized: 'Final',
};

export function VersionHistory({ refreshKey, onSelect }: Props) {
  const { apiKey } = useAuth();
  const [proposals, setProposals] = useState<ProposalFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchProposals(apiKey)
      .then((p) => {
        if (!cancelled) setProposals(p);
      })
      .catch(() => {
        if (!cancelled) setProposals([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey, refreshKey]);

  return (
    <div className="card">
      <h2>Version History</h2>

      {loading ? (
        <p className="loading">Loading...</p>
      ) : proposals.length === 0 ? (
        <p className="muted">No proposals generated yet</p>
      ) : (
        <ul className="history-list">
          {proposals.map((p) => (
            <li
              key={p.fileName}
              className="history-item"
              onClick={() => onSelect?.(p)}
              style={onSelect ? { cursor: 'pointer' } : undefined}
              title={onSelect ? `Load ${p.client}` : undefined}
            >
              <div>
                <span className="history-item-name">{p.client}</span>
                {p.version != null && (
                  <span className="badge" style={{ marginLeft: 8 }}>
                    v{p.version}
                  </span>
                )}
                {p.status && (
                  <span
                    className={`badge badge--${p.status.replace('_', '-')}`}
                    style={{ marginLeft: 4 }}
                  >
                    {STATUS_LABELS[p.status]}
                  </span>
                )}
              </div>
              <span className="history-item-meta">
                {formatDate(p.createdAt)} &middot; {formatBytes(p.sizeBytes)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
