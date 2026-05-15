'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Globe, Trash2, MoreHorizontal, Layers, Clock, FolderOpen, Eye, Pencil } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { Microsite } from './Microsite';
import { MicrositePro } from './MicrositePro';
import { useMicrositeHistory } from '@/lib/useMicrositeHistory';
import { fetchAllMicrositeHistory, deleteMicrositeHistoryFromServer } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useNamespace } from '@/lib/namespace-context';
import { getPlugin } from '@/lib/presentation/pluginRegistry';
import type { LayoutAST } from '@/types/presentation';

interface CombinedEntry {
  id: string;
  savedAt: string;
  namespace: string;
  ast: LayoutAST;
  source: 'local' | 'server';
}

// Section type → accent color
const SECTION_COLORS: Record<string, string> = {
  hero: '', // filled with brand primary at render time
  overview: '#60a5fa',
  about: '#60a5fa',
  introduction: '#60a5fa',
  features: '#34d399',
  capabilities: '#34d399',
  services: '#34d399',
  metrics: '#f59e0b',
  stats: '#f59e0b',
  numbers: '#f59e0b',
  kpi: '#f59e0b',
  testimonials: '#a78bfa',
  quotes: '#a78bfa',
  team: '#fb923c',
  people: '#fb923c',
  timeline: '#38bdf8',
  roadmap: '#38bdf8',
  process: '#38bdf8',
  cta: '#f43f5e',
  contact: '#f43f5e',
  pricing: '#8b5cf6',
  comparison: '#8b5cf6',
};

function getSectionColor(type: string, primaryColor: string): string {
  const key = type.toLowerCase().replace(/[-_]/g, '');
  if (key === 'hero') return primaryColor;
  for (const [k, v] of Object.entries(SECTION_COLORS)) {
    if (key.includes(k)) return v;
  }
  return '#64748b';
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
  onGenerateNew,
}: {
  onCountChange?: (count: number) => void;
  onGenerateNew?: () => void;
}) {
  const { apiKey } = useAuth();
  const { namespaces } = useNamespace();
  const router = useRouter();
  const { history: localHistory, deleteEntry, refresh } = useMicrositeHistory(undefined, apiKey ?? undefined);
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
              const mode = (item.ast as LayoutAST)?.generationMode;
              return {
                id: `server::${item.namespace}::${mode || 'unknown'}`,
                savedAt: item.savedAt,
                namespace: item.namespace,
                ast: item.ast as LayoutAST,
                source: 'server' as const,
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
    setDeleting(true);
    const ns = confirmEntry.namespace;
    const mode = confirmEntry.ast.generationMode;
    const deletedKey = mode ? `${ns}::${mode}` : ns;
    // Optimistically hide the entry immediately so it vanishes before the async fetch.
    setDeletedNamespaces((prev) => new Set([...prev, deletedKey]));
    try {
      await deleteMicrositeHistoryFromServer(apiKey, ns, mode ?? undefined);
      setServerEntries((prev) =>
        prev.filter((e) => !(e.namespace === ns && e.ast.generationMode === mode)),
      );
      refresh();
    } catch {
      // Rollback optimistic removal on failure.
      setDeletedNamespaces((prev) => { const next = new Set(prev); next.delete(deletedKey); return next; });
    } finally {
      setDeleting(false);
      setConfirmEntry(null);
    }
  };

  const handleEdit = useCallback(
    (entry: CombinedEntry) => {
      const ns = entry.namespace;
      // API ignores proposalId for file lookup (keys by namespace only);
      // use namespace as a safe fallback when proposalId is absent.
      const pid = entry.ast.proposalId || ns;
      const dest =
        entry.ast.generationMode === 'classic'
          ? `/microsite-editor/${encodeURIComponent(ns)}/${encodeURIComponent(pid)}`
          : `/microsite-editor-pro/${encodeURIComponent(ns)}/${encodeURIComponent(pid)}`;
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
    // Deduplicate by namespace::mode — local entry wins over server for the same mode,
    // but a different mode from the server is still included.
    const localKeys = new Set(localMapped.map((e) => `${e.namespace}::${e.ast.generationMode || ''}`));
    const serverOnly = serverEntries.filter((e) => !localKeys.has(`${e.namespace}::${e.ast.generationMode || ''}`));
    const sorted = [...localMapped, ...serverOnly]
      .filter((e) => {
        const mode = e.ast.generationMode;
        return !deletedNamespaces.has(mode ? `${e.namespace}::${mode}` : e.namespace);
      })
      .filter((e) => namespaces.length === 0 || namespaces.includes(e.namespace))
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    // Final dedup by namespace+mode — keep most recent per mode.
    const seen = new Set<string>();
    return sorted.filter((e) => {
      const key = `${e.namespace}::${e.ast.generationMode || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  useEffect(() => {
    onCountChange?.(combined.length);
  }, [combined.length, onCountChange]);

  if (previewEntry) {
    const PreviewComponent = previewEntry.ast.generationMode !== 'classic' ? MicrositePro : Microsite;
    return (
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
          <p style={{ fontSize: 14, color: 'var(--muted)', margin: '0 0 20px', lineHeight: 1.5 }}>
            Generate your first microsite to see it here.
          </p>
          <button onClick={() => onGenerateNew?.()} className="btn btn-primary btn-sm" style={{ width: 'auto' }}>
            + Generate Microsite
          </button>
        </div>
      </div>
    );
  }

  const combinedWithVersion = (() => {
    const groupCount = new Map<string, number>();
    for (const e of combined) {
      const key = `${e.namespace}::${e.ast.brand?.companyName || 'Untitled'}`;
      groupCount.set(key, (groupCount.get(key) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    return combined.map((e) => {
      const companyName = e.ast.brand?.companyName || 'Untitled';
      const key = `${e.namespace}::${companyName}`;
      const total = groupCount.get(key) ?? 1;
      const idx = seen.get(key) ?? 0;
      seen.set(key, idx + 1);
      return { entry: e, companyName, version: total - idx };
    });
  })();

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
          const accent = getPluginAccent(entry.ast.plugin);
          const pluginName = (entry.ast.plugin || 'default').toUpperCase();
          const isPro = entry.ast.generationMode !== 'classic';
          const isHovered = hoveredCard === entry.id;
          const primaryColor = entry.ast.brand?.primaryColor || '#4f46e5';
          const secondaryColor = entry.ast.brand?.secondaryColor || '#7c3aed';
          const sections = (entry.ast.sections ?? []) as Array<{ sectionType?: string }>;
          const sectionCount = sections.length;
          const clientName = (entry.ast.meta as { client?: string } | undefined)?.client;

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
                transform: isHovered ? 'translateY(-3px)' : 'translateY(0)',
                boxShadow: isHovered
                  ? `0 12px 32px rgba(0,0,0,0.28), 0 0 0 1.5px ${primaryColor}55`
                  : '0 2px 8px rgba(0,0,0,0.14)',
                borderColor: isHovered ? `${primaryColor}66` : 'var(--border)',
                transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease',
              }}
              onMouseEnter={() => setHoveredCard(entry.id)}
              onMouseLeave={() => setHoveredCard(null)}
            >
              {/* ── Header: gradient + section lane visualization ── */}
              <div
                style={{
                  height: 52,
                  background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
                  position: 'relative',
                  flexShrink: 0,
                  overflow: 'hidden',
                }}
              >
                {/* Noise texture overlay */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background:
                      "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E\")",
                    opacity: 0.4,
                  }}
                />

                {/* Mode pill — top-left */}
                <div
                  style={{
                    position: 'absolute',
                    top: 10,
                    left: 12,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    background: 'rgba(0,0,0,0.32)',
                    backdropFilter: 'blur(6px)',
                    borderRadius: 100,
                    padding: '3px 9px',
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#fff',
                    letterSpacing: '0.05em',
                  }}
                >
                  {isPro ? '⚡' : '🎨'} {isPro ? 'Pro' : 'Classic'}
                </div>

                {/* Version pill — top-right */}
                <div
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 12,
                    background: 'rgba(0,0,0,0.32)',
                    backdropFilter: 'blur(6px)',
                    borderRadius: 100,
                    padding: '3px 9px',
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#fff',
                    letterSpacing: '0.05em',
                  }}
                >
                  v{version}
                </div>

                {/* Section type bars — bottom strip */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    display: 'flex',
                    height: 6,
                    gap: 1,
                    padding: '0 1px',
                  }}
                >
                  {sections.length > 0 ? (
                    sections.map((s, i) => (
                      <div
                        key={i}
                        title={s.sectionType ?? 'section'}
                        style={{
                          flex: 1,
                          background: getSectionColor(s.sectionType ?? '', primaryColor),
                          opacity: 0.9,
                          borderRadius: i === 0 ? '2px 0 0 0' : i === sections.length - 1 ? '0 2px 0 0' : 0,
                        }}
                      />
                    ))
                  ) : (
                    <div style={{ flex: 1, background: 'rgba(255,255,255,0.2)' }} />
                  )}
                </div>
              </div>

              {/* ── Body ── */}
              <div style={{ padding: '12px 14px 0' }}>
                {/* Company name + options menu */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 15,
                        fontWeight: 700,
                        color: 'var(--text)',
                        lineHeight: 1.3,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {companyName}
                    </span>
                    {clientName && clientName !== companyName && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11,
                          color: 'var(--muted)',
                          marginTop: 1,
                          fontStyle: 'italic',
                        }}
                      >
                        for {clientName}
                      </span>
                    )}
                    {/* Namespace badge — prominent, directly under company name */}
                    <span
                      title={entry.namespace}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        marginTop: 5,
                        background: `${primaryColor}14`,
                        border: `1px solid ${primaryColor}30`,
                        borderRadius: 6,
                        padding: '2px 8px 2px 6px',
                        fontSize: 11,
                        fontWeight: 700,
                        color: primaryColor,
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        letterSpacing: '0.02em',
                      }}
                    >
                      <FolderOpen size={10} style={{ flexShrink: 0 }} />
                      {entry.namespace}
                    </span>
                  </div>
                  <button
                    ref={(el) => {
                      menuBtnRefs.current[entry.id] = el;
                    }}
                    className="btn btn-sm"
                    title="Options"
                    onClick={(e) => {
                      e.stopPropagation();
                      openMenu(entry);
                    }}
                    style={{
                      padding: '2px 4px',
                      border: 'none',
                      lineHeight: 1,
                      flexShrink: 0,
                      marginTop: 1,
                      opacity: isHovered || menuEntry?.id === entry.id ? 1 : 0,
                      pointerEvents: isHovered || menuEntry?.id === entry.id ? 'auto' : 'none',
                      transition: 'opacity 0.15s',
                    }}
                  >
                    <Icon icon={MoreHorizontal} size="sm" />
                  </button>
                </div>

                {/* Theme badge + timestamp row */}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10, flexWrap: 'wrap' as const }}
                >
                  {!isPro && (
                    <span
                      style={{
                        display: 'inline-block',
                        background: `${accent}1a`,
                        color: accent,
                        border: `1px solid ${accent}33`,
                        borderRadius: 5,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 7px',
                        letterSpacing: '0.06em',
                        lineHeight: 1.5,
                        textTransform: 'uppercase' as const,
                      }}
                    >
                      {pluginName}
                    </span>
                  )}
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      fontSize: 11,
                      color: 'var(--muted)',
                      marginLeft: 'auto',
                    }}
                  >
                    <Clock size={10} />
                    {formatDate(entry.savedAt)}
                  </span>
                </div>

                {/* Stats row — section count + color dots only */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 0',
                    borderTop: '1px solid var(--border)',
                    marginBottom: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                    <Layers size={11} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {sectionCount} section{sectionCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                    {sections.slice(0, 8).map((s, i) => (
                      <div
                        key={i}
                        title={s.sectionType ?? 'section'}
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: getSectionColor(s.sectionType ?? '', primaryColor),
                          flexShrink: 0,
                        }}
                      />
                    ))}
                    {sections.length > 8 && (
                      <span style={{ fontSize: 9, color: 'var(--muted)', marginLeft: 1 }}>+{sections.length - 8}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Footer: action buttons ── */}
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  padding: '10px 14px 12px',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <button
                  onClick={() => handleEdit(entry)}
                  title="Edit in editor"
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '7px 0',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--panel-soft)';
                    e.currentTarget.style.borderColor = 'var(--primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = 'var(--border)';
                  }}
                >
                  <Pencil size={11} /> Edit
                </button>
                <button
                  onClick={() => setPreviewEntry(entry)}
                  title="Preview microsite"
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '7px 0',
                    borderRadius: 8,
                    border: 'none',
                    background: primaryColor,
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'opacity 0.15s, filter 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.filter = 'brightness(1.12)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.filter = 'brightness(1)';
                  }}
                >
                  <Eye size={11} /> View
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
