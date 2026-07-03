'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ExternalLink, Loader2, MoreHorizontal, Trash2 } from 'lucide-react';
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
  listDesignSkillsApi,
  type IngestionFile,
  type MicrositeHistoryServerEntry,
  type ProposalFile,
  type DesignSkillSummaryApi,
} from '@/lib/api';
import type { LayoutAST } from '@/types/presentation';
import { Icon } from '@/components/ui/Icon';
import { useNamespacePanelStore } from '@/lib/namespace-panel-store';
import { useExecutionStore } from '@/core/execution/execution-store';
import { MemorySection } from './MemorySection';

// ── Helpers — same as VersionHistory ─────────────────────────────

export function parseMicrositeInfo(proposalId: string): { name: string; version: number | null } {
  const raw = proposalId.includes('::') ? proposalId.split('::').slice(1).join('::') : proposalId;
  const withoutExt = raw.replace(/\.[^.]+$/, '');
  const vMatch = withoutExt.match(/_v(\d+)$/);
  const name = vMatch ? withoutExt.slice(0, -vMatch[0].length) : withoutExt;
  const version = vMatch ? parseInt(vMatch[1], 10) : null;
  return { name, version };
}

function parseMicrositeLabel(proposalId: string): string {
  const { name, version } = parseMicrositeInfo(proposalId);
  return version != null ? `${name} · ${version}` : name;
}

// ── Collapsible section — mirrors sidebar NamespacesSection ──────

export interface SectionProps {
  label: string;
  loading: boolean;
  children: React.ReactNode;
  badge?: number;
}

export function Section({ label, loading, children, badge }: SectionProps) {
  const [open, setOpen] = useState(true);
  const [hovered, setHovered] = useState(false);

  return (
    <div>
      <div
        className="sidebar-link"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: 'pointer' }}
      >
        <span className="sidebar-label ns-section-title" style={{ flex: 1 }}>
          {label}
        </span>
        {badge ? (
          <span
            style={{
              flexShrink: 0,
              background: 'var(--warning, #f59e0b)',
              color: '#000',
              borderRadius: 100,
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 6px',
              lineHeight: 1.5,
              marginRight: 4,
            }}
          >
            {badge}
          </span>
        ) : null}
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

      {open &&
        (loading ? (
          <div style={{ padding: '2px 8px 8px' }}>
            <span className="sidebar-label" style={{ color: 'var(--muted)', opacity: 0.45, fontSize: 13 }}>
              Loading…
            </span>
          </div>
        ) : (
          <div style={{ padding: '2px 0 4px' }}>{children}</div>
        ))}
    </div>
  );
}

const newestFirst = (files: IngestionFile[]) =>
  [...files].sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

// ── Panel ─────────────────────────────────────────────────────────

interface Props {
  namespace: string;
  onMicrositeClick?: (info: { entryId: string; namespace: string; proposalId: string; displayName: string }) => void;
  fileRefreshTick?: number;
  onHasContent?: (hasContent: boolean) => void;
}

export function NamespacePanel({ namespace, onMicrositeClick, fileRefreshTick, onHasContent }: Props) {
  const { apiKey } = useAuth();
  const router = useRouter();

  // Read from persisted store — survives page reloads (proposals only)
  const panelData = useNamespacePanelStore(
    (s: {
      byNamespace: Record<
        string,
        { proposals: import('@/lib/api').ProposalFile[]; microsites: import('@/lib/api').Presentation[] }
      >;
    }) => s.byNamespace[namespace],
  );
  const setProposals = useNamespacePanelStore(
    (s: { setProposals: (ns: string, p: import('@/lib/api').ProposalFile[]) => void }) => s.setProposals,
  );

  // Microsite history entries — fetched fresh from server (not stored in panel store)
  const [micrositeEntries, setMicrositeEntries] = useState<MicrositeHistoryServerEntry[]>([]);

  const proposals = [...(panelData?.proposals ?? [])].sort((a, b) => {
    const vDiff = (b.version ?? -1) - (a.version ?? -1);
    if (vDiff !== 0) return vDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const proposalClientMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of proposals) {
      const parts = p.fileName.split('::');
      const pid = (parts.length > 1 ? parts.slice(1).join('::') : parts[0]).replace(/\.md$/, '');
      if (p.client) map.set(pid, p.client);
    }
    return map;
  }, [proposals]);

  // Microsites sorted newest-first, each entry has its server-assigned version
  const micrositesWithMeta = useMemo(
    () =>
      [...micrositeEntries]
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
        .map((entry) => ({
          entry,
          displayName: (entry.ast as LayoutAST)?.brand?.companyName || 'Untitled',
          version: entry.version ?? 1,
          isPro: (entry.ast as LayoutAST)?.generationMode !== 'classic',
        })),
    [micrositeEntries],
  );

  // Ingested files stay local — no cross-session caching needed
  const [files, setFiles] = useState<IngestionFile[]>([]);
  const [hasMemory, setHasMemory] = useState(false);
  const [loadingMemory, setLoadingMemory] = useState(true);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [loadingMicrosites, setLoadingMicrosites] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // Design skills — global, not namespace-scoped
  const [designSkills, setDesignSkills] = useState<DesignSkillSummaryApi[]>([]);
  const [loadingDesignSkills, setLoadingDesignSkills] = useState(false);

  // True if the namespace has never been fetched yet (undefined vs empty array).
  // This prevents the panel from returning null on the first render after a namespace
  // switch before the fetch effects have had a chance to set loadingProposals/Microsites.
  const effectiveLoadingProposals = loadingProposals || panelData?.proposals === undefined;
  const effectiveLoadingMicrosites = loadingMicrosites;

  // File hover / menu state — mirrors NamespacesSection pattern
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);
  const [menuFile, setMenuFile] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [confirmFile, setConfirmFile] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const menuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Proposal delete state
  const [hoveredProposal, setHoveredProposal] = useState<string | null>(null);
  const [menuProposal, setMenuProposal] = useState<ProposalFile | null>(null);
  const [proposalMenuPos, setProposalMenuPos] = useState({ top: 0, right: 0 });
  const [confirmProposal, setConfirmProposal] = useState<ProposalFile | null>(null);
  const [deletingProposal, setDeletingProposal] = useState(false);
  const proposalMenuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const proposalDropdownRef = useRef<HTMLDivElement | null>(null);

  // Microsite delete state
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

  const openFileMenu = useCallback((fileName: string) => {
    const btn = menuBtnRefs.current[fileName];
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setMenuFile(fileName);
  }, []);

  useEffect(() => {
    if (!menuFile) return;
    const handler = (e: MouseEvent) => {
      const btn = menuBtnRefs.current[menuFile];
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
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

  const handleViewFile = useCallback(
    async (fileName: string) => {
      const downloadName = files.find((f) => f.fileName === fileName)?.originalName ?? fileName;
      await openKnowledgeFile(apiKey, namespace, fileName, downloadName);
    },
    [apiKey, namespace, files],
  );

  const handleDeleteConfirmed = async () => {
    if (!confirmFile) return;
    setDeleting(true);
    try {
      await deleteKnowledgeFile(apiKey, namespace, confirmFile);
      setFiles((prev) => prev.filter((f) => f.fileName !== confirmFile));
    } catch {
      /* silently ignore */
    } finally {
      setDeleting(false);
      setConfirmFile(null);
    }
  };

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

  // ── Initial load — fetch and populate the persisted store ────────

  useEffect(() => {
    if (!namespace || !apiKey) return;
    // Only show spinner if we have no cached data yet
    if (!panelData?.proposals) setLoadingProposals(true);
    fetchProposals(apiKey)
      .then((all) => {
        // Filter to this namespace using the "namespace::file.md" prefix (same as VersionHistory source)
        const filtered = all.filter((p) => p.fileName.startsWith(`${namespace}::`));
        setProposals(namespace, filtered);
      })
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
    if (!apiKey) return;
    setLoadingDesignSkills(true);
    listDesignSkillsApi(apiKey)
      .then((skills) => setDesignSkills(skills))
      .catch(() => setDesignSkills([]))
      .finally(() => setLoadingDesignSkills(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  useEffect(() => {
    if (!namespace || !apiKey) return;
    setLoadingFiles(true);
    fetchKnowledgeFiles(apiKey, namespace)
      .then((f) => setFiles(newestFirst(f)))
      .catch(() => setFiles([]))
      .finally(() => setLoadingFiles(false));
    // fileRefreshTick intentionally triggers a re-fetch after upload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, apiKey, fileRefreshTick]);

  // Poll while files are uploading or processing — mirrors ChatUploadDrawer polling
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

  // ── Reactive update — re-fetch when an execution completes ───────
  // Subscribes to the ExecutionStore. When a proposal or microsite execution
  // transitions to 'completed', re-fetch the relevant list and push it into
  // the persisted store — no polling, no timers.

  const allExecutions = useExecutionStore((s) => s.executions);
  const seenCompletedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const justCompleted = Object.values(allExecutions).filter(
      (e) =>
        (e.type === 'proposal' || e.type === 'microsite') &&
        e.status === 'completed' &&
        !seenCompletedRef.current.has(e.id),
    );

    // Advance the seen-set so future renders don't re-trigger
    Object.values(allExecutions)
      .filter((e) => e.status === 'completed' || e.status === 'failed')
      .forEach((e) => seenCompletedRef.current.add(e.id));

    if (!justCompleted.length || !namespace || !apiKey) return;

    if (justCompleted.some((e) => e.type === 'proposal')) {
      fetchProposals(apiKey)
        .then((all) => {
          const filtered = all.filter((p) => p.fileName.startsWith(`${namespace}::`));
          setProposals(namespace, filtered);
        })
        .catch(() => {});
    }

    if (justCompleted.some((e) => e.type === 'microsite')) {
      loadMicrositeEntries();
    }
  }, [allExecutions, namespace, apiKey, setProposals, loadMicrositeEntries]);

  const allLoaded = !effectiveLoadingProposals && !effectiveLoadingMicrosites && !loadingFiles && !loadingMemory;
  const hasContent = proposals.length > 0 || micrositeEntries.length > 0 || files.length > 0 || !!namespace;

  useEffect(() => {
    if (allLoaded) onHasContent?.(hasContent);
  }, [allLoaded, hasContent, onHasContent]);

  if (!namespace) return null;
  if (allLoaded && !hasContent) return null;

  const statusBadgeClass = (status: string | null) => {
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
  };

  const statusLabel = (status: string | null) => {
    if (!status) return null;
    return status.replace('_', ' ').toUpperCase();
  };

  return (
    <>
      <aside className="chat-ctx-panel">
        <div style={{ padding: '0 8px' }}>
          {/* ── Microsites ── */}
          <Section label="Microsites" loading={effectiveLoadingMicrosites}>
            {micrositeEntries.length === 0 ? (
              <div style={{ padding: '2px 8px 4px 12px' }}>
                <span className="sidebar-label" style={{ color: 'var(--muted)', opacity: 0.4, fontSize: 13 }}>
                  No microsites yet
                </span>
              </div>
            ) : (
              micrositesWithMeta.map(({ entry, displayName, version, isPro }) => {
                const itemId = entry.id;
                const ast = entry.ast as LayoutAST;
                const pid = ast?.proposalId || namespace;
                const isHov = hoveredMicrosite === itemId;
                return (
                  <div
                    key={itemId}
                    className="sidebar-link"
                    onClick={() => onMicrositeClick?.({ entryId: entry.id, namespace, proposalId: pid, displayName })}
                    onMouseEnter={() => setHoveredMicrosite(itemId)}
                    onMouseLeave={() => setHoveredMicrosite(null)}
                    style={{
                      cursor: 'pointer',
                      height: 32,
                      minWidth: 0,
                      margin: '0 0 2px',
                      background: 'var(--panel-item)',
                      paddingLeft: 12,
                      paddingRight: isHov || menuMicrosite?.id === itemId ? 36 : 6,
                      transition: 'padding-right 0.15s',
                      position: 'relative',
                    }}
                  >
                    <span
                      className="sidebar-label"
                      style={{
                        color: 'var(--text)',
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 13,
                      }}
                    >
                      {displayName}
                    </span>
                    <span
                      style={{
                        flexShrink: 0,
                        display: 'inline-block',
                        background: 'var(--primary-soft)',
                        color: 'var(--primary)',
                        borderRadius: 100,
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '2px 8px',
                        letterSpacing: '0.06em',
                        lineHeight: 1.4,
                      }}
                    >
                      v{version}
                    </span>
                    <button
                      ref={(el) => {
                        micrositeMenuBtnRefs.current[itemId] = el;
                      }}
                      className="btn btn-sm"
                      title="Options"
                      onClick={(e) => {
                        e.stopPropagation();
                        const btn = micrositeMenuBtnRefs.current[itemId];
                        if (!btn) return;
                        const rect = btn.getBoundingClientRect();
                        setMicrositeMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                        setMenuMicrosite({ id: itemId, proposalId: entry.id });
                      }}
                      style={{
                        position: 'absolute',
                        right: 16,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        padding: '1px 5px',
                        border: 'none',
                        lineHeight: 1,
                        opacity: isHov || menuMicrosite?.id === itemId ? 1 : 0,
                        pointerEvents: isHov || menuMicrosite?.id === itemId ? 'auto' : 'none',
                        transition: 'opacity 0.15s',
                      }}
                    >
                      <Icon icon={MoreHorizontal} size="sm" />
                    </button>
                  </div>
                );
              })
            )}
          </Section>

          {/* ── Proposals ── */}
          <Section label="Proposals" loading={effectiveLoadingProposals}>
            {proposals.length === 0 ? (
              <div style={{ padding: '2px 8px 4px 12px' }}>
                <span className="sidebar-label" style={{ color: 'var(--muted)', opacity: 0.4, fontSize: 13 }}>
                  No proposals yet
                </span>
              </div>
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
                    className="sidebar-link"
                    onClick={() => router.push(href)}
                    onMouseEnter={() => setHoveredProposal(p.fileName)}
                    onMouseLeave={() => setHoveredProposal(null)}
                    style={{
                      cursor: 'pointer',
                      height: 32,
                      minWidth: 0,
                      margin: '0 0 2px',
                      background: 'var(--panel-item)',
                      paddingLeft: 12,
                      paddingRight: isHov || menuProposal?.fileName === p.fileName ? 36 : 6,
                      transition: 'padding-right 0.15s',
                      position: 'relative',
                    }}
                  >
                    <span
                      className="sidebar-label"
                      style={{
                        color: 'var(--text)',
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 13,
                      }}
                    >
                      {p.client}
                    </span>
                    {badgeClass && (
                      <span
                        className={badgeClass}
                        style={{
                          flexShrink: 0,
                          fontSize: 10,
                          fontWeight: 500,
                          background: 'transparent',
                          border: 'none',
                        }}
                      >
                        {statusLabel(p.status)}
                      </span>
                    )}
                    <span
                      style={{
                        flexShrink: 0,
                        display: 'inline-block',
                        background: 'var(--primary-soft)',
                        color: 'var(--primary)',
                        borderRadius: 100,
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '2px 8px',
                        letterSpacing: '0.06em',
                        lineHeight: 1.4,
                      }}
                    >
                      v{p.version ?? 1}
                    </span>
                    <button
                      ref={(el) => {
                        proposalMenuBtnRefs.current[p.fileName] = el;
                      }}
                      className="btn btn-sm"
                      title="Options"
                      onClick={(e) => {
                        e.stopPropagation();
                        const btn = proposalMenuBtnRefs.current[p.fileName];
                        if (!btn) return;
                        const rect = btn.getBoundingClientRect();
                        setProposalMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                        setMenuProposal(p);
                      }}
                      style={{
                        position: 'absolute',
                        right: 16,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        padding: '1px 5px',
                        border: 'none',
                        lineHeight: 1,
                        opacity: isHov || menuProposal?.fileName === p.fileName ? 1 : 0,
                        pointerEvents: isHov || menuProposal?.fileName === p.fileName ? 'auto' : 'none',
                        transition: 'opacity 0.15s',
                      }}
                    >
                      <Icon icon={MoreHorizontal} size="sm" />
                    </button>
                  </div>
                );
              })
            )}
          </Section>

          {/* ── Ingested Files ── */}
          <Section label="Ingested Files" loading={loadingFiles}>
            {files.length === 0 ? (
              <div style={{ padding: '2px 8px 4px 12px' }}>
                <span className="sidebar-label" style={{ color: 'var(--muted)', opacity: 0.4, fontSize: 13 }}>
                  No files yet
                </span>
              </div>
            ) : (
              files.map((f) => {
                const isHovered = hoveredFile === f.fileName && (menuFile === null || menuFile === f.fileName);
                const isMenuOpen = menuFile === f.fileName;
                const isActive = f.status === 'uploaded' || f.status === 'processing' || f.status === 'extracting';
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
                      className="sidebar-link"
                      style={{
                        cursor: 'default',
                        height: 32,
                        minWidth: 0,
                        margin: '0 0 2px',
                        background: isActive
                          ? 'color-mix(in srgb, var(--primary) 12%, var(--panel-item))'
                          : 'var(--panel-item)',
                        paddingLeft: 12,
                        paddingRight: isHovered || isMenuOpen ? 36 : 12,
                        transition: 'padding-right 0.15s, background 0.2s ease, color 0.2s ease, transform 0.2s ease',
                      }}
                    >
                      <span
                        className="sidebar-label"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          fontSize: 13,
                          color: 'var(--text)',
                        }}
                      >
                        {f.originalName ?? f.fileName}
                      </span>
                      {f.status === 'processing' && (
                        <span
                          style={{
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 10,
                            fontWeight: 500,
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
                            gap: 4,
                            fontSize: 10,
                            fontWeight: 500,
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
                        <span
                          style={{
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 10,
                            fontWeight: 500,
                            color: 'var(--muted)',
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: 'var(--muted)',
                              flexShrink: 0,
                              animation: 'pulse 1.6s ease-in-out infinite',
                            }}
                          />
                          Queued
                        </span>
                      )}
                      {(f.status === 'indexed' || f.status === 'extracted' || f.status === 'failed') && (
                        <span
                          className={`ingestion-badge--${f.status}`}
                          style={{
                            flexShrink: 0,
                            fontSize: 10,
                            fontWeight: 500,
                            background: 'transparent',
                            border: 'none',
                          }}
                        >
                          {f.status.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <button
                      ref={(el) => {
                        menuBtnRefs.current[f.fileName] = el;
                      }}
                      className="btn btn-sm"
                      title="Options"
                      style={{
                        position: 'absolute',
                        right: 16,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        padding: '1px 5px',
                        border: 'none',
                        lineHeight: 1,
                        opacity: isHovered || isMenuOpen ? 1 : 0,
                        pointerEvents: isHovered || isMenuOpen ? 'auto' : 'none',
                        transition: 'opacity 0.15s',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        isMenuOpen ? setMenuFile(null) : openFileMenu(f.fileName);
                      }}
                    >
                      <Icon icon={MoreHorizontal} size="sm" />
                    </button>
                  </div>
                );
              })
            )}
          </Section>

          {/* ── Design Skills ── */}
          {(loadingDesignSkills || designSkills.length > 0) && (
            <Section label="Design Skills" loading={loadingDesignSkills}>
              {designSkills.length === 0 ? (
                <div style={{ padding: '2px 8px 4px 12px' }}>
                  <span className="sidebar-label" style={{ color: 'var(--muted)', opacity: 0.4, fontSize: 13 }}>
                    No design skills yet
                  </span>
                </div>
              ) : (
                designSkills.map((ds) => (
                  <div
                    key={ds.slug}
                    className="sidebar-link"
                    onClick={() => router.push('/skills?mode=design')}
                    style={{
                      cursor: 'pointer',
                      height: 32,
                      minWidth: 0,
                      margin: '0 0 2px',
                      background: 'var(--panel-item)',
                      paddingLeft: 12,
                      paddingRight: 6,
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: ds.colorPalette.primary,
                        border: '1px solid rgba(255,255,255,0.15)',
                        marginRight: 6,
                      }}
                    />
                    <span
                      className="sidebar-label"
                      style={{
                        color: 'var(--text)',
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 13,
                      }}
                    >
                      {ds.displayName}
                    </span>
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 500,
                        color: 'var(--muted)',
                        opacity: 0.7,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 80,
                      }}
                    >
                      {ds.aestheticTone}
                    </span>
                  </div>
                ))
              )}
            </Section>
          )}

          <MemorySection namespace={namespace} onHasMemory={setHasMemory} onLoadingChange={setLoadingMemory} />
        </div>
      </aside>

      {/* File options dropdown — portalled to avoid clipping */}
      {menuFile &&
        createPortal(
          <div
            ref={dropdownRef}
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

      {/* Confirm delete dialog */}
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
              if (e.target === e.currentTarget && !deleting) setConfirmFile(null);
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
                <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 16px', lineHeight: 1.5 }}>
                  Delete file
                </p>
              </div>
              <div style={{ height: 1, background: 'var(--border)' }} />
              <div style={{ padding: 24 }}>
                <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 20, lineHeight: 1.5 }}>
                  Delete <strong>"{files.find(f => f.fileName === confirmFile)?.originalName ?? confirmFile}"</strong> from the knowledge base?
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setConfirmFile(null)}
                    disabled={deleting}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--panel-soft)',
                      color: 'var(--text)',
                      fontSize: 14,
                      cursor: deleting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteConfirmed}
                    disabled={deleting}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--danger)',
                      color: '#fff',
                      fontSize: 14,
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

      {/* Proposal overflow dropdown */}
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

      {/* Proposal confirm delete dialog */}
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
                      cursor: deletingProposal ? 'not-allowed' : 'pointer',
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
                      cursor: deletingProposal ? 'not-allowed' : 'pointer',
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

      {/* Microsite overflow dropdown */}
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

      {/* Microsite confirm delete dialog */}
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
                      cursor: deletingMicrosite ? 'not-allowed' : 'pointer',
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
                      cursor: deletingMicrosite ? 'not-allowed' : 'pointer',
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
