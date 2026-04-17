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
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
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
            fontWeight: 600,
            margin: "0 0 4px",
            color: "var(--color-text)",
          }}
        >
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
        .ms-history-card {
          border: 1px solid var(--color-border);
          border-radius: 10px;
          background: var(--color-surface);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          transition: box-shadow 0.2s, border-color 0.2s;
        }
        .ms-history-card:hover {
          border-color: var(--color-primary);
          box-shadow: 0 4px 20px rgba(0,0,0,0.12);
        }
      `}</style>

      <div
        style={{
          padding: "4px 0 8px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
          {loadingServer ? (
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  border: "1.5px solid var(--color-border)",
                  borderTopColor: "var(--color-primary)",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              Loading history…
            </span>
          ) : (
            `${combined.length} microsite${combined.length !== 1 ? "s" : ""} — all namespaces`
          )}
        </span>
      </div>

      <div className="ms-history-grid">
        {combined.map((entry) => {
          const accent = getPluginAccent(entry.ast.plugin);
          const pluginName = entry.ast.plugin || "default";
          const companyName =
            entry.ast.brand?.companyName || entry.namespace || "Untitled";
          const sectionCount = entry.ast.sections?.length ?? 0;
          const isLocal = entry.source === "local";

          return (
            <div key={entry.id} className="ms-history-card">
              {/* Accent top strip */}
              <div style={{ height: 4, background: accent }} />

              {/* Card body */}
              <div style={{ padding: "14px 16px 12px", flex: 1 }}>
                {/* Badges row */}
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      background: `${accent}18`,
                      color: accent,
                      borderRadius: 100,
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 8px",
                      letterSpacing: "0.05em",
                      textTransform: "uppercase" as const,
                    }}
                  >
                    {pluginName}
                  </span>
                  <span
                    style={{
                      display: "inline-block",
                      background: "var(--color-bg)",
                      color: "var(--color-text-muted)",
                      borderRadius: 100,
                      fontSize: 10,
                      fontWeight: 500,
                      padding: "2px 8px",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    {entry.namespace}
                  </span>
                </div>

                {/* Company name */}
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--color-text)",
                    margin: "0 0 4px",
                    lineHeight: 1.3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {companyName}
                </p>

                {/* Meta row */}
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span
                    style={{ fontSize: 11, color: "var(--color-text-muted)" }}
                  >
                    {formatDate(entry.savedAt)}
                  </span>
                  <span
                    style={{ fontSize: 11, color: "var(--color-text-muted)" }}
                  >
                    ·
                  </span>
                  <span
                    style={{ fontSize: 11, color: "var(--color-text-muted)" }}
                  >
                    {sectionCount} section{sectionCount !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>

              {/* Card footer */}
              <div style={{ padding: "0 12px 12px", display: "flex", gap: 8 }}>
                <button
                  onClick={() => setPreviewEntry(entry)}
                  style={{
                    flex: 1,
                    background: accent,
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "7px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Preview
                </button>
                <button
                  onClick={() => {
                    // Remove from server state immediately (prevents flash-back)
                    setServerEntries(prev => prev.filter(e => e.namespace !== entry.namespace));
                    if (isLocal) {
                      deleteEntry(entry.id); // removes from localStorage + fires server DELETE
                    } else {
                      if (apiKey) deleteMicrositeHistoryFromServer(apiKey, entry.namespace).catch(() => {});
                    }
                  }}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    padding: "7px 10px",
                    fontSize: 12,
                    color: "var(--color-text-muted)",
                    cursor: "pointer",
                  }}
                  title="Remove from history"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
}
