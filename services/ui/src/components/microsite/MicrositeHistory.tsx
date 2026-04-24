"use client";

import { useState, useEffect } from "react";
import { FolderOpen, X } from "lucide-react";
import { Icon } from "@/components/ui/Icon";
import { Microsite } from "./Microsite";
import { MicrositeEditor } from "./editor/MicrositeEditor";
import {
  useMicrositeHistory,
  type MicrositeHistoryEntry,
} from "@/lib/useMicrositeHistory";
import { fetchAllMicrositeHistory, deleteMicrositeHistoryFromServer } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
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
  // All local history (no namespace filter)
  const { history: localHistory, deleteEntry, addEntry, updateEntry, refresh } = useMicrositeHistory(undefined, apiKey ?? undefined);
  const [serverEntries, setServerEntries] = useState<CombinedEntry[]>([]);
  const [loadingServer, setLoadingServer] = useState(false);
  const [previewEntry, setPreviewEntry] = useState<CombinedEntry | null>(null);
  const [editingEntry, setEditingEntry] = useState<CombinedEntry | null>(null);

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

    return [...localMapped, ...serverOnly].sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
    );
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
        {combined.map((entry) => {
          const accent = getPluginAccent(entry.ast.plugin);
          const pluginName = entry.ast.plugin || "default";
          const companyName = entry.ast.brand?.companyName || entry.namespace || "Untitled";
          const sectionCount = entry.ast.sections?.length ?? 0;

          return (
            <div key={entry.id} className="proposal-card" style={{ gap: 10 }}>
              {/* Header: name */}
              <div className="proposal-card-header">
                <span className="proposal-card-name">{companyName}</span>
              </div>

              {/* Theme badge + date · sections */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{
                  display: 'inline-block', background: `${accent}18`, color: accent,
                  borderRadius: 100, fontSize: 10, fontWeight: 600,
                  padding: '2px 8px', letterSpacing: '0.06em', lineHeight: 1.4,
                  textTransform: 'uppercase' as const, alignSelf: 'flex-start',
                }}>
                  {pluginName}
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {formatDate(entry.savedAt)} · {sectionCount} section{sectionCount !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Footer: namespace + preview */}
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

      <style>{`@keyframes ms-spin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
}
