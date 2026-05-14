"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Globe, MoreHorizontal, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/Icon";
import { Microsite } from "./Microsite";
import { MicrositeEditorPro } from "./editor/MicrositeEditorPro";
import {
  useMicrositeHistory,
  type MicrositeHistoryEntry,
} from "@/lib/useMicrositeHistory";
import { useAuth } from "@/lib/auth-context";
import { useNamespace } from "@/lib/namespace-context";
import { getPlugin } from "@/lib/presentation/pluginRegistry";

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
  const { history: allEntries, loading, deleteEntry, addEntry, updateEntry, refresh } = useMicrositeHistory(undefined, apiKey ?? undefined);

  const [previewEntry, setPreviewEntry] = useState<MicrositeHistoryEntry | null>(null);
  const [editingEntry, setEditingEntry] = useState<MicrositeHistoryEntry | null>(null);

  // Delete state
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [menuEntry, setMenuEntry] = useState<MicrositeHistoryEntry | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [confirmEntry, setConfirmEntry] = useState<MicrositeHistoryEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const menuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const entries = allEntries.filter(
    (e) => namespaces.length === 0 || namespaces.includes(e.namespace),
  ).sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

  useEffect(() => { onCountChange?.(entries.length); }, [entries.length, onCountChange]);

  const openMenu = useCallback((entry: MicrositeHistoryEntry) => {
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
    if (!confirmEntry) return;
    setDeleting(true);
    try {
      deleteEntry(confirmEntry.id);
    } finally {
      setDeleting(false);
      setConfirmEntry(null);
    }
  };

  if (editingEntry) {
    return (
      <MicrositeEditorPro
        ast={editingEntry.ast}
        namespace={editingEntry.namespace}
        proposalId={editingEntry.id}
        onClose={() => setEditingEntry(null)}
        onSaved={(updatedAst) => {
          const saved = updateEntry(editingEntry.id, updatedAst);
          refresh();
          setPreviewEntry({ id: saved.id, savedAt: saved.savedAt, namespace: saved.namespace, ast: updatedAst });
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

  if (!loading && entries.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 240, padding: '40px 20px' }}>
        <div style={{ maxWidth: 320, textAlign: 'center' }}>
          <Globe size={40} strokeWidth={1.5} style={{ color: 'var(--subtle)', marginBottom: 14 }} />
          <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', margin: 0 }}>
            No microsites yet
          </p>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6, marginBottom: 0 }}>
            Publish your first microsite.
          </p>
          <button
            onClick={() => onGenerateNew?.()}
            className="btn btn-primary btn-sm"
            style={{ marginTop: 20, width: 'auto' }}
          >
            New Microsite
          </button>
        </div>
      </div>
    );
  }

  // Version numbers scoped to namespace+client
  const entriesWithVersion = (() => {
    const groupCount = new Map<string, number>();
    for (const e of entries) {
      const key = `${e.namespace}::${e.ast.brand?.companyName || 'Untitled'}`;
      groupCount.set(key, (groupCount.get(key) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    return entries.map((e) => {
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
      {loading && (
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
        {entriesWithVersion.map(({ entry, companyName, version }) => {
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
