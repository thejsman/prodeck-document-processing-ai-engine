'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Globe, Trash2, MoreHorizontal, Clock, FolderOpen, Eye } from 'lucide-react';
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

// Section type → accent color

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
    version: e.version ?? 1,
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

      <div className="proposal-cards-grid" style={{ padding: 0, maxWidth: 'none', margin: 0 }}>
        {combinedWithVersion.map(({ entry, companyName, version }) => {
          const isPro = entry.ast.generationMode === 'pro';
          const isV2 = entry.ast.generationMode === 'v2';
          const isHovered = hoveredCard === entry.id;
          const primaryColor = entry.ast.brand?.primaryColor || '#4f46e5';
          const secondaryColor = entry.ast.brand?.secondaryColor || '#7c3aed';

          return (
            <div
              key={entry.id}
              className="proposal-card"
              style={{
                gap: 0,
                position: 'relative',
                padding: 0,
                overflow: 'hidden',
                cursor: 'default',
                transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
                boxShadow: isHovered
                  ? `0 20px 48px rgba(0,0,0,0.36), 0 0 0 1.5px ${primaryColor}66`
                  : `0 4px 16px rgba(0,0,0,0.18)`,
                borderColor: isHovered ? `${primaryColor}55` : 'var(--border)',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
              }}
              onMouseEnter={() => setHoveredCard(entry.id)}
              onMouseLeave={() => setHoveredCard(null)}
            >
              {/* ── Hero header ── */}
              <div
                style={{
                  height: 72,
                  background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
                  position: 'relative',
                  flexShrink: 0,
                  overflow: 'hidden',
                }}
              >
                {/* Soft radial glow */}
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: `radial-gradient(ellipse at 30% 50%, ${primaryColor}88 0%, transparent 70%)`,
                }} />
                {/* Noise grain */}
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.06'/%3E%3C/svg%3E\")",
                  opacity: 0.6,
                }} />

                {/* Mode pill */}
                <div style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: 'rgba(255,255,255,0.18)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255,255,255,0.25)',
                  borderRadius: 100,
                  padding: '4px 10px',
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#fff',
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase' as const,
                }}>
                  {isV2 ? '✦' : isPro ? '⚡' : '🎨'} {isV2 ? 'Microsite' : isPro ? 'Pro' : 'Classic'}
                </div>

                {/* Version pill */}
                <div style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  background: 'rgba(0,0,0,0.28)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 100,
                  padding: '4px 10px',
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.9)',
                  letterSpacing: '0.06em',
                }}>
                  v{version}
                </div>

                {/* Options menu button — bottom-right of hero */}
                <button
                  ref={(el) => { menuBtnRefs.current[entry.id] = el; }}
                  className="btn btn-sm"
                  title="Options"
                  onClick={(e) => { e.stopPropagation(); openMenu(entry); }}
                  style={{
                    position: 'absolute',
                    bottom: 8,
                    right: 10,
                    padding: '2px 4px',
                    border: 'none',
                    background: 'rgba(0,0,0,0.25)',
                    borderRadius: 6,
                    color: '#fff',
                    lineHeight: 1,
                    opacity: isHovered || menuEntry?.id === entry.id ? 1 : 0,
                    pointerEvents: isHovered || menuEntry?.id === entry.id ? 'auto' : 'none',
                    transition: 'opacity 0.15s',
                  }}
                >
                  <Icon icon={MoreHorizontal} size="sm" />
                </button>
              </div>

              {/* ── Body ── */}
              <div style={{ padding: '14px 14px 12px' }}>
                {/* Title */}
                <span
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'var(--text)',
                    lineHeight: 1.4,
                    marginBottom: 8,
                  }}
                >
                  {companyName}
                </span>

                {/* Namespace + timestamp row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 6 }}>
                  <span
                    title={entry.namespace}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      background: `${primaryColor}18`,
                      border: `1px solid ${primaryColor}35`,
                      borderRadius: 6,
                      padding: '2px 8px 2px 6px',
                      fontSize: 10,
                      fontWeight: 700,
                      color: primaryColor,
                      maxWidth: '60%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      letterSpacing: '0.03em',
                    }}
                  >
                    <FolderOpen size={9} style={{ flexShrink: 0 }} />
                    {entry.namespace}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>
                    <Clock size={9} />
                    {formatDate(entry.savedAt)}
                  </span>
                </div>
              </div>

              {/* ── Footer ── */}
              <div style={{ padding: '0 12px 12px' }}>
                <button
                  onClick={() => setPreviewEntry(entry)}
                  title="View microsite"
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '9px 0',
                    borderRadius: 10,
                    border: 'none',
                    background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    letterSpacing: '0.03em',
                    boxShadow: isHovered ? `0 4px 16px ${primaryColor}55` : `0 2px 8px ${primaryColor}33`,
                    transition: 'filter 0.15s, box-shadow 0.2s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; }}
                >
                  <Eye size={12} /> View
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
