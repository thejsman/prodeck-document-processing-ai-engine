"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FolderOpen, X, MoreHorizontal, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/Icon";
import { Microsite } from "./Microsite";
import { MicrositeEditor } from "./editor/MicrositeEditor";
import {
  useMicrositeHistory,
  type MicrositeHistoryEntry,
} from "@/lib/useMicrositeHistory";
import { fetchAllMicrositeHistory, deleteMicrositeHistoryFromServer } from "@/lib/api";
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

export function MicrositeHistory({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const { apiKey } = useAuth();
  const { namespaces } = useNamespace();
  // All local history (no namespace filter)
  const { history: localHistory, deleteEntry, addEntry, updateEntry, refresh } = useMicrositeHistory(undefined, apiKey ?? undefined);
  const [serverEntries, setServerEntries] = useState<CombinedEntry[]>([]);
  const [loadingServer, setLoadingServer] = useState(false);
  const [previewEntry, setPreviewEntry] = useState<CombinedEntry | null>(null);
  const [editingEntry, setEditingEntry] = useState<CombinedEntry | null>(null);

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

  // Fetch server-side history on mount
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

  // Merge local + server, deduplicate by namespace (prefer local/newer)
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

    // Add server entries that aren't already covered by a local entry
    const localNamespaces = new Set(localMapped.map((e) => e.namespace));
    const serverOnly = serverEntries.filter(
      (e) => !localNamespaces.has(e.namespace),
    );

    return [...localMapped, ...serverOnly]
      .filter(e => namespaces.length === 0 || namespaces.includes(e.namespace))
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  })();

  // Report combined count to parent whenever it changes
  useEffect(() => { onCountChange?.(combined.length); }, [combined.length, onCountChange]);

  // Editor mode — opened from preview or history card
  if (editingEntry) {
    return (
      <MicrositeEditor
        ast={editingEntry.ast}
        namespace={editingEntry.namespace}
        proposalId={editingEntry.id}
        onClose={() => setEditingEntry(null)}
        onExport={(editedAst) => {
          // Update in-place for local entries; create new local entry for server-only entries
          const saved = editingEntry.source === 'local'
            ? updateEntry(editingEntry.id, editedAst)
            : addEntry(editedAst, editingEntry.namespace);
          refresh();
          setPreviewEntry({
            id: saved.id,
            savedAt: saved.savedAt,
            namespace: saved.namespace,
            ast: editedAst,
            source: 'local',
          });
          setEditingEntry(null);
        }}
      />
    );
  }

  if (previewEntry) {
    return (
      <Microsite
        ast={previewEntry.ast}
        onBack={() => { refresh(); setPreviewEntry(null); }}
        onEdit={() => setEditingEntry(previewEntry)}
        namespace={previewEntry.namespace}
        proposalId={previewEntry.id}
      />
    );
  }

  if (!loadingServer && combined.length === 0) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "56px 24px",
          color: "var(--color-text-muted)",
        }}
      >
        <div style={{ marginBottom: 12, opacity: 0.35 }}><Icon icon={FolderOpen} size="xl" /></div>
        <p
          style={{
            fontSize: 14,
            fontWeight: 400,
            margin: "0 0 4px",
            color: "var(--color-text)",
          }}
        >
          No microsites generated yet
        </p>
        <p style={{ fontSize: 12, margin: 0 }}>
          Use Generate Microsite to create your first one
        </p>
      </div>
    );
  }

  // Version numbers scoped to namespace+client — matches the namespace panel's per-namespace grouping.
  // Newest = highest version; key = "namespace::clientName" so "mergecompany" in two namespaces version independently.
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
          const isHovered = hoveredCard === entry.id;

          return (
            <div
              key={entry.id}
              className="proposal-card"
              style={{ gap: 10, position: 'relative' }}
              onMouseEnter={() => setHoveredCard(entry.id)}
              onMouseLeave={() => setHoveredCard(null)}
            >
              <button
                ref={el => { menuBtnRefs.current[entry.id] = el; }}
                className="btn btn-sm"
                title="Options"
                onClick={e => { e.stopPropagation(); openMenu(entry); }}
                style={{ position: 'absolute', top: 8, right: 8, padding: '1px 5px', border: 'none', lineHeight: 1, opacity: isHovered || menuEntry?.id === entry.id ? 1 : 0, pointerEvents: isHovered || menuEntry?.id === entry.id ? 'auto' : 'none', transition: 'opacity 0.15s', zIndex: 1 }}
              >
                <Icon icon={MoreHorizontal} size="sm" />
              </button>

              <div className="proposal-card-header">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span className="proposal-card-name">{companyName}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>
                    {formatDate(entry.savedAt)}
                  </span>
                  <span style={{
                    display: 'inline-block', background: `${accent}18`, color: accent,
                    borderRadius: 100, fontSize: 10, fontWeight: 600,
                    padding: '2px 8px', letterSpacing: '0.06em', lineHeight: 1.4,
                    textTransform: 'uppercase' as const, marginTop: 4,
                  }}>
                    {pluginName}
                  </span>
                </div>
                <span style={{ flexShrink: 0, alignSelf: 'flex-start', display: 'inline-block', background: 'var(--primary-soft)', color: 'var(--primary)', borderRadius: 100, fontSize: 10, fontWeight: 600, padding: '2px 8px', letterSpacing: '0.06em', lineHeight: 1.4 }}>
                  v{version}
                </span>
              </div>

              <div className="proposal-card-footer">
                <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1 }}>
                  Namespace: <span style={{ color: 'var(--text)', fontWeight: 500 }}>{entry.namespace}</span>
                </span>
                <button
                  className="chat-v2-clear-btn"
                  onClick={() => setPreviewEntry(entry)}
                >
                  View
                </button>
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
