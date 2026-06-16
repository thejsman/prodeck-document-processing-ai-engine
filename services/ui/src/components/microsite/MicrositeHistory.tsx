'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Globe, Trash2, MoreHorizontal } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { Microsite } from './Microsite';
import { MicrositePro } from './MicrositePro';
import { MicrositeV2 } from '../MicrositeV2';
import { useMicrositeHistory } from '@/lib/useMicrositeHistory';
import { fetchAllMicrositeHistory, deleteMicrositeHistoryFromServer } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useNamespace } from '@/lib/namespace-context';
import type { LayoutAST } from '@/types/presentation';

interface CombinedEntry {
  id: string;
  entryId?: string;  // canonical storage key: microsite:pro:1716023445123
  version?: number;  // stored version from server
  savedAt: string;
  namespace: string;
  ast: LayoutAST;
  source: 'local' | 'server';
  title?: string;    // explicit title from super-client microsites.json
}


function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    });
  } catch {
    return iso;
  }
}

export function MicrositeHistory({
  onCountChange,
}: {
  onCountChange?: (count: number) => void;
  onGenerateNew?: () => void;
}) {
  const { apiKey } = useAuth();
  const { namespaces } = useNamespace();
  const router = useRouter();
  const { history: localHistory, refresh } = useMicrositeHistory(undefined, apiKey ?? undefined);
  const [serverEntries, setServerEntries] = useState<CombinedEntry[]>([]);
  const [loadingServer, setLoadingServer] = useState(false);
  const [deletedNamespaces, setDeletedNamespaces] = useState<Set<string>>(new Set());

  const loadServerEntries = useCallback(() => {
    if (!apiKey) return;
    setLoadingServer(true);
    fetchAllMicrositeHistory(apiKey)
      .then((items) => {
        setServerEntries(
          items
            .filter((item) => item.ast && (item.ast as { sections?: unknown[] }).sections?.length)
            .map((item) => {
              return {
                id: item.id,
                entryId: item.id,
                version: item.version,
                savedAt: item.savedAt,
                namespace: item.namespace,
                ast: item.ast as LayoutAST,
                source: 'server' as const,
                title: item.title,
              };
            }),
        );
      })
      .catch(() => {})
      .finally(() => setLoadingServer(false));
  }, [apiKey]);
  const [previewEntry, setPreviewEntry] = useState<CombinedEntry | null>(null);

  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [menuEntry, setMenuEntry] = useState<CombinedEntry | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [confirmEntry, setConfirmEntry] = useState<CombinedEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const menuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const openMenu = useCallback((entry: CombinedEntry) => {
    const btn = menuBtnRefs.current[entry.id];
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setMenuEntry(entry);
  }, []);

  useEffect(() => {
    if (!menuEntry) return;
    const handler = (e: MouseEvent) => {
      const btn = menuBtnRefs.current[menuEntry.id];
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        btn &&
        !btn.contains(e.target as Node)
      )
        setMenuEntry(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuEntry]);

  const handleDeleteConfirmed = async () => {
    if (!confirmEntry || !apiKey) return;
    const entryId = confirmEntry.entryId;
    if (!entryId) return;
    setDeleting(true);
    // Optimistically hide the entry immediately so it vanishes before the async fetch.
    setDeletedNamespaces((prev) => new Set([...prev, entryId]));
    try {
      await deleteMicrositeHistoryFromServer(apiKey, confirmEntry.namespace, entryId);
      setServerEntries((prev) => prev.filter((e) => e.entryId !== entryId));
      refresh();
    } catch {
      // Rollback optimistic removal on failure.
      setDeletedNamespaces((prev) => { const next = new Set(prev); next.delete(entryId); return next; });
    } finally {
      setDeleting(false);
      setConfirmEntry(null);
    }
  };

  const handleEdit = useCallback(
    (entry: CombinedEntry) => {
      const ns = entry.namespace;
      const pid = entry.ast.proposalId || ns;
      const entryParam = entry.entryId ? `?entryId=${encodeURIComponent(entry.entryId)}` : '';
      const dest =
        entry.ast.generationMode === 'classic'
          ? `/microsite-editor/${encodeURIComponent(ns)}/${encodeURIComponent(pid)}${entryParam}`
          : `/microsite-editor-pro/${encodeURIComponent(ns)}/${encodeURIComponent(pid)}${entryParam}`;
      router.push(dest);
    },
    [router],
  );

  useEffect(() => { loadServerEntries(); }, [loadServerEntries]);

  // Re-fetch when the user navigates back from an editor page.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadServerEntries();
        refresh();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [loadServerEntries, refresh]);

  const combined: CombinedEntry[] = (() => {
    const localMapped: CombinedEntry[] = localHistory
      .filter((e) => e.ast && (e.ast as { sections?: unknown[] }).sections?.length)
      .map((e) => ({ id: e.id, savedAt: e.savedAt, namespace: e.namespace, ast: e.ast, source: 'local' as const }));
    // Show all server entries — each has a unique entryId (microsite:type:timestamp).
    // Local entries (from localStorage) only fill in namespace::mode combos that have
    // no server entries yet, to avoid duplicating stale local data alongside server data.
    const serverCoveredKeys = new Set(serverEntries.map((e) => `${e.namespace}::${e.ast.generationMode || ''}`));
    const localOnly = localMapped.filter((e) => !serverCoveredKeys.has(`${e.namespace}::${e.ast.generationMode || ''}`));
    return [...serverEntries, ...localOnly]
      .filter((e) => !deletedNamespaces.has(e.entryId ?? e.id))
      .filter((e) => e.source === 'server' || namespaces.length === 0 || namespaces.includes(e.namespace))
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  })();

  useEffect(() => {
    onCountChange?.(combined.length);
  }, [combined.length, onCountChange]);

  if (previewEntry) {
    const PreviewComponent =
      previewEntry.ast.generationMode === 'v2'
        ? MicrositeV2
        : previewEntry.ast.generationMode === 'pro'
          ? MicrositePro
          : Microsite;
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 40000, background: 'var(--panel, #fff)', overflow: 'auto' }}>
        <PreviewComponent
          ast={previewEntry.ast}
          onBack={() => {
            refresh();
            loadServerEntries();
            setPreviewEntry(null);
          }}
          onEdit={() => handleEdit(previewEntry)}
          namespace={previewEntry.namespace}
          proposalId={previewEntry.id}
        />
      </div>
    );
  }

  if (!loadingServer && combined.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 300,
          padding: '40px 20px',
        }}
      >
        <div style={{ maxWidth: 340, textAlign: 'center' }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: 'var(--panel-soft)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <Globe size={24} strokeWidth={1.5} style={{ color: 'var(--muted)' }} />
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px' }}>No microsites yet</p>
        </div>
      </div>
    );
  }

  const combinedWithVersion = combined.map((e) => ({
    entry: e,
    companyName: e.ast.brand?.companyName || e.title || 'Untitled',
  }));

  return (
    <>
      {loadingServer && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--muted)',
            marginBottom: 20,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              border: '1.5px solid var(--border)',
              borderTopColor: 'var(--primary)',
              animation: 'ms-spin 0.8s linear infinite',
            }}
          />
          Loading history…
        </div>
      )}

      <div className="proposal-cards-grid" style={{ paddingTop: 20, paddingLeft: 0, paddingRight: 0, paddingBottom: 0, maxWidth: 'none', margin: 0 }}>
        {combinedWithVersion.map(({ entry, companyName }) => {
          const isHovered = hoveredCard === entry.id;

          return (
            <div
              key={entry.id}
              className="proposal-card"
              style={{ position: 'relative' }}
              onMouseEnter={() => setHoveredCard(entry.id)}
              onMouseLeave={() => setHoveredCard(null)}
            >
              {/* Options button — absolutely positioned, hover-only */}
              <button
                ref={(el) => { menuBtnRefs.current[entry.id] = el; }}
                className="btn btn-sm"
                title="Options"
                onClick={(e) => { e.stopPropagation(); openMenu(entry); }}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  padding: '1px 5px',
                  border: 'none',
                  lineHeight: 1,
                  opacity: isHovered || menuEntry?.id === entry.id ? 1 : 0,
                  pointerEvents: isHovered || menuEntry?.id === entry.id ? 'auto' : 'none',
                  transition: 'opacity 0.15s',
                  zIndex: 1,
                }}
              >
                <Icon icon={MoreHorizontal} size="sm" />
              </button>

              {/* Header: title + date */}
              <div className="proposal-card-header">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span className="proposal-card-eyebrow">Microsite</span>
                  <span className="proposal-card-name">{companyName}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>
                    {formatDate(entry.savedAt)}
                  </span>
                </div>
              </div>

              {/* Footer: namespace + view button */}
              <div className="proposal-card-footer">
                <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1 }}>{entry.namespace}</span>
                <button className="chat-v2-clear-btn" onClick={() => setPreviewEntry(entry)}>
                  View
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Options dropdown */}
      {menuEntry &&
        createPortal(
          <div
            ref={dropdownRef}
            className="card"
            style={{
              position: 'fixed',
              top: menuPos.top,
              right: menuPos.right,
              minWidth: 130,
              padding: '4px 0',
              zIndex: 99999,
            }}
          >
            <button
              className="btn btn-sm"
              style={{
                width: '100%',
                textAlign: 'left',
                borderRadius: 0,
                border: 'none',
                justifyContent: 'flex-start',
                padding: '8px 14px',
                fontSize: 13,
                color: 'var(--danger)',
                gap: 8,
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const e = menuEntry;
                setMenuEntry(null);
                setConfirmEntry(e);
              }}
            >
              <Icon icon={Trash2} size="sm" />
              <span>Delete</span>
            </button>
          </div>,
          document.body,
        )}

      {/* Confirm delete */}
      {confirmEntry &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 20000,
              background: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !deleting) setConfirmEntry(null);
            }}
          >
            <div
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                width: '100%',
                maxWidth: 400,
                boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Delete microsite?</p>
              </div>
              <div style={{ padding: '20px 24px 24px' }}>
                <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
                  This will permanently remove the microsite for{' '}
                  <strong style={{ color: 'var(--text)' }}>
                    "{confirmEntry.ast.brand?.companyName || confirmEntry.namespace}"
                  </strong>
                  .
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setConfirmEntry(null)}
                    disabled={deleting}
                    style={{
                      padding: '8px 18px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--text)',
                      fontSize: 13,
                      cursor: deleting ? 'not-allowed' : 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteConfirmed}
                    disabled={deleting}
                    style={{
                      padding: '8px 18px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--danger)',
                      color: '#fff',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: deleting ? 'not-allowed' : 'pointer',
                      opacity: deleting ? 0.7 : 1,
                    }}
                  >
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <style>{`
        @keyframes ms-spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
