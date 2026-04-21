'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  fetchProposals,
  fetchPresentations,
  fetchKnowledgeFiles,
  type IngestionFile,
} from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { useNamespacePanelStore } from '@/lib/namespace-panel-store';
import { useExecutionStore } from '@/core/execution/execution-store';

// ── Helpers — same as VersionHistory ─────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const isCurrentYear = d.getFullYear() === new Date().getFullYear();
  const monthDay = d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return isCurrentYear
    ? `${monthDay}, ${time}`
    : `${monthDay} ${d.getFullYear()}, ${time}`;
}

// ── Collapsible section — mirrors sidebar NamespacesSection ──────

interface SectionProps {
  label: string;
  loading: boolean;
  children: React.ReactNode;
}

function Section({ label, loading, children }: SectionProps) {
  const [open, setOpen] = useState(true);
  const [hovered, setHovered] = useState(false);

  return (
    <div className="sidebar-group">
      <div
        className="sidebar-link"
        role="button"
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: 'pointer' }}
      >
        <span className="sidebar-label" style={{ flex: 1, opacity: 0.45 }}>{label}</span>
        <Icon
          icon={ChevronDown}
          size="sm"
          style={{
            flexShrink: 0,
            opacity: hovered ? 0.5 : 0,
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'opacity 0.15s, transform 0.15s ease',
          }}
        />
      </div>

      {open && (
        loading ? (
          <div style={{ padding: '2px 8px 4px' }}>
            <span className="sidebar-label" style={{ opacity: 0.45, fontSize: 13 }}>Loading…</span>
          </div>
        ) : children
      )}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────

interface Props {
  namespace: string;
}

export function NamespacePanel({ namespace }: Props) {
  const { apiKey } = useAuth();
  const router = useRouter();

  // Read from persisted store — survives page reloads
  const panelData = useNamespacePanelStore(s => s.byNamespace[namespace]);
  const setProposals = useNamespacePanelStore(s => s.setProposals);
  const setMicrosites = useNamespacePanelStore(s => s.setMicrosites);

  // Sort newest-first for display
  const proposals = [...(panelData?.proposals ?? [])]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const microsites = [...(panelData?.microsites ?? [])]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Ingested files stay local — no cross-session caching needed
  const [files, setFiles] = useState<IngestionFile[]>([]);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [loadingMicrosites, setLoadingMicrosites] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // ── Initial load — fetch and populate the persisted store ────────

  useEffect(() => {
    if (!namespace || !apiKey) return;
    // Only show spinner if we have no cached data yet
    if (!panelData?.proposals) setLoadingProposals(true);
    fetchProposals(apiKey)
      .then(all => {
        // Filter to this namespace using the "namespace::file.md" prefix (same as VersionHistory source)
        const filtered = all.filter(p => p.fileName.startsWith(`${namespace}::`));
        setProposals(namespace, filtered);
      })
      .catch(() => {})
      .finally(() => setLoadingProposals(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, apiKey]);

  useEffect(() => {
    if (!namespace || !apiKey) return;
    if (!panelData?.microsites) setLoadingMicrosites(true);
    fetchPresentations(apiKey, namespace)
      .then(ms => setMicrosites(namespace, ms))
      .catch(() => {})
      .finally(() => setLoadingMicrosites(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, apiKey]);

  useEffect(() => {
    if (!namespace || !apiKey) return;
    setLoadingFiles(true);
    fetchKnowledgeFiles(apiKey, namespace)
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setLoadingFiles(false));
  }, [namespace, apiKey]);

  // ── Reactive update — re-fetch when an execution completes ───────
  // Subscribes to the ExecutionStore. When a proposal or microsite execution
  // transitions to 'completed', re-fetch the relevant list and push it into
  // the persisted store — no polling, no timers.

  const allExecutions = useExecutionStore(s => s.executions);
  const seenCompletedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const justCompleted = Object.values(allExecutions).filter(
      e =>
        (e.type === 'proposal' || e.type === 'microsite') &&
        e.status === 'completed' &&
        !seenCompletedRef.current.has(e.id),
    );

    // Advance the seen-set so future renders don't re-trigger
    Object.values(allExecutions)
      .filter(e => e.status === 'completed' || e.status === 'failed')
      .forEach(e => seenCompletedRef.current.add(e.id));

    if (!justCompleted.length || !namespace || !apiKey) return;

    if (justCompleted.some(e => e.type === 'proposal')) {
      fetchProposals(apiKey)
        .then(all => {
          const filtered = all.filter(p => p.fileName.startsWith(`${namespace}::`));
          setProposals(namespace, filtered);
        })
        .catch(() => {});
    }

    if (justCompleted.some(e => e.type === 'microsite')) {
      fetchPresentations(apiKey, namespace)
        .then(ms => setMicrosites(namespace, ms))
        .catch(() => {});
    }
  }, [allExecutions, namespace, apiKey, setProposals, setMicrosites]);

  if (!namespace) return null;

  return (
    <aside className="chat-ctx-panel">
      <div style={{ padding: '4px 10px' }}>

        {/* ── Proposals ── */}
        <Section label="Proposals" loading={loadingProposals}>
          {proposals.length === 0 ? (
            <div style={{ padding: '2px 8px 4px' }}>
              <span className="sidebar-label" style={{ opacity: 0.45, fontSize: 13 }}>No proposals yet</span>
            </div>
          ) : (
            proposals.map(p => {
              const [ns, ...fileParts] = p.fileName.split('::');
              const file = fileParts.join('::') || ns;
              const href = fileParts.length
                ? `/proposal?artifact=${encodeURIComponent(file)}&namespace=${encodeURIComponent(ns)}&from=chat`
                : `/proposal?artifact=${encodeURIComponent(file)}&from=chat`;
              return (
              <div
                key={p.fileName}
                className="sidebar-link"
                onClick={() => router.push(href)}
                style={{ height: 'auto', alignItems: 'flex-start', flexDirection: 'column', padding: '6px 8px', gap: 2, cursor: 'pointer' }}
              >
                {/* Line 1: name + version badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                  <span className="sidebar-label" style={{ color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.client}
                  </span>
                  {p.version != null && (
                    <span className="badge" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', flexShrink: 0 }}>
                      v{p.version}
                    </span>
                  )}
                </div>
                {/* Line 2: date · size */}
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 11, color: 'var(--muted)' }}>
                  <span>{formatDate(p.createdAt)}</span>
                  <span>{formatBytes(p.sizeBytes)}</span>
                </div>
              </div>
              );
            })
          )}
        </Section>

        {/* ── Microsites ── */}
        <Section label="Microsites" loading={loadingMicrosites}>
          {microsites.length === 0 ? (
            <div style={{ padding: '2px 8px 4px' }}>
              <span className="sidebar-label" style={{ opacity: 0.45, fontSize: 13 }}>No microsites yet</span>
            </div>
          ) : (
            microsites.map(m => (
              <div
                key={m.proposalId}
                className="sidebar-link"
                style={{ height: 'auto', alignItems: 'flex-start', flexDirection: 'column', padding: '6px 8px', gap: 2, cursor: 'default' }}
              >
                {/* Line 1: name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                  <span className="sidebar-label" style={{ color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.proposalId}
                  </span>
                </div>
                {/* Line 2: date */}
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {formatDate(m.createdAt)}
                </div>
              </div>
            ))
          )}
        </Section>

        {/* ── Ingested Files ── */}
        <Section label="Ingested Files" loading={loadingFiles}>
          {files.length === 0 ? (
            <div style={{ padding: '2px 8px 4px' }}>
              <span className="sidebar-label" style={{ opacity: 0.45, fontSize: 13 }}>No files yet</span>
            </div>
          ) : (
            files.map(f => (
              <div key={f.fileName} className="sidebar-link" style={{ cursor: 'default' }}>
                <span className="sidebar-label">{f.fileName}</span>
              </div>
            ))
          )}
        </Section>

      </div>
    </aside>
  );
}
