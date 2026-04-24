'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Loader2, MoreHorizontal, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  fetchProposals,
  fetchPresentations,
  fetchKnowledgeFiles,
  deleteKnowledgeFile,
  type IngestionFile,
  type Presentation,
} from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { useNamespacePanelStore } from '@/lib/namespace-panel-store';
import { useExecutionStore } from '@/core/execution/execution-store';

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

interface SectionProps {
  label: string;
  loading: boolean;
  children: React.ReactNode;
}

function Section({ label, loading, children }: SectionProps) {
  const [open, setOpen] = useState(true);
  const [hovered, setHovered] = useState(false);

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        className="sidebar-link"
        role="button"
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: 'pointer', borderRadius: 0, paddingLeft: 12 }}
      >
        <span className="sidebar-label" style={{ flex: 1, opacity: 0.5, fontSize: 13 }}>{label}</span>
        <Icon
          icon={ChevronDown}
          size="sm"
          style={{
            flexShrink: 0,
            opacity: hovered ? 0.7 : 0.35,
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'opacity 0.15s, transform 0.15s ease',
          }}
        />
      </div>

      {open && (
        loading ? (
          <div style={{ padding: '2px 8px 8px' }}>
            <span className="sidebar-label" style={{ opacity: 0.45, fontSize: 13 }}>Loading…</span>
          </div>
        ) : <div style={{ padding: '2px 0 4px' }}>{children}</div>
      )}
    </div>
  );
}

const newestFirst = (files: IngestionFile[]) =>
  [...files].sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());


// ── Panel ─────────────────────────────────────────────────────────

interface Props {
  namespace: string;
  onMicrositeClick?: (m: Presentation) => void;
  fileRefreshTick?: number;
}

export function NamespacePanel({ namespace, onMicrositeClick, fileRefreshTick }: Props) {
  const { apiKey } = useAuth();
  const router = useRouter();

  // Read from persisted store — survives page reloads
  const panelData = useNamespacePanelStore((s: { byNamespace: Record<string, { proposals: import('@/lib/api').ProposalFile[]; microsites: import('@/lib/api').Presentation[] }> }) => s.byNamespace[namespace]);
  const setProposals = useNamespacePanelStore((s: { setProposals: (ns: string, p: import('@/lib/api').ProposalFile[]) => void }) => s.setProposals);
  const setMicrosites = useNamespacePanelStore((s: { setMicrosites: (ns: string, m: import('@/lib/api').Presentation[]) => void }) => s.setMicrosites);

  const proposals = [...(panelData?.proposals ?? [])]
    .sort((a, b) => (b.version ?? -1) - (a.version ?? -1));
  const microsites = [...(panelData?.microsites ?? [])]
    .sort((a, b) => {
      const vDiff = (parseMicrositeInfo(b.proposalId).version ?? -1) - (parseMicrositeInfo(a.proposalId).version ?? -1);
      if (vDiff !== 0) return vDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  // Ingested files stay local — no cross-session caching needed
  const [files, setFiles] = useState<IngestionFile[]>([]);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [loadingMicrosites, setLoadingMicrosites] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // File hover / menu state — mirrors NamespacesSection pattern
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);
  const [menuFile, setMenuFile] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [confirmFile, setConfirmFile] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const menuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const dropdownRef = useRef<HTMLDivElement | null>(null);

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
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        btn && !btn.contains(e.target as Node)
      ) setMenuFile(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuFile]);

  const handleDeleteConfirmed = async () => {
    if (!confirmFile) return;
    setDeleting(true);
    try {
      await deleteKnowledgeFile(apiKey, namespace, confirmFile);
      setFiles(prev => prev.filter(f => f.fileName !== confirmFile));
    } catch { /* silently ignore */ }
    finally {
      setDeleting(false);
      setConfirmFile(null);
    }
  };

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
      .then(f => setFiles(newestFirst(f)))
      .catch(() => setFiles([]))
      .finally(() => setLoadingFiles(false));
  // fileRefreshTick intentionally triggers a re-fetch after upload
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, apiKey, fileRefreshTick]);

  // Poll while files are uploading or processing — mirrors ChatUploadDrawer polling
  const hasActiveIngestion = files.some(f => f.status === 'uploaded' || f.status === 'processing');
  useEffect(() => {
    if (!hasActiveIngestion || !namespace || !apiKey) return;
    const timer = setInterval(async () => {
      try {
        const fetched = await fetchKnowledgeFiles(apiKey, namespace);
        setFiles(newestFirst(fetched));
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [hasActiveIngestion, namespace, apiKey]);

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

  const allLoaded = !loadingProposals && !loadingMicrosites && !loadingFiles;
  const hasContent = proposals.length > 0 || microsites.length > 0 || files.length > 0;
  if (allLoaded && !hasContent) return null;

  const statusBadgeClass = (status: string | null) => {
    switch (status) {
      case 'approved': return 'badge--approved';
      case 'finalized': return 'badge--finalized';
      case 'under_review': return 'badge--under-review';
      case 'draft': return 'badge--draft';
      default: return null;
    }
  };

  const statusLabel = (status: string | null) => {
    if (!status) return null;
    return status.replace('_', ' ').toUpperCase();
  };

  return (
    <>
    <aside className="chat-ctx-panel">
      <div>

        {/* ── Microsites ── */}
        <Section label="Microsites" loading={loadingMicrosites}>
          {microsites.length === 0 ? (
            <div style={{ padding: '2px 8px 4px 12px' }}>
              <span className="sidebar-label" style={{ opacity: 0.18, fontSize: 13 }}>No microsites yet</span>
            </div>
          ) : (
            microsites.map(m => {
              const { name, version } = parseMicrositeInfo(m.proposalId);
              return (
                <div
                  key={m.proposalId}
                  className="sidebar-link"
                  onClick={() => onMicrositeClick?.(m)}
                  style={{ cursor: onMicrositeClick ? 'pointer' : 'default', height: 32, minWidth: 0, margin: '0 12px 2px', background: 'var(--panel-soft)', padding: '0 12px' }}
                >
                  <span className="sidebar-label" style={{ color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                    {name}
                  </span>
                  {version != null && (
                    <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 500, padding: '1px 5px', borderRadius: 4, background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid color-mix(in srgb, var(--primary) 30%, transparent)' }}>
                      v{version}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </Section>

        {/* ── Proposals ── */}
        <Section label="Proposals" loading={loadingProposals}>
          {proposals.length === 0 ? (
            <div style={{ padding: '2px 8px 4px 12px' }}>
              <span className="sidebar-label" style={{ opacity: 0.18, fontSize: 13 }}>No proposals yet</span>
            </div>
          ) : (
            proposals.map(p => {
              const [ns, ...fileParts] = p.fileName.split('::');
              const file = fileParts.join('::') || ns;
              const href = fileParts.length
                ? `/proposal?artifact=${encodeURIComponent(file)}&namespace=${encodeURIComponent(ns)}&from=chat`
                : `/proposal?artifact=${encodeURIComponent(file)}&from=chat`;
              const badgeClass = statusBadgeClass(p.status);
              return (
              <div
                key={p.fileName}
                className="sidebar-link"
                onClick={() => router.push(href)}
                style={{ cursor: 'pointer', height: 32, minWidth: 0, margin: '0 12px 2px', background: 'var(--panel-soft)', padding: '0 12px' }}
              >
                <span className="sidebar-label" style={{ color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                  {p.client}
                </span>
                {badgeClass && (
                  <span className={badgeClass} style={{ flexShrink: 0, fontSize: 10, fontWeight: 500, background: 'transparent', border: 'none' }}>
                    {statusLabel(p.status)}
                  </span>
                )}
                {p.version != null && (
                  <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 500, padding: '1px 5px', borderRadius: 4, background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid color-mix(in srgb, var(--primary) 30%, transparent)' }}>
                    v{p.version}
                  </span>
                )}
              </div>
              );
            })
          )}
        </Section>

        {/* ── Ingested Files ── */}
        <Section label="Ingested Files" loading={loadingFiles}>
          {files.length === 0 ? (
            <div style={{ padding: '2px 8px 4px 12px' }}>
              <span className="sidebar-label" style={{ opacity: 0.18, fontSize: 13 }}>No files yet</span>
            </div>
          ) : (
            files.map(f => {
              const isHovered = hoveredFile === f.fileName && (menuFile === null || menuFile === f.fileName);
              const isMenuOpen = menuFile === f.fileName;
              const isActive = f.status === 'uploaded' || f.status === 'processing' || f.status === 'extracting';
              return (
                <div
                  key={f.fileName}
                  style={{ position: 'relative' }}
                  onMouseEnter={() => { if (menuFile === null || menuFile === f.fileName) setHoveredFile(f.fileName); }}
                  onMouseLeave={() => setHoveredFile(null)}
                >
                  <div
                    className="sidebar-link"
                    style={{
                      cursor: 'default',
                      height: 32,
                      minWidth: 0,
                      margin: '0 12px 2px',
                      background: isActive ? 'color-mix(in srgb, var(--primary) 12%, var(--panel-soft))' : 'var(--panel-soft)',
                      paddingLeft: 12,
                      paddingRight: isHovered || isMenuOpen ? 36 : 12,
                      transition: 'padding-right 0.15s, background 0.2s ease, color 0.2s ease, transform 0.2s ease',
                    }}
                  >
                    <span className="sidebar-label" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13, color: 'var(--text)' }}>{f.fileName}</span>
                    {f.status === 'processing' && (
                      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 500, color: 'var(--primary)' }}>
                        <Icon icon={Loader2} size="sm" style={{ animation: 'spin 1s linear infinite', width: 10, height: 10 }} />
                        Indexing
                      </span>
                    )}
                    {f.status === 'extracting' && (
                      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 500, color: 'var(--primary)' }}>
                        <Icon icon={Loader2} size="sm" style={{ animation: 'spin 1s linear infinite', width: 10, height: 10 }} />
                        Extracting
                      </span>
                    )}
                    {f.status === 'uploaded' && (
                      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 500, color: 'var(--muted)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--muted)', flexShrink: 0, animation: 'pulse 1.6s ease-in-out infinite' }} />
                        Queued
                      </span>
                    )}
                    {(f.status === 'indexed' || f.status === 'extracted' || f.status === 'failed') && (
                      <span className={`ingestion-badge--${f.status}`} style={{ flexShrink: 0, fontSize: 10, fontWeight: 500, background: 'transparent', border: 'none' }}>
                        {f.status.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <button
                    ref={el => { menuBtnRefs.current[f.fileName] = el; }}
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
                    onClick={e => { e.stopPropagation(); isMenuOpen ? setMenuFile(null) : openFileMenu(f.fileName); }}
                  >
                    <Icon icon={MoreHorizontal} size="sm" />
                  </button>
                </div>
              );
            })
          )}
        </Section>

      </div>
    </aside>

    {/* File options dropdown — portalled to avoid clipping */}
    {menuFile && createPortal(
      <div
        ref={dropdownRef}
        className="card"
        style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, minWidth: 120, padding: '4px 0', zIndex: 99999 }}
      >
        <button
          className="btn btn-sm"
          style={{ width: '100%', textAlign: 'left', borderRadius: 0, border: 'none', justifyContent: 'flex-start', padding: '8px 14px', fontSize: 14, color: 'var(--danger)', gap: 8 }}
          onMouseDown={e => e.preventDefault()}
          onClick={() => { const f = menuFile; setMenuFile(null); setConfirmFile(f); }}
        >
          <Icon icon={Trash2} size="sm" /><span>Delete</span>
        </button>
      </div>,
      document.body,
    )}

    {/* Confirm delete dialog */}
    {confirmFile && createPortal(
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        onMouseDown={e => { if (e.target === e.currentTarget && !deleting) setConfirmFile(null); }}
      >
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px 0' }}>
            <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 16px', lineHeight: 1.5 }}>Delete file</p>
          </div>
          <div style={{ height: 1, background: 'var(--border)' }} />
          <div style={{ padding: 24 }}>
            <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 20, lineHeight: 1.5 }}>
              Delete <strong>"{confirmFile}"</strong> from the knowledge base?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmFile(null)}
                disabled={deleting}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-soft)', color: 'var(--text)', fontSize: 14, cursor: deleting ? 'not-allowed' : 'pointer' }}
              >Cancel</button>
              <button
                onClick={handleDeleteConfirmed}
                disabled={deleting}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--danger)', color: '#fff', fontSize: 14, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.7 : 1 }}
              >{deleting ? 'Deleting…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    )}
  </>
  );
}
