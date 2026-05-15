"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Globe, X, MoreHorizontal, Trash2, Edit2 } from "lucide-react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Microsite } from "./Microsite";
import {
  useMicrositeHistory,
  type MicrositeHistoryEntry,
} from "@/lib/useMicrositeHistory";
import { fetchAllMicrositeHistory, deleteMicrositeHistoryFromServer, saveMicrositeAst } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useNamespace } from "@/lib/namespace-context";
import { getPlugin } from "@/lib/presentation/pluginRegistry";
import type { LayoutAST } from "@/types/presentation";

interface CombinedEntry {
  id: string;
  savedAt: string;
  namespace: string;
  ast: LayoutAST;
  source: "local" | "server";
}

function getPluginAccent(plugin: string): string {
  try {
    return getPlugin(plugin).tokens.accent;
  } catch {
    return "#6366f1";
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function MicrositeHistory({ onCountChange, onGenerateNew }: { onCountChange?: (count: number) => void; onGenerateNew?: () => void }) {
  const { apiKey } = useAuth();
  const { namespaces } = useNamespace();
  const router = useRouter();
  const { history: localHistory, deleteEntry, addEntry, updateEntry, refresh } = useMicrositeHistory(undefined, apiKey ?? undefined);
  const [serverEntries, setServerEntries] = useState<CombinedEntry[]>([]);
  const [loadingServer, setLoadingServer] = useState(false);
  const [previewEntry, setPreviewEntry] = useState<CombinedEntry | null>(null);

  // Delete state
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
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) && btn && !btn.contains(e.target as Node)) setMenuEntry(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuEntry]);

  const handleDeleteConfirmed = async () => {
    if (!confirmEntry || !apiKey) return;
    setDeleting(true);
    try {
      if (confirmEntry.source === "local") {
        deleteEntry(confirmEntry.id);
      } else {
        await deleteMicrositeHistoryFromServer(apiKey, confirmEntry.namespace);
        setServerEntries(prev => prev.filter(e => e.id !== confirmEntry.id));
      }
      refresh();
    } catch { /* ignore */ } finally {
      setDeleting(false);
      setConfirmEntry(null);
    }
  };

  const handleEdit = useCallback((entry: CombinedEntry) => {
    const pid = entry.ast.proposalId ?? entry.id;
    const ns = entry.namespace;
    const dest = entry.ast.generationMode === 'classic'
      ? `/microsite-editor/${encodeURIComponent(ns)}/${encodeURIComponent(pid)}`
      : `/microsite-editor-pro/${encodeURIComponent(ns)}/${encodeURIComponent(pid)}`;
    // Ensure server has the latest AST before navigating; navigate regardless of save outcome.
    const go = () => router.push(dest);
    if (apiKey) {
      saveMicrositeAst(apiKey, ns, pid, entry.ast).then(go).catch(go);
    } else {
      go();
    }
  }, [router, apiKey]);

  useEffect(() => {
    if (!apiKey) return;
    setLoadingServer(true);
    fetchAllMicrositeHistory(apiKey)
      .then((items) => {
        setServerEntries(
          items
            .filter(
              (item) =>
                item.ast &&
                (item.ast as { sections?: unknown[] }).sections?.length,
            )
            .map((item) => ({
              id: `server::${item.namespace}`,
              savedAt: item.savedAt,
              namespace: item.namespace,
              ast: item.ast as LayoutAST,
              source: "server" as const,
            })),
        );
      })
      .catch(() => {})
      .finally(() => setLoadingServer(false));
  }, [apiKey]);

  const combined: CombinedEntry[] = (() => {
    const localMapped: CombinedEntry[] = localHistory
      .filter((e) => e.ast && (e.ast as { sections?: unknown[] }).sections?.length)
      .map((e) => ({
        id: e.id,
        savedAt: e.savedAt,
        namespace: e.namespace,
        ast: e.ast,
        source: "local" as const,
      }));

    const localNamespaces = new Set(localMapped.map((e) => e.namespace));
    const serverOnly = serverEntries.filter(
      (e) => !localNamespaces.has(e.namespace),
    );

    return [...localMapped, ...serverOnly]
      .filter(e => namespaces.length === 0 || namespaces.includes(e.namespace))
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  })();

  useEffect(() => { onCountChange?.(combined.length); }, [combined.length, onCountChange]);

  if (previewEntry) {
    return (
      <Microsite
        ast={previewEntry.ast}
        onBack={() => { refresh(); setPreviewEntry(null); }}
        onEdit={() => handleEdit(previewEntry)}
        namespace={previewEntry.namespace}
        proposalId={previewEntry.id}
      />
    );
  }

  if (!loadingServer && combined.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, padding: '40px 20px' }}>
        <div style={{ maxWidth: 340, textAlign: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--panel-soft)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Globe size={24} strokeWidth={1.5} style={{ color: 'var(--muted)' }} />
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px' }}>
            No microsites yet
          </p>
          <p style={{ fontSize: 14, color: 'var(--muted)', margin: '0 0 20px', lineHeight: 1.5 }}>
            Generate your first microsite to see it here.
          </p>
          <button
            onClick={() => onGenerateNew?.()}
            className="btn btn-primary btn-sm"
            style={{ width: 'auto' }}
          >
            + Generate Microsite
          </button>
        </div>
      </div>
    );
  }

  const combinedWithVersion = (() => {
    const groupCount = new Map<string, number>();
    for (const e of combined) {
      const clientName = e.ast.brand?.companyName || 'Untitled';
      const key = `${e.namespace}::${clientName}`;
      groupCount.set(key, (groupCount.get(key) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    return combined.map(e => {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          <span style={{
            display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
            border: '1.5px solid var(--border)', borderTopColor: 'var(--primary)',
            animation: 'ms-spin 0.8s linear infinite',
          }} />
          Loading history…
        </div>
      )}

      <div className="proposal-cards-grid" style={{ padding: 0, maxWidth: 'none', margin: 0 }}>
        {combinedWithVersion.map(({ entry, companyName, version }) => {
          const accent = getPluginAccent(entry.ast.plugin);
          const pluginName = entry.ast.plugin || "default";
          const isPro = entry.ast.generationMode !== 'classic';
          const isHovered = hoveredCard === entry.id;
          const primaryColor = entry.ast.brand?.primaryColor || '#4f46e5';
          const secondaryColor = entry.ast.brand?.secondaryColor || '#7c3aed';

          return (
            <div
              key={entry.id}
              className="proposal-card"
              style={{ gap: 0, position: 'relative', padding: 0, overflow: 'hidden' }}
              onMouseEnter={() => setHoveredCard(entry.id)}
              onMouseLeave={() => setHoveredCard(null)}
            >
              {/* Brand color strip */}
              <div style={{
                height: 36,
                background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
                flexShrink: 0,
              }} />

              {/* Card body */}
              <div style={{ padding: '10px 12px 0', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Mode badge + version row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      background: isPro ? 'rgba(59,130,246,0.12)' : 'rgba(100,116,139,0.12)',
                      color: isPro ? '#3b82f6' : '#94a3b8',
                      borderRadius: 100, fontSize: 10, fontWeight: 700,
                      padding: '2px 8px', letterSpacing: '0.04em', lineHeight: 1.4,
                    }}>
                      {isPro ? '⚡' : '🎨'} {isPro ? 'Pro' : 'Classic'}
                    </span>
                    {!isPro && (
                      <span style={{
                        display: 'inline-block', background: `${accent}18`, color: accent,
                        borderRadius: 100, fontSize: 10, fontWeight: 600,
                        padding: '2px 8px', letterSpacing: '0.06em', lineHeight: 1.4,
                        textTransform: 'uppercase' as const,
                      }}>
                        {pluginName}
                      </span>
                    )}
                    <span style={{
                      marginLeft: 'auto', flexShrink: 0,
                      display: 'inline-block', background: 'var(--primary-soft)', color: 'var(--primary)',
                      borderRadius: 100, fontSize: 10, fontWeight: 600,
                      padding: '2px 8px', letterSpacing: '0.06em', lineHeight: 1.4,
                    }}>
                      v{version}
                    </span>
                  </div>

                  {/* Company name */}
                  <span className="proposal-card-name" style={{ display: 'block', marginBottom: 2 }}>
                    {companyName}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>
                    {formatDate(entry.savedAt)}
                  </span>
                </div>

                {/* Options menu button */}
                <button
                  ref={el => { menuBtnRefs.current[entry.id] = el; }}
                  className="btn btn-sm"
                  title="Options"
                  onClick={e => { e.stopPropagation(); openMenu(entry); }}
                  style={{
                    padding: '1px 5px', border: 'none', lineHeight: 1, flexShrink: 0,
                    opacity: isHovered || menuEntry?.id === entry.id ? 1 : 0,
                    pointerEvents: isHovered || menuEntry?.id === entry.id ? 'auto' : 'none',
                    transition: 'opacity 0.15s',
                  }}
                >
                  <Icon icon={MoreHorizontal} size="sm" />
                </button>
              </div>

              {/* Footer */}
              <div className="proposal-card-footer" style={{ padding: '8px 12px 10px', marginTop: 'auto' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1 }}>
                  <span style={{ color: 'var(--text)', fontWeight: 500 }}>{entry.namespace}</span>
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="chat-v2-clear-btn"
                    onClick={() => handleEdit(entry)}
                    title="Edit in editor"
                  >
                    Edit
                  </button>
                  <button
                    className="chat-v2-clear-btn"
                    onClick={() => setPreviewEntry(entry)}
                  >
                    View
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Overflow dropdown */}
      {menuEntry && createPortal(
        <div
          ref={dropdownRef}
          className="card"
          style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, minWidth: 120, padding: '4px 0', zIndex: 99999 }}
        >
          <button
            className="btn btn-sm"
            style={{ width: '100%', textAlign: 'left', borderRadius: 0, border: 'none', justifyContent: 'flex-start', padding: '8px 14px', fontSize: 14, color: 'var(--danger)', gap: 8 }}
            onMouseDown={e => e.preventDefault()}
            onClick={() => { const e = menuEntry; setMenuEntry(null); setConfirmEntry(e); }}
          >
            <Icon icon={Trash2} size="sm" /><span>Delete</span>
          </button>
        </div>,
        document.body,
      )}

      {/* Confirm delete dialog */}
      {confirmEntry && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onMouseDown={e => { if (e.target === e.currentTarget && !deleting) setConfirmEntry(null); }}
        >
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px 0' }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 16px' }}>Delete microsite</p>
            </div>
            <div style={{ height: 1, background: 'var(--border)' }} />
            <div style={{ padding: 24 }}>
              <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 20, lineHeight: 1.5 }}>
                Delete the microsite for <strong>"{confirmEntry.ast.brand?.companyName || confirmEntry.namespace}"</strong>?
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setConfirmEntry(null)} disabled={deleting} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-soft)', color: 'var(--text)', fontSize: 14, cursor: deleting ? 'not-allowed' : 'pointer' }}>Cancel</button>
                <button onClick={handleDeleteConfirmed} disabled={deleting} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--danger)', color: '#fff', fontSize: 14, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.7 : 1 }}>{deleting ? 'Deleting…' : 'Delete'}</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <style>{`@keyframes ms-spin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
}
