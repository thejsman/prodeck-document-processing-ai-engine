'use client';

import { useState } from 'react';
import { Microsite } from './Microsite';
import { useMicrositeHistory, type MicrositeHistoryEntry } from '@/lib/useMicrositeHistory';
import { getPlugin } from '@/lib/presentation/pluginRegistry';

interface Props {
  namespace: string;
}

function getPluginAccent(plugin: string): string {
  try {
    return getPlugin(plugin).tokens.accent;
  } catch {
    return '#6366f1';
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function MicrositeHistory({ namespace }: Props) {
  const { history, deleteEntry } = useMicrositeHistory(namespace);
  const [previewEntry, setPreviewEntry] = useState<MicrositeHistoryEntry | null>(null);

  if (previewEntry) {
    return (
      <Microsite
        ast={previewEntry.ast}
        onBack={() => setPreviewEntry(null)}
      />
    );
  }

  if (history.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '56px 24px', color: 'var(--color-text-muted)' }}>
        <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.35 }}>🗂</div>
        <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text)' }}>
          No microsites generated yet
        </p>
        <p style={{ fontSize: 12, margin: 0 }}>
          Use the Generate tab to create your first microsite
        </p>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .ms-history-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }
        @media (max-width: 960px) {
          .ms-history-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 640px) {
          .ms-history-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div style={{ padding: '4px 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {history.length} microsite{history.length !== 1 ? 's' : ''}
          {namespace ? ` — ${namespace}` : ''}
        </span>
      </div>

      <div className="ms-history-grid">
        {history.map((entry) => {
          const accent = getPluginAccent(entry.ast.plugin);
          const pluginName = entry.ast.plugin || 'default';
          const companyName = entry.ast.brand?.companyName || 'Untitled';
          const sectionCount = entry.ast.sections?.length ?? 0;

          return (
            <div
              key={entry.id}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 10,
                background: 'var(--color-surface)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* Accent top strip */}
              <div style={{ height: 4, background: accent }} />

              {/* Card body */}
              <div style={{ padding: '14px 16px 12px', flex: 1 }}>
                {/* Plugin badge */}
                <span style={{
                  display: 'inline-block',
                  background: `${accent}18`,
                  color: accent,
                  borderRadius: 100,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 8px',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase' as const,
                }}>
                  {pluginName}
                </span>

                {/* Company name */}
                <p style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: 'var(--color-text)',
                  margin: '8px 0 4px',
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {companyName}
                </p>

                {/* Meta row */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {formatDate(entry.savedAt)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>·</span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {sectionCount} section{sectionCount !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Card footer */}
              <div style={{ padding: '0 12px 12px', display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setPreviewEntry(entry)}
                  style={{
                    flex: 1,
                    background: accent,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '7px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Preview
                </button>
                <button
                  onClick={() => deleteEntry(entry.id)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--color-border)',
                    borderRadius: 6,
                    padding: '7px 10px',
                    fontSize: 12,
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                  }}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
