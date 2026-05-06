'use client';

import { useState } from 'react';
import type { KnowledgeEntry } from '@/lib/api';

interface Props {
  count: number;
  entries?: KnowledgeEntry[];
}

export function KnowledgeEntryList({ count, entries }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (count === 0) return null;

  return (
    <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          Also captured {count} knowledge entr{count !== 1 ? 'ies' : 'y'} (preferences, constraints…)
        </span>
        {entries && entries.length > 0 && (
          <button
            className="btn btn-sm"
            style={{ height: 20, padding: '0 8px', fontSize: 11 }}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Hide' : 'View'}
          </button>
        )}
      </div>

      {expanded && entries && entries.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map((entry) => (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                gap: 6,
                fontSize: 12,
                color: 'var(--text)',
                padding: '4px 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span style={{ flexShrink: 0 }}>💬</span>
              <span style={{ flex: 1 }}>{entry.content}</span>
              <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--muted)', alignSelf: 'flex-start' }}>
                {entry.category}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
