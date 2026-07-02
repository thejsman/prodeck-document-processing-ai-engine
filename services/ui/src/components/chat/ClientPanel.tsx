'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Loader2, MoreHorizontal, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  fetchProposals,
  fetchAllMicrositeHistory,
  fetchKnowledgeFiles,
  deleteKnowledgeFile,
  openKnowledgeFile,
  deleteProposal,
  deleteMicrositeHistoryFromServer,
  type IngestionFile,
  type MicrositeHistoryServerEntry,
  type ProposalFile,
} from '@/lib/api';
import type { LayoutAST } from '@/types/presentation';
import { Icon } from '@/components/ui/Icon';
import { useNamespacePanelStore } from '@/lib/namespace-panel-store';
import { useExecutionStore } from '@/core/execution/execution-store';
import { MemorySection } from './MemorySection';
import { BriefSidePanel } from './BriefSidePanel';
import type { CollectionStatus } from '@/lib/use-collection-status';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'brief' | 'artifacts' | 'memory';

const TABS: { id: Tab; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'memory', label: 'Memory' },
];

interface Props {
  namespace: string;
  collectionStatus?: CollectionStatus | null;
  onAskField?: (question: string) => void;
  onMicrositeClick?: (info: { entryId: string; namespace: string; proposalId: string; displayName: string }) => void;
  fileRefreshTick?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const newestFirst = (files: IngestionFile[]) =>
  [...files].sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

function parseMicrositeLabel(proposalId: string): string {
  const raw = proposalId.includes('::') ? proposalId.split('::').slice(1).join('::') : proposalId;
  const withoutExt = raw.replace(/\.[^.]+$/, '');
  const vMatch = withoutExt.match(/_v(\d+)$/);
  const name = vMatch ? withoutExt.slice(0, -vMatch[0].length) : withoutExt;
  return name;
}

function statusBadgeClass(status: string | null) {
  switch (status) {
    case 'approved':
      return 'badge--approved';
    case 'finalized':
      return 'badge--finalized';
    case 'under_review':
      return 'badge--under-review';
    case 'draft':
      return 'badge--draft';
    default:
      return null;
  }
}

function statusLabel(status: string | null) {
  if (!status) return null;
  return status.replace('_', ' ').toUpperCase();
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyRow({ label }: { label: string }) {
  return <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{label}</div>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ClientPanel({ namespace, collectionStatus, onAskField, onMicrositeClick, fileRefreshTick }: Props) {
  const { apiKey } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('brief');

  // ── Persisted store (proposals) ───────────────────────────────────
  const panelData = useNamespacePanelStore(
    (s: { byNamespace: Record<string, { proposals: ProposalFile[] }> }) => s.byNamespace[namespace],
  );
  const setProposals = useNamespacePanelStore(
    (s: { setProposals: (ns: string, p: ProposalFile[]) => void }) => s.setProposals,
  );

  // ── Data state ────────────────────────────────────────────────────
  const [micrositeEntries, setMicrositeEntries] = useState<MicrositeHistoryServerEntry[]>([]);
  const [files, setFiles] = useState<IngestionFile[]>([]);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [loadingMicrosites, setLoadingMicrosites] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const proposals = useMemo(
    () =>
      [...(panelData?.proposals ?? [])].sort((a, b) => {
        const vDiff = (b.version ?? -1) - (a.version ?? -1);
        return vDiff !== 0 ? vDiff : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }),
    [panelData?.proposals],
  );

  const micrositesWithMeta = useMemo(
    () =>
      [...micrositeEntries]
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
        .map((entry) => ({
          entry,
          displayName: (entry.ast as LayoutAST)?.brand?.companyName || 'Untitled',
          version: entry.version ?? 1,
        })),
    [micrositeEntries],
  );

  // ── Menu / confirm state ──────────────────────────────────────────
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);
  const [menuFile, setMenuFile] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [confirmFile, setConfirmFile] = useState<string | null>(null);
  const [deletingFile, setDeletingFile] = useState(false);
  const menuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const fileDropdownRef = useRef<HTMLDivElement | null>(null);

  const [hoveredProposal, setHoveredProposal] = useState<string | null>(null);
  const [menuProposal, setMenuProposal] = useState<ProposalFile | null>(null);
  const [proposalMenuPos, setProposalMenuPos] = useState({ top: 0, right: 0 });
  const [confirmProposal, setConfirmProposal] = useState<ProposalFile | null>(null);
  const [deletingProposal, setDeletingProposal] = useState(false);
  const proposalMenuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const proposalDropdownRef = useRef<HTMLDivElement | null>(null);

  const [hoveredMicrosite, setHoveredMicrosite] = useState<string | null>(null);
  const [menuMicrosite, setMenuMicrosite] = useState<{ id: string; proposalId: string } | null>(null);
  const [micrositeMenuPos, setMicrositeMenuPos] = useState({ top: 0, right: 0 });
  const [confirmMicrosite, setConfirmMicrosite] = useState<{
    id: string;
    proposalId: string;
    displayName: string;
  } | null>(null);
  const [deletingMicrosite, setDeletingMicrosite] = useState(false);
  const micrositeMenuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const micrositeDropdownRef = useRef<HTMLDivElement | null>(null);

  // ── Dropdown close-on-outside-click ──────────────────────────────
  useEffect(() => {
    if (!menuFile) return;
    const handler = (e: MouseEvent) => {
      const btn = menuBtnRefs.current[menuFile];
      if (
        fileDropdownRef.current &&
        !fileDropdownRef.current.contains(e.target as Node) &&
        btn &&
        !btn.contains(e.target as Node)
      )
        setMenuFile(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuFile]);

  useEffect(() => {
    if (!menuProposal) return;
    const handler = (e: MouseEvent) => {
      const btn = proposalMenuBtnRefs.current[menuProposal.fileName];
      if (
        proposalDropdownRef.current &&
        !proposalDropdownRef.current.contains(e.target as Node) &&
        btn &&
        !btn.contains(e.target as Node)
      )
        setMenuProposal(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuProposal]);

  useEffect(() => {
    if (!menuMicrosite) return;
    const handler = (e: MouseEvent) => {
      const btn = micrositeMenuBtnRefs.current[menuMicrosite.id];
      if (
        micrositeDropdownRef.current &&
        !micrositeDropdownRef.current.contains(e.target as Node) &&
        btn &&
        !btn.contains(e.target as Node)
      )
        setMenuMicrosite(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuMicrosite]);

  // ── Delete handlers ───────────────────────────────────────────────
  const handleDeleteFileConfirmed = async () => {
    if (!confirmFile) return;
    setDeletingFile(true);
    try {
      await deleteKnowledgeFile(apiKey, namespace, confirmFile);
      setFiles((prev) => prev.filter((f) => f.fileName !== confirmFile));
    } catch {
      /* ignore */
    } finally {
      setDeletingFile(false);
      setConfirmFile(null);
    }
  };

  const handleViewFile = useCallback(
    async (fileName: string) => {
      const downloadName = files.find((f) => f.fileName === fileName)?.originalName ?? fileName;
      await openKnowledgeFile(apiKey, namespace, fileName, downloadName);
    },
    [apiKey, namespace, files],
  );

  const handleDeleteProposalConfirmed = async () => {
    if (!confirmProposal) return;
    const p = confirmProposal;
    const parts = p.fileName.split('::');
    const ns = parts.length > 1 ? parts[0] : namespace;
    const file = parts.length > 1 ? parts.slice(1).join('::') : parts[0];
    setDeletingProposal(true);
    try {
      await deleteProposal(apiKey, ns, file);
      setProposals(
        namespace,
        proposals.filter((x) => x.fileName !== p.fileName),
      );
    } catch {
      /* ignore */
    } finally {
      setDeletingProposal(false);
      setConfirmProposal(null);
    }
  };

  const handleDeleteMicrositeConfirmed = async () => {
    if (!confirmMicrosite) return;
    setDeletingMicrosite(true);
    try {
      await deleteMicrositeHistoryFromServer(apiKey, namespace, confirmMicrosite.id);
      setMicrositeEntries((prev) => prev.filter((e) => e.id !== confirmMicrosite.id));
    } catch {
      /* ignore */
    } finally {
      setDeletingMicrosite(false);
      setConfirmMicrosite(null);
    }
  };

  // ── Data fetching ─────────────────────────────────────────────────
  useEffect(() => {
    if (!namespace || !apiKey) return;
    if (!panelData?.proposals) setLoadingProposals(true);
    fetchProposals(apiKey)
      .then((all) =>
        setProposals(
          namespace,
          all.filter((p) => p.fileName.startsWith(`${namespace}::`)),
        ),
      )
      .catch(() => {})
      .finally(() => setLoadingProposals(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, apiKey]);

  const loadMicrositeEntries = useCallback(() => {
    if (!namespace || !apiKey) return;
    setLoadingMicrosites(true);
    fetchAllMicrositeHistory(apiKey)
      .then((all) => setMicrositeEntries(all.filter((e) => e.namespace === namespace)))
      .catch(() => {})
      .finally(() => setLoadingMicrosites(false));
  }, [namespace, apiKey]);

  useEffect(() => {
    loadMicrositeEntries();
  }, [loadMicrositeEntries]);

  useEffect(() => {
    if (!namespace || !apiKey) return;
    setLoadingFiles(true);
    fetchKnowledgeFiles(apiKey, namespace)
      .then((f) => setFiles(newestFirst(f)))
      .catch(() => setFiles([]))
      .finally(() => setLoadingFiles(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, apiKey, fileRefreshTick]);

  // Poll while files are uploading / processing
  const hasActiveIngestion = files.some((f) => ['uploaded', 'processing', 'extracting'].includes(f.status ?? ''));
  useEffect(() => {
    if (!hasActiveIngestion || !namespace || !apiKey) return;
    const timer = setInterval(async () => {
      try {
        const fetched = await fetchKnowledgeFiles(apiKey, namespace);
        setFiles(newestFirst(fetched));
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [hasActiveIngestion, namespace, apiKey]);

  // Re-fetch after executions complete
  const allExecutions = useExecutionStore((s) => s.executions);
  const seenCompletedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const justCompleted = Object.values(allExecutions).filter(
      (e) =>
        (e.type === 'proposal' || e.type === 'microsite') &&
        e.status === 'completed' &&
        !seenCompletedRef.current.has(e.id),
    );
    Object.values(allExecutions)
      .filter((e) => e.status === 'completed' || e.status === 'failed')
      .forEach((e) => seenCompletedRef.current.add(e.id));
    if (!justCompleted.length || !namespace || !apiKey) return;
    if (justCompleted.some((e) => e.type === 'proposal')) {
      fetchProposals(apiKey).then((all) =>
        setProposals(
          namespace,
          all.filter((p) => p.fileName.startsWith(`${namespace}::`)),
        ),
      );
    }
    if (justCompleted.some((e) => e.type === 'microsite')) loadMicrositeEntries();
  }, [allExecutions, namespace, apiKey, setProposals, loadMicrositeEntries]);

  // ── Tab content ───────────────────────────────────────────────────

  const renderArtifacts = () => (
    <div className="client-panel-list">
      {/* Proposals sub-section */}
      <span className="client-panel-sub-label">Proposals</span>
      {loadingProposals && panelData?.proposals === undefined ? (
        <EmptyRow label="Loading…" />
      ) : proposals.length === 0 ? (
        <EmptyRow label="No proposals yet" />
      ) : (
        proposals.map((p) => {
          const [ns, ...fileParts] = p.fileName.split('::');
          const file = fileParts.join('::') || ns;
          const href = fileParts.length
            ? `/proposal?artifact=${encodeURIComponent(file)}&namespace=${encodeURIComponent(ns)}&from=chat`
            : `/proposal?artifact=${encodeURIComponent(file)}&from=chat`;
          const badgeClass = statusBadgeClass(p.status);
          const isHov = hoveredProposal === p.fileName;
          return (
            <div
              key={p.fileName}
              className="client-panel-row"
              onClick={() => router.push(href)}
              onMouseEnter={() => setHoveredProposal(p.fileName)}
              onMouseLeave={() => setHoveredProposal(null)}
              style={{ paddingRight: isHov || menuProposal?.fileName === p.fileName ? 36 : 10 }}
            >
              <span className="client-panel-row-name">{p.client || p.fileName}</span>
              {badgeClass && (
                <span
                  className={badgeClass}
                  style={{ flexShrink: 0, fontSize: 10, fontWeight: 500, background: 'transparent', border: 'none' }}
                >
                  {statusLabel(p.status)}
                </span>
              )}
              <span className="client-panel-version-badge">v{p.version ?? 1}</span>
              <button
                ref={(el) => {
                  proposalMenuBtnRefs.current[p.fileName] = el;
                }}
                className="btn btn-sm client-panel-row-menu"
                title="Options"
                onClick={(e) => {
                  e.stopPropagation();
                  const btn = proposalMenuBtnRefs.current[p.fileName];
                  if (!btn) return;
                  const rect = btn.getBoundingClientRect();
                  setProposalMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                  setMenuProposal(p);
                }}
                style={{ opacity: isHov || menuProposal?.fileName === p.fileName ? 1 : 0 }}
              >
                <Icon icon={MoreHorizontal} size="sm" />
              </button>
            </div>
          );
        })
      )}

      {/* Microsites sub-section */}
      <span className="client-panel-sub-label" style={{ marginTop: 8 }}>
        Microsites
      </span>
      {loadingMicrosites ? (
        <EmptyRow label="Loading…" />
      ) : micrositesWithMeta.length === 0 ? (
        <EmptyRow label="No microsites yet" />
      ) : (
        micrositesWithMeta.map(({ entry, displayName, version }) => {
          const itemId = entry.id;
          const ast = entry.ast as LayoutAST;
          const pid = ast?.proposalId || namespace;
          const isHov = hoveredMicrosite === itemId;
          return (
            <div
              key={itemId}
              className="client-panel-row"
              onClick={() => onMicrositeClick?.({ entryId: entry.id, namespace, proposalId: pid, displayName })}
              onMouseEnter={() => setHoveredMicrosite(itemId)}
              onMouseLeave={() => setHoveredMicrosite(null)}
              style={{ paddingRight: isHov || menuMicrosite?.id === itemId ? 36 : 10 }}
            >
              <span className="client-panel-row-name">{displayName}</span>
              <span className="client-panel-version-badge">v{version}</span>
              <button
                ref={(el) => {
                  micrositeMenuBtnRefs.current[itemId] = el;
                }}
                className="btn btn-sm client-panel-row-menu"
                title="Options"
                onClick={(e) => {
                  e.stopPropagation();
                  const btn = micrositeMenuBtnRefs.current[itemId];
                  if (!btn) return;
                  const rect = btn.getBoundingClientRect();
                  setMicrositeMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                  setMenuMicrosite({ id: itemId, proposalId: entry.id });
                }}
                style={{ opacity: isHov || menuMicrosite?.id === itemId ? 1 : 0 }}
              >
                <Icon icon={MoreHorizontal} size="sm" />
              </button>
            </div>
          );
        })
      )}
    </div>
  );

  const renderFiles = () => (
    <div className="client-panel-list">
      {loadingFiles ? (
        <EmptyRow label="Loading…" />
      ) : files.length === 0 ? (
        <EmptyRow label="No files yet" />
      ) : (
        files.map((f) => {
          const isActive = ['uploaded', 'processing', 'extracting'].includes(f.status ?? '');
          const isHov = hoveredFile === f.fileName && (menuFile === null || menuFile === f.fileName);
          const isMenuOpen = menuFile === f.fileName;
          return (
            <div
              key={f.fileName}
              style={{ position: 'relative' }}
              onMouseEnter={() => {
                if (menuFile === null || menuFile === f.fileName) setHoveredFile(f.fileName);
              }}
              onMouseLeave={() => setHoveredFile(null)}
            >
              <div
                className="client-panel-row"
                style={{
                  paddingRight: isHov || isMenuOpen ? 36 : 10,
                  background: isActive ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : undefined,
                  cursor: 'default',
                }}
              >
                <span className="client-panel-row-name">{f.originalName ?? f.fileName}</span>
                {f.status === 'processing' && (
                  <span
                    style={{
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      fontSize: 10,
                      color: 'var(--primary)',
                    }}
                  >
                    <Icon
                      icon={Loader2}
                      size="sm"
                      style={{ animation: 'spin 1s linear infinite', width: 10, height: 10 }}
                    />
                    Indexing
                  </span>
                )}
                {f.status === 'extracting' && (
                  <span
                    style={{
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      fontSize: 10,
                      color: 'var(--primary)',
                    }}
                  >
                    <Icon
                      icon={Loader2}
                      size="sm"
                      style={{ animation: 'spin 1s linear infinite', width: 10, height: 10 }}
                    />
                    Extracting
                  </span>
                )}
                {f.status === 'uploaded' && (
                  <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--muted)' }}>Queued</span>
                )}
                {(f.status === 'indexed' || f.status === 'extracted' || f.status === 'failed') && (
                  <span
                    className={`ingestion-badge--${f.status}`}
                    style={{ flexShrink: 0, fontSize: 10, fontWeight: 500, background: 'transparent', border: 'none' }}
                  >
                    {f.status.toUpperCase()}
                  </span>
                )}
              </div>
              <button
                ref={(el) => {
                  menuBtnRefs.current[f.fileName] = el;
                }}
                className="btn btn-sm client-panel-row-menu"
                title="Options"
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  padding: '1px 5px',
                  border: 'none',
                  lineHeight: 1,
                  opacity: isHov || isMenuOpen ? 1 : 0,
                  pointerEvents: isHov || isMenuOpen ? 'auto' : 'none',
                  transition: 'opacity 0.15s',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isMenuOpen) {
                    setMenuFile(null);
                    return;
                  }
                  const btn = menuBtnRefs.current[f.fileName];
                  if (!btn) return;
                  const rect = btn.getBoundingClientRect();
                  setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                  setMenuFile(f.fileName);
                }}
              >
                <Icon icon={MoreHorizontal} size="sm" />
              </button>
            </div>
          );
        })
      )}
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────

  return (
    <>
      <div className="client-panel">
        {/* Tab bar */}
        <div className="client-panel-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`client-panel-tab${activeTab === t.id ? ' active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="client-panel-body">
          {activeTab === 'brief' && (
            <BriefSidePanel
              namespace={namespace}
              apiKey={apiKey}
              collectionStatus={collectionStatus}
              onAskField={onAskField}
              hidePanelHeading
            />
          )}
          {activeTab === 'artifacts' && renderArtifacts()}
          {activeTab === 'memory' && (
            <div style={{ padding: '0 8px' }}>
              <MemorySection namespace={namespace} />
            </div>
          )}
        </div>
      </div>

      {/* ── Portalled dropdowns ── */}
      {menuFile &&
        createPortal(
          <div
            ref={fileDropdownRef}
            className="card"
            style={{
              position: 'fixed',
              top: menuPos.top,
              right: menuPos.right,
              minWidth: 140,
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
                fontSize: 14,
                gap: 8,
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const f = menuFile;
                setMenuFile(null);
                void handleViewFile(f);
              }}
            >
              <Icon icon={ExternalLink} size="sm" />
              <span>View</span>
            </button>
            <button
              className="btn btn-sm"
              style={{
                width: '100%',
                textAlign: 'left',
                borderRadius: 0,
                border: 'none',
                justifyContent: 'flex-start',
                padding: '8px 14px',
                fontSize: 14,
                color: 'var(--danger)',
                gap: 8,
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const f = menuFile;
                setMenuFile(null);
                setConfirmFile(f);
              }}
            >
              <Icon icon={Trash2} size="sm" />
              <span>Delete</span>
            </button>
          </div>,
          document.body,
        )}

      {menuProposal &&
        createPortal(
          <div
            ref={proposalDropdownRef}
            className="card"
            style={{
              position: 'fixed',
              top: proposalMenuPos.top,
              right: proposalMenuPos.right,
              minWidth: 120,
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
                fontSize: 14,
                color: 'var(--danger)',
                gap: 8,
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const p = menuProposal;
                setMenuProposal(null);
                setConfirmProposal(p);
              }}
            >
              <Icon icon={Trash2} size="sm" />
              <span>Delete</span>
            </button>
          </div>,
          document.body,
        )}

      {menuMicrosite &&
        createPortal(
          <div
            ref={micrositeDropdownRef}
            className="card"
            style={{
              position: 'fixed',
              top: micrositeMenuPos.top,
              right: micrositeMenuPos.right,
              minWidth: 120,
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
                fontSize: 14,
                color: 'var(--danger)',
                gap: 8,
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const ms = menuMicrosite;
                setMenuMicrosite(null);
                const meta = micrositesWithMeta.find((x) => x.entry.id === ms.id);
                setConfirmMicrosite({ ...ms, displayName: meta?.displayName ?? ms.proposalId });
              }}
            >
              <Icon icon={Trash2} size="sm" />
              <span>Delete</span>
            </button>
          </div>,
          document.body,
        )}

      {/* ── Confirm delete dialogs ── */}
      {confirmFile &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 20000,
              background: 'rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !deletingFile) setConfirmFile(null);
            }}
          >
            <div
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                width: '100%',
                maxWidth: 420,
                boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '20px 24px 0' }}>
                <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 16px' }}>Delete file</p>
              </div>
              <div style={{ height: 1, background: 'var(--border)' }} />
              <div style={{ padding: 24 }}>
                <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 20, lineHeight: 1.5 }}>
                  Delete <strong>"{files.find(f => f.fileName === confirmFile)?.originalName ?? confirmFile}"</strong>?
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setConfirmFile(null)}
                    disabled={deletingFile}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--panel-soft)',
                      color: 'var(--text)',
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteFileConfirmed}
                    disabled={deletingFile}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--danger)',
                      color: '#fff',
                      fontSize: 14,
                      cursor: 'pointer',
                      opacity: deletingFile ? 0.7 : 1,
                    }}
                  >
                    {deletingFile ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {confirmProposal &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 20000,
              background: 'rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !deletingProposal) setConfirmProposal(null);
            }}
          >
            <div
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                width: '100%',
                maxWidth: 420,
                boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '20px 24px 0' }}>
                <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 16px' }}>
                  Delete proposal
                </p>
              </div>
              <div style={{ height: 1, background: 'var(--border)' }} />
              <div style={{ padding: 24 }}>
                <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 20, lineHeight: 1.5 }}>
                  Delete the proposal for <strong>"{confirmProposal.client || confirmProposal.fileName}"</strong>?
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setConfirmProposal(null)}
                    disabled={deletingProposal}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--panel-soft)',
                      color: 'var(--text)',
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteProposalConfirmed}
                    disabled={deletingProposal}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--danger)',
                      color: '#fff',
                      fontSize: 14,
                      cursor: 'pointer',
                      opacity: deletingProposal ? 0.7 : 1,
                    }}
                  >
                    {deletingProposal ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {confirmMicrosite &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 20000,
              background: 'rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !deletingMicrosite) setConfirmMicrosite(null);
            }}
          >
            <div
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                width: '100%',
                maxWidth: 420,
                boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '20px 24px 0' }}>
                <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 16px' }}>
                  Delete microsite
                </p>
              </div>
              <div style={{ height: 1, background: 'var(--border)' }} />
              <div style={{ padding: 24 }}>
                <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 20, lineHeight: 1.5 }}>
                  Delete the microsite for <strong>"{confirmMicrosite.displayName}"</strong>?
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setConfirmMicrosite(null)}
                    disabled={deletingMicrosite}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--panel-soft)',
                      color: 'var(--text)',
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteMicrositeConfirmed}
                    disabled={deletingMicrosite}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--danger)',
                      color: '#fff',
                      fontSize: 14,
                      cursor: 'pointer',
                      opacity: deletingMicrosite ? 0.7 : 1,
                    }}
                  >
                    {deletingMicrosite ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
