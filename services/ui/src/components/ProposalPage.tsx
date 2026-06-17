'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { X, ChevronDown, Check, MoreHorizontal, Trash2, FileText, Menu, ArrowLeft } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { ThemeToggle } from '@/components/system/ThemeToggle';
import type {
  ProposalDocument,
  ProposalFile,
  ProposalMeta,
  ProposalStatus,
  GenerateProposalRequest,
  SectionDiff,
} from '@/lib/api';
import {
  generateProposal,
  fetchProposals,
  fetchProposalMeta,
  fetchProposalContent,
  saveProposalContent,
  lockSection,
  unlockSection,
  setProposalStatus,
  fetchProposalDiff,
  runAgent,
  deleteProposal,
  aiEditProposal,
} from '@/lib/api';
import { parseProposalSections, reassembleMarkdown, downloadMarkdown } from '@/lib/proposal-utils';
import { useAuth } from '@/lib/auth-context';
import { useNamespace } from '@/lib/namespace-context';
import { useMobileNav } from '@/lib/mobile-nav-store';
import { useExecutionStore } from '@/core/execution/execution-store';
import { useProposalGenerationStore } from '@/core/proposal-generation-store';
import { ProposalForm } from './ProposalForm';
import { ProposalWorkspace, STATUS_LABELS } from './ProposalWorkspace';

const STATUS_ORDER: ProposalStatus[] = ['draft', 'under_review', 'approved', 'finalized'];

const STATUS_COLORS: Record<ProposalStatus, string> = {
  draft: 'var(--muted)',
  under_review: '#f59e0b',
  approved: '#22c55e',
  finalized: '#3b82f6',
};
import { DiffViewer } from './DiffViewer';
import { ProposalAIEditor } from './ProposalAIEditor';
import { ProposalSectionPreview } from './ProposalSectionPreview';

// ── Shared status tag helpers ─────────────────────────────────────

function statusBadgeClass(status: ProposalStatus | null): string | null {
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

function statusLabel(status: ProposalStatus | null): string | null {
  if (!status) return null;
  return status.replace('_', ' ').toUpperCase();
}

// ── Version panel — matches NamespacePanel proposal item style ────

function ProposalVersionPanel({
  refreshKey,
  onSelect,
}: {
  refreshKey: number;
  onSelect?: (file: ProposalFile) => void;
}) {
  const { apiKey } = useAuth();
  const [proposals, setProposals] = useState<ProposalFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProposals(apiKey)
      .then((p) => {
        if (!cancelled) setProposals(p);
      })
      .catch(() => {
        if (!cancelled) setProposals([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey, refreshKey]);

  return (
    <aside className="chat-ctx-panel">
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div
          className="sidebar-link"
          role="button"
          onClick={() => setOpen((v) => !v)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{ cursor: 'pointer', borderRadius: 0, paddingLeft: 12 }}
        >
          <span className="sidebar-label" style={{ flex: 1, opacity: 0.5, fontSize: 13 }}>
            Proposals
          </span>
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

        {open &&
          (loading ? (
            <div style={{ padding: '2px 8px 8px' }}>
              <span className="sidebar-label" style={{ opacity: 0.45, fontSize: 13 }}>
                Loading…
              </span>
            </div>
          ) : proposals.length === 0 ? (
            <div style={{ padding: '2px 8px 4px 12px' }}>
              <span className="sidebar-label" style={{ opacity: 0.18, fontSize: 13 }}>
                No proposals yet
              </span>
            </div>
          ) : (
            <div style={{ padding: '2px 0 4px' }}>
              {proposals.map((p) => {
                const bc = statusBadgeClass(p.status);
                return (
                  <div
                    key={p.fileName}
                    className="sidebar-link"
                    onClick={() => onSelect?.(p)}
                    style={{
                      cursor: onSelect ? 'pointer' : 'default',
                      height: 32,
                      minWidth: 0,
                      margin: '0 12px 2px',
                      background: 'var(--panel-soft)',
                      padding: '0 12px',
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
                    {bc && (
                      <span
                        className={bc}
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
                    {p.version != null && (
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
                        v{p.version}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function nsFromFileName(fileName: string): string {
  return fileName.includes('::') ? fileName.split('::')[0] : '';
}

function proposalHref(p: ProposalFile): string {
  const [ns, ...rest] = p.fileName.split('::');
  const file = rest.join('::') || ns;
  return rest.length
    ? `/proposal?artifact=${encodeURIComponent(file)}&namespace=${encodeURIComponent(ns)}&from=chat`
    : `/proposal?artifact=${encodeURIComponent(file)}&from=chat`;
}

function formatCreatedAt(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const datePart = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const timePart = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${datePart}, ${timePart}`;
}

export function ProposalPage() {
  const { apiKey } = useAuth();
  const { namespaces } = useNamespace();
  const { openMobileNav } = useMobileNav();
  const searchParams = useSearchParams();
  const addExecution = useExecutionStore((s) => s.addExecution);
  const updateExecution = useExecutionStore((s) => s.updateExecution);
  const router = useRouter();
  const fromChat = searchParams.get('from') === 'chat';

  const pending = useProposalGenerationStore((s) => s.pending);
  const startPending = useProposalGenerationStore((s) => s.start);
  const finishPending = useProposalGenerationStore((s) => s.finish);
  const failPending = useProposalGenerationStore((s) => s.fail);
  const clearPending = useProposalGenerationStore((s) => s.clear);

  // ── Browser view state (non-fromChat only) ────────────────────────
  const [allProposals, setAllProposals] = useState<ProposalFile[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseNs, setBrowseNs] = useState('');
  const [nsDropOpen, setNsDropOpen] = useState(false);
  const [nsDropPos, setNsDropPos] = useState({ top: 0, right: 0 });
  const nsBtnRef = useRef<HTMLButtonElement | null>(null);
  const nsDropRef = useRef<HTMLDivElement | null>(null);

  // Card delete state
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [cardMenuProposal, setCardMenuProposal] = useState<ProposalFile | null>(null);
  const [cardMenuPos, setCardMenuPos] = useState({ top: 0, right: 0 });
  const [confirmDeleteProposal, setConfirmDeleteProposal] = useState<ProposalFile | null>(null);
  const [deletingProposal, setDeletingProposal] = useState(false);
  const cardMenuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const cardDropdownRef = useRef<HTMLDivElement | null>(null);
  const [currentDocument, setCurrentDocument] = useState<ProposalDocument | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [lastRequest, setLastRequest] = useState<GenerateProposalRequest | null>(null);
  const [regeneratingSection, setRegeneratingSection] = useState<string | null>(null);
  const [regenError, setRegenError] = useState('');

  // Workflow state
  const [meta, setMeta] = useState<ProposalMeta | null>(null);
  const proposalName = (() => {
    const raw =
      ((currentDocument?.metadata as Record<string, unknown>)?.client as string | undefined) ??
      searchParams.get('artifact') ??
      'Proposals';
    // Strip leading timestamp prefix e.g. "2026-06-11T08-17-45-", replace hyphens with spaces, capitalize first letter
    const stripped = raw.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, '').replace(/-/g, ' ');
    return stripped.charAt(0).toUpperCase() + stripped.slice(1);
  })();
  const currentStatus = meta?.status ?? 'draft';
  const totalSections = useMemo(() => {
    if (!currentDocument) return 0;
    const retried = ((currentDocument.metadata as Record<string, unknown>).retried_sections as string[]) ?? [];
    return parseProposalSections(currentDocument.content, retried).sections.length;
  }, [currentDocument]);

  // Exclude proposals from namespaces that no longer exist.
  // Super-client proposals (sc- prefix) are always shown — they live under
  // super-clients/, not namespaces/, so they never appear in the namespaces list.
  const knownProposals = useMemo(
    () =>
      namespaces.length === 0
        ? allProposals
        : allProposals.filter((p) => {
            const ns = nsFromFileName(p.fileName);
            return !ns || ns.startsWith('sc-') || namespaces.includes(ns);
          }),
    [allProposals, namespaces],
  );

  const nsCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    knownProposals.forEach((p) => {
      const ns = nsFromFileName(p.fileName);
      if (ns) counts[ns] = (counts[ns] ?? 0) + 1;
    });
    return counts;
  }, [knownProposals]);

  const filteredProposals = useMemo(() => {
    const list = browseNs ? knownProposals.filter((p) => p.fileName.startsWith(`${browseNs}::`)) : knownProposals;
    return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [knownProposals, browseNs]);

  useEffect(() => {
    if (fromChat) return;
    setBrowseLoading(true);
    fetchProposals(apiKey)
      .then(setAllProposals)
      .catch(() => setAllProposals([]))
      .finally(() => setBrowseLoading(false));
  }, [apiKey, fromChat, refreshKey]);

  // When proposals list refreshes, clear the pending card if the proposal landed
  useEffect(() => {
    if (fromChat || !pending || pending.status !== 'generating') return;
    const found = allProposals.some(
      (p) =>
        p.client.toLowerCase() === pending.client.toLowerCase() &&
        (!pending.namespace || p.fileName.startsWith(`${pending.namespace}::`)),
    );
    if (found) finishPending();
  }, [allProposals, pending, fromChat, finishPending]);

  useEffect(() => {
    if (!nsDropOpen) return;
    function handle(e: MouseEvent) {
      if (nsDropRef.current && !nsDropRef.current.contains(e.target as Node)) {
        setNsDropOpen(false);
      }
    }
    window.document.addEventListener('mousedown', handle);
    return () => window.document.removeEventListener('mousedown', handle);
  }, [nsDropOpen]);

  function openNsDropdown() {
    if (nsDropOpen) {
      setNsDropOpen(false);
      return;
    }
    const rect = nsBtnRef.current?.getBoundingClientRect();
    if (rect) setNsDropPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setNsDropOpen(true);
  }

  // Card overflow menu — close on outside click
  useEffect(() => {
    if (!cardMenuProposal) return;
    const handler = (e: MouseEvent) => {
      const btn = cardMenuBtnRefs.current[cardMenuProposal.fileName];
      if (
        cardDropdownRef.current &&
        !cardDropdownRef.current.contains(e.target as Node) &&
        btn &&
        !btn.contains(e.target as Node)
      )
        setCardMenuProposal(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [cardMenuProposal]);

  async function handleDeleteProposalConfirmed() {
    if (!confirmDeleteProposal) return;
    const p = confirmDeleteProposal;
    const parts = p.fileName.split('::');
    const ns = parts.length > 1 ? parts[0] : '';
    const file = parts.length > 1 ? parts.slice(1).join('::') : parts[0];
    setDeletingProposal(true);
    try {
      await deleteProposal(apiKey, ns, file);
      setRefreshKey((k) => k + 1);
    } catch {
      /* ignore */
    } finally {
      setDeletingProposal(false);
      setConfirmDeleteProposal(null);
    }
  }

  // Status selector dropdown
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusMenuPos, setStatusMenuPos] = useState({ top: 0, right: 0 });
  const statusBtnRef = useRef<HTMLButtonElement | null>(null);
  const statusDropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!statusOpen) return;
    function handle(e: MouseEvent) {
      if (statusDropRef.current && !statusDropRef.current.contains(e.target as Node)) {
        setStatusOpen(false);
      }
    }
    window.document.addEventListener('mousedown', handle);
    return () => window.document.removeEventListener('mousedown', handle);
  }, [statusOpen]);

  function openStatusMenu() {
    if (statusOpen) {
      setStatusOpen(false);
      return;
    }
    const rect = statusBtnRef.current?.getBoundingClientRect();
    if (rect) setStatusMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setStatusOpen(true);
  }

  // Overflow menu
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowMenuPos, setOverflowMenuPos] = useState({ top: 0, right: 0 });
  const overflowBtnRef = useRef<HTMLButtonElement | null>(null);
  const overflowDropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!overflowOpen) return;
    function handle(e: MouseEvent) {
      if (overflowDropRef.current && !overflowDropRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    }
    window.document.addEventListener('mousedown', handle);
    return () => window.document.removeEventListener('mousedown', handle);
  }, [overflowOpen]);

  function openOverflow() {
    if (overflowOpen) {
      setOverflowOpen(false);
      return;
    }
    const rect = overflowBtnRef.current?.getBoundingClientRect();
    if (rect) setOverflowMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOverflowOpen(true);
  }

  // Collapsed sections (lifted from ProposalWorkspace)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const allCollapsed = totalSections > 0 && collapsedSections.size === totalSections;

  function expandAll() {
    setCollapsedSections(new Set());
  }

  function collapseAll() {
    if (!currentDocument) return;
    const retried = ((currentDocument.metadata as Record<string, unknown>).retried_sections as string[]) ?? [];
    const { sections } = parseProposalSections(currentDocument.content, retried);
    setCollapsedSections(new Set(sections.map((s) => s.title)));
  }

  function toggleSection(title: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  function handleDownload() {
    if (!currentDocument) return;
    const client = ((currentDocument.metadata as Record<string, unknown>).client as string) ?? 'proposal';
    downloadMarkdown(currentDocument.content, client);
  }

  const [showDiff, setShowDiff] = useState(false);
  const [diffData, setDiffData] = useState<SectionDiff[]>([]);
  const [workflowError, setWorkflowError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sentinelEl) return;
    const observer = new IntersectionObserver(([entry]) => setHeaderScrolled(!entry.isIntersecting), { threshold: 0 });
    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [sentinelEl]);

  useEffect(() => {
    if (!showGenerateModal || isGenerating) return;
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowGenerateModal(false);
    }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [showGenerateModal, isGenerating]);

  // AI rewrite state
  const [aiEditingSection, setAiEditingSection] = useState<string | null>(null);
  const [isAIRewriting, setIsAIRewriting] = useState(false);
  const [showGlobalAIEditor, setShowGlobalAIEditor] = useState(false);
  const [isGlobalAIEditing, setIsGlobalAIEditing] = useState(false);
  const [aiPreview, setAiPreview] = useState<{
    section: string;
    original: string;
    rewritten: string;
  } | null>(null);

  // Auto-load proposal from URL query params (?artifact=...&namespace=...)
  useEffect(() => {
    const artifact = searchParams.get('artifact');
    if (!artifact || !apiKey) return;
    const ns = searchParams.get('namespace');
    const fileKey = ns ? `${ns}::${artifact}` : artifact;
    setIsLoadingDocument(true);
    setCurrentDocument(null);
    setMeta(null);
    fetchProposalContent(apiKey, fileKey)
      .then((doc) => {
        setCurrentDocument(doc);
        return fetchProposalMeta(apiKey, fileKey).catch(() => null);
      })
      .then((m) => {
        if (m) setMeta(m);
      })
      .catch(() => {})
      .finally(() => setIsLoadingDocument(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, searchParams]);

  // Derive the current proposal file name from document metadata.
  // Returns "namespace::filename.md" for namespace-scoped proposals so the API
  // can resolve the correct path — otherwise returns the plain filename.
  function currentFileName(): string | null {
    if (!currentDocument) return null;
    const meta = currentDocument.metadata as Record<string, unknown>;
    const outputFile = (meta.output_file ?? meta.output_path) as string | undefined;
    if (!outputFile) return null;
    // Normalise separators and split into parts
    const parts = outputFile.replace(/\\/g, '/').split('/');
    const fileName = parts.pop() ?? null;
    if (!fileName) return null;
    // Detect namespace: path ends with …/namespaces/<ns>/proposals/<file>
    const proposalsIdx = parts.lastIndexOf('proposals');
    if (proposalsIdx > 0) {
      const ns = parts[proposalsIdx - 1];
      if (ns && ns !== 'namespaces') {
        const isSuperClient = proposalsIdx > 1 && parts[proposalsIdx - 2] === 'super-clients';
        return `${isSuperClient ? 'sc-' : ''}${ns}::${fileName}`;
      }
    }
    return fileName;
  }

  async function handleGenerate(doc: ProposalDocument, request: GenerateProposalRequest) {
    setCurrentDocument(doc);
    setLastRequest(request);
    setRegeneratingSection(null);
    setRegenError('');
    setWorkflowError('');
    setRefreshKey((k) => k + 1);

    // Fetch metadata for the generated document
    const fileName = extractFileName(doc);
    if (fileName) {
      try {
        const m = await fetchProposalMeta(apiKey, fileName);
        setMeta(m);
      } catch {
        setMeta(null);
      }
    }
  }

  function extractFileName(doc: ProposalDocument): string | null {
    const meta = doc.metadata as Record<string, unknown>;
    const outputFile = (meta.output_file ?? meta.output_path) as string | undefined;
    if (!outputFile) return null;
    return outputFile.split(/[\\/]/).pop() ?? null;
  }

  async function handleRegenerateAll() {
    if (!lastRequest || isGenerating) return;
    const execId = crypto.randomUUID();
    setIsGenerating(true);
    setRegeneratingSection(null);
    setRegenError('');
    setWorkflowError('');
    addExecution({ id: execId, type: 'proposal', status: 'running', title: lastRequest.client });
    try {
      const doc = await generateProposal(apiKey, lastRequest);
      setCurrentDocument(doc);
      setRefreshKey((k) => k + 1);

      const fileName = extractFileName(doc);
      if (fileName) {
        try {
          const m = await fetchProposalMeta(apiKey, fileName);
          setMeta(m);
        } catch {
          /* keep existing meta */
        }
      }
      updateExecution(execId, { status: 'completed' });
    } catch (err) {
      setRegenError((err as Error).message);
      updateExecution(execId, { status: 'failed', errorMessage: (err as Error).message });
    } finally {
      setIsGenerating(false);
      setRegeneratingSection(null);
    }
  }

  async function handleRegenerateSection(sectionTitle: string, instruction = '') {
    if (!currentDocument || !lastRequest || isGenerating) return;
    setIsGenerating(true);
    setRegeneratingSection(sectionTitle);
    setRegenError('');
    setWorkflowError('');

    try {
      const namespace = lastRequest.namespace ?? '';
      const result = await runAgent(apiKey, {
        agent: 'proposal-section',
        namespace,
        input: {
          metadata: {
            proposalMarkdown: currentDocument.content,
            sectionName: sectionTitle,
            instruction: instruction || 'Rewrite this section to be clear, concise, and professional.',
          },
        },
      });

      const regeneratedSection = result.markdown ?? '';

      // Replace the section in the current document and save
      const parsed = parseProposalSections(currentDocument.content, []);
      const updated = parsed.sections.map((s) =>
        s.title === sectionTitle ? { ...s, content: stripHeading(regeneratedSection, sectionTitle) } : s,
      );
      const newMarkdown = reassembleMarkdown(parsed.header, updated);

      const fileName = currentFileName();
      if (fileName) {
        await saveProposalContent(apiKey, fileName, newMarkdown);
      }

      setCurrentDocument({ ...currentDocument, content: newMarkdown });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setRegenError((err as Error).message);
    } finally {
      setIsGenerating(false);
      setRegeneratingSection(null);
    }
  }

  /**
   * Strip the leading "## SectionTitle" heading from regenerated section
   * markdown if present, since we re-add it when reassembling.
   */
  function stripHeading(markdown: string, sectionTitle: string): string {
    const headingPattern = new RegExp(`^##\\s+${escapeRegex(sectionTitle)}\\s*\\n?`, 'i');
    return markdown.replace(headingPattern, '').trim();
  }

  function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async function handleGlobalAIEdit(instruction: string) {
    if (!currentDocument) return;
    setIsGlobalAIEditing(true);
    setRegenError('');
    setShowGlobalAIEditor(false);
    try {
      const fileName = currentFileName();
      if (!fileName) return;
      const updated = await aiEditProposal(apiKey, fileName, instruction);
      await saveProposalContent(apiKey, fileName, updated);
      setCurrentDocument({ ...currentDocument, content: updated });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setRegenError((err as Error).message);
    } finally {
      setIsGlobalAIEditing(false);
    }
  }

  function handleOpenAIEditor(sectionTitle: string) {
    if (isGenerating || isAIRewriting) return;
    setAiEditingSection(sectionTitle);
    setRegenError('');
    setWorkflowError('');
  }

  async function handleAIGenerate(instruction: string) {
    if (!currentDocument || !aiEditingSection) return;
    setIsAIRewriting(true);
    setRegenError('');

    try {
      const namespace =
        lastRequest?.namespace ??
        ((currentDocument.metadata as Record<string, unknown>).client as string | undefined) ??
        '';
      const result = await runAgent(apiKey, {
        agent: 'proposal-section',
        namespace,
        input: {
          metadata: {
            proposalMarkdown: currentDocument.content,
            sectionName: aiEditingSection,
            instruction,
          },
        },
      });

      const rewritten = stripHeading(result.markdown ?? '', aiEditingSection);

      // Find original content for preview
      const parsed = parseProposalSections(currentDocument.content, []);
      const originalSection = parsed.sections.find((s) => s.title === aiEditingSection);

      setAiPreview({
        section: aiEditingSection,
        original: originalSection?.content ?? '',
        rewritten,
      });
      setAiEditingSection(null);
    } catch (err) {
      setRegenError((err as Error).message);
      setAiEditingSection(null);
    } finally {
      setIsAIRewriting(false);
    }
  }

  async function handleAcceptRewrite() {
    if (!aiPreview || !currentDocument) return;
    setIsSaving(true);
    setWorkflowError('');

    try {
      const parsed = parseProposalSections(currentDocument.content, []);
      const updated = parsed.sections.map((s) =>
        s.title === aiPreview.section ? { ...s, content: aiPreview.rewritten } : s,
      );
      const newMarkdown = reassembleMarkdown(parsed.header, updated);

      const fileName = currentFileName();
      if (fileName) {
        await saveProposalContent(apiKey, fileName, newMarkdown);
      }

      setCurrentDocument({ ...currentDocument, content: newMarkdown });
      setRefreshKey((k) => k + 1);
      setAiPreview(null);
    } catch (err) {
      setWorkflowError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleLock(sectionTitle: string) {
    const fileName = currentFileName();
    if (!fileName || !meta) return;
    setWorkflowError('');

    try {
      const isLocked = meta.lockedSections.includes(sectionTitle);
      const updated = isLocked
        ? await unlockSection(apiKey, fileName, sectionTitle)
        : await lockSection(apiKey, fileName, sectionTitle);
      setMeta(updated);
    } catch (err) {
      setWorkflowError((err as Error).message);
    }
  }

  async function handleSetStatus(status: ProposalStatus) {
    const fileName = currentFileName();
    if (!fileName) return;
    setWorkflowError('');

    try {
      const updated = await setProposalStatus(apiKey, fileName, status);
      setMeta(updated);
    } catch (err) {
      setWorkflowError((err as Error).message);
    }
  }

  function handleGenerateMicrosite() {
    if (!currentDocument) return;
    const fileName = currentFileName();
    const ns = fileName?.includes('::') ? fileName.split('::')[0] : '';
    const m = currentDocument.metadata as Record<string, unknown>;
    const proposalFile: ProposalFile = {
      fileName: fileName ?? '',
      client: proposalName ?? '',
      version: (m.version as number | null) ?? null,
      createdAt: (m.created_at as string | undefined) ?? new Date().toISOString(),
      sizeBytes: 0,
      status: currentStatus,
      lockedSections: meta?.lockedSections ?? [],
    };
    try {
      sessionStorage.setItem(
        'ms_wizard_state',
        JSON.stringify({
          step: 'upload',
          lockedFromProposal: true,
          wasGenerating: false,
          progress: [],
          streamingSections: [],
          error: null,
          selectedNamespace: ns,
          selectedProposal: proposalFile,
        }),
      );
      if (ns) localStorage.setItem('ms_namespace', ns);
    } catch {
      /* ignore */
    }
    router.push('/presentation');
  }

  async function handleSelectHistory(file: ProposalFile) {
    setWorkflowError('');
    setRegenError('');
    try {
      const doc = await fetchProposalContent(apiKey, file.fileName);
      setCurrentDocument(doc);
      setLastRequest(null);
      setRegeneratingSection(null);
      const m = await fetchProposalMeta(apiKey, file.fileName).catch(() => null);
      setMeta(m);
    } catch (err) {
      setWorkflowError((err as Error).message);
    }
  }

  async function handleShowDiff() {
    if (!currentDocument) return;
    setWorkflowError('');

    const fileName = currentFileName();
    if (!fileName) {
      setWorkflowError('Cannot determine current file for diff');
      return;
    }

    // Try to find the previous version by decrementing version number
    const match = fileName.match(/^(.+)_proposal(?:_v(\d+))?\.md$/);
    if (!match) {
      setWorkflowError('Cannot determine version for diff');
      return;
    }

    const base = match[1];
    const currentVersion = match[2] ? parseInt(match[2], 10) : null;

    let prevFileName: string;
    if (currentVersion === null || currentVersion <= 1) {
      // No previous version to compare
      setWorkflowError('No previous version available for comparison');
      return;
    } else if (currentVersion === 2) {
      prevFileName = `${base}_proposal.md`;
    } else {
      prevFileName = `${base}_proposal_v${currentVersion - 1}.md`;
    }

    try {
      const diffs = await fetchProposalDiff(apiKey, prevFileName, fileName);
      setDiffData(diffs);
      setShowDiff(true);
    } catch (err) {
      setWorkflowError((err as Error).message);
    }
  }

  async function handleSaveSection(sectionTitle: string, newContent: string) {
    const fileName = currentFileName();
    if (!fileName || !currentDocument) return;
    setWorkflowError('');
    setIsSaving(true);

    try {
      const retried =
        ((currentDocument.metadata as Record<string, unknown>).retried_sections as string[] | undefined) ?? [];
      const parsed = parseProposalSections(currentDocument.content, retried);

      // Replace the edited section's content
      const updatedSections = parsed.sections.map((s) =>
        s.title === sectionTitle ? { ...s, content: newContent } : s,
      );
      const fullMarkdown = reassembleMarkdown(parsed.header, updatedSections);

      await saveProposalContent(apiKey, fileName, fullMarkdown);

      // Update local state with the new content
      setCurrentDocument({
        ...currentDocument,
        content: fullMarkdown,
      });
    } catch (err) {
      setWorkflowError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <div className="chat-v2">
        <div className="chat-v2-center">
          {fromChat && (
            <header className={`chat-v2-header proposal-page-header${headerScrolled ? ' chat-v2-header--scrolled' : ''}`}>
              {/* ── Workspace header ── */}
              <div className="chat-v2-header-left">
                <button className="topbar-hamburger" onClick={openMobileNav} aria-label="Open navigation">
                  <Icon icon={Menu} size="md" />
                </button>
                <button className="proposal-mobile-back-btn" onClick={() => router.back()} aria-label="Back to proposals">
                  <ArrowLeft size={16} />
                </button>
                <div className="proposal-header-meta" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="chat-v2-ns" style={{ lineHeight: 1 }}>
                    {proposalName}
                  </span>
                  {currentDocument &&
                    (() => {
                      const raw = meta?.createdAt ?? currentDocument.createdAt;
                      const label = raw ? formatCreatedAt(raw) : null;
                      return label ? (
                        <>
                          <span className="proposal-header-sep" style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1 }}>·</span>
                          <span className="proposal-header-date" style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1 }}>{label}</span>
                        </>
                      ) : null;
                    })()}
                  {currentDocument && (
                    <>
                      <span className="proposal-header-sep proposal-header-extra" style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1 }}>·</span>
                      <span className="workspace-stat proposal-header-extra">
                        {totalSections} section{totalSections !== 1 ? 's' : ''}
                      </span>
                    </>
                  )}
                  {searchParams.get('namespace') && (
                    <>
                      <span className="proposal-header-sep proposal-header-extra" style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1 }}>·</span>
                      <span className="proposal-header-extra" style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1 }}>
                        {searchParams.get('namespace')}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="chat-v2-header-right">
                <button
                  style={{
                    height: 30,
                    padding: '0 12px',
                    whiteSpace: 'nowrap',
                    background: 'var(--panel-soft)',
                    color: 'var(--muted)',
                    border: 'none',
                    borderRadius: 'var(--radius)',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: currentDocument && !isGlobalAIEditing ? 'pointer' : 'not-allowed',
                    flexShrink: 0,
                    opacity: currentDocument && !isGlobalAIEditing ? 1 : 0.45,
                  }}
                  disabled={!currentDocument || isGlobalAIEditing || isGenerating}
                  onClick={() => setShowGlobalAIEditor(true)}
                >
                  {isGlobalAIEditing ? 'Editing…' : 'Edit with AI'}
                </button>
                {/* <button
                  style={{
                    height: 30,
                    padding: '0 12px',
                    whiteSpace: 'nowrap',
                    background:
                      currentDocument && currentStatus === 'approved' ? 'var(--primary)' : 'var(--panel-soft)',
                    color: currentDocument && currentStatus === 'approved' ? '#fff' : 'var(--muted)',
                    border: 'none',
                    borderRadius: 'var(--radius)',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: currentDocument && currentStatus === 'approved' ? 'pointer' : 'not-allowed',
                    flexShrink: 0,
                    opacity: currentDocument && currentStatus === 'approved' ? 1 : 0.45,
                  }}
                  disabled={!currentDocument || currentStatus !== 'approved' || isGenerating}
                  onClick={handleGenerateMicrosite}
                >
                  Generate Microsite
                </button> */}
                <button
                  ref={statusBtnRef}
                  onClick={openStatusMenu}
                  disabled={!currentDocument}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    height: 30,
                    padding: '0 10px',
                    background: 'var(--panel-soft)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: currentDocument ? 'pointer' : 'not-allowed',
                    color: 'var(--text)',
                    opacity: currentDocument ? 1 : 0.4,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: STATUS_COLORS[currentStatus],
                      flexShrink: 0,
                    }}
                  />
                  {STATUS_LABELS[currentStatus]}
                  <Icon icon={ChevronDown} size="sm" style={{ color: 'var(--muted)', marginLeft: 2 }} />
                </button>
                <button
                  ref={overflowBtnRef}
                  className="chat-v2-panel-toggle"
                  onClick={openOverflow}
                  title="More options"
                  aria-label="More options"
                >
                  <Icon icon={MoreHorizontal} size="sm" />
                </button>
                <button className="chat-v2-panel-toggle" onClick={() => router.back()} title="Close" aria-label="Close">
                  <Icon icon={X} size="sm" />
                </button>
              </div>
            </header>
          )}

          {fromChat ? (
            /* ── Workspace body ── */
            <div
              key={searchParams.get('artifact') ?? 'workspace'}
              className="proposal-view-fadein"
              style={{ flex: 1, overflowY: 'auto' }}
            >
              <div ref={setSentinelEl} style={{ height: 0, flexShrink: 0 }} />
              {isLoadingDocument ? (
                <div className="page-container page-container--narrow">
                  <div className="proposal-doc-skeleton">
                    <div className="proposal-doc-skeleton-header" />
                    <div className="proposal-doc-skeleton-section" />
                    <div className="proposal-doc-skeleton-section" />
                    <div className="proposal-doc-skeleton-section" style={{ width: '70%' }} />
                  </div>
                </div>
              ) : (
                <div className="page-container page-container--narrow">
                  {(regenError || workflowError) && <p className="error">{regenError || workflowError}</p>}
                  <ProposalWorkspace
                    document={currentDocument}
                    isGenerating={isGenerating}
                    regeneratingSection={regeneratingSection}
                    meta={meta}
                    onRegenerateAll={handleRegenerateAll}
                    onRegenerateSection={handleRegenerateSection}
                    onImproveWithAI={handleOpenAIEditor}
                    onToggleLock={handleToggleLock}
                    onShowDiff={handleShowDiff}
                    onSaveSection={handleSaveSection}
                    isSaving={isSaving}
                    collapsedSections={collapsedSections}
                    onToggleSection={toggleSection}
                  />
                </div>
              )}
            </div>
          ) : (
            /* ── Browser body: proposal card grid ── */
            <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
              {/* Mobile-only fixed header */}
              <div className="page-list-mobile-header">
                <button className="topbar-hamburger" onClick={openMobileNav} aria-label="Open navigation">
                  <Icon icon={Menu} size="md" />
                </button>
                <span className="page-list-mobile-title">Proposals</span>
                <div style={{ flex: 1 }} />
                <ThemeToggle />
              </div>

              <div
                className="page-theme-toggle-corner"
                style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}
              >
                <ThemeToggle />
              </div>
              {/* Inline browser header + content — constrained to 860 like Microsites */}
              <div className="page-list-content" style={{ maxWidth: 860, margin: '0 auto', padding: '59px 24px 0' }}>
                <div className="page-list-inline-header" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 14 }}>
                  <button className="topbar-hamburger" onClick={openMobileNav} aria-label="Open navigation">
                    <Icon icon={Menu} size="md" />
                  </button>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginRight: 'auto' }}>
                    Proposals
                  </span>
                  {/* Namespace filter */}
                  <button
                    ref={nsBtnRef}
                    onClick={openNsDropdown}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      height: 30,
                      padding: '0 10px',
                      background: 'var(--panel-soft)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer',
                      color: 'var(--text)',
                      flexShrink: 0,
                    }}
                  >
                    {browseNs ? `${browseNs} (${nsCounts[browseNs] ?? 0})` : `All (${knownProposals.length})`}
                    <Icon icon={ChevronDown} size="sm" style={{ color: 'var(--muted)', marginLeft: 2 }} />
                  </button>
                  {/* Generate Proposal */}
                  {/* <button
                  onClick={() => setShowGenerateModal(true)}
                  disabled={isGenerating || pending?.status === 'generating'}
                  style={{
                    height: 30, padding: '0 14px',
                    background: 'var(--primary)', color: '#fff',
                    border: 'none', borderRadius: 'var(--radius)',
                    fontSize: 13, fontWeight: 500,
                    cursor: isGenerating || pending?.status === 'generating' ? 'not-allowed' : 'pointer',
                    opacity: isGenerating || pending?.status === 'generating' ? 0.55 : 1,
                    flexShrink: 0, whiteSpace: 'nowrap',
                  }}
                >
                  + Generate Proposal
                </button> */}
                </div>
                <div className="page-list-divider" style={{ height: 1, background: 'var(--border)', marginBottom: 24 }} />

                {browseLoading && !pending ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: 240,
                      color: 'var(--muted)',
                      fontSize: 14,
                    }}
                  >
                    Loading…
                  </div>
                ) : filteredProposals.length === 0 && !pending ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: 240,
                      padding: '40px 20px',
                    }}
                  >
                    <div style={{ maxWidth: 320, textAlign: 'center' }}>
                      <FileText size={40} strokeWidth={1.5} style={{ color: 'var(--subtle)', marginBottom: 14 }} />
                      <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', margin: 0 }}>No proposals yet</p>
                      <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6, marginBottom: 0 }}>
                        Create your first one to get started.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>

              {(!browseLoading || pending) && (filteredProposals.length > 0 || !!pending) && (
                <div className="proposal-cards-grid">
                  {/* Pending / generating card — always first */}
                  {pending && (!browseNs || !pending.namespace || browseNs === pending.namespace) && (
                    <div
                      className={`proposal-card proposal-card--generating${pending.status === 'failed' ? ' proposal-card--gen-failed' : ''}`}
                    >
                      <div className="proposal-card-header">
                        <span className="proposal-card-name">{pending.client}</span>
                        {pending.status === 'failed' ? (
                          <button
                            onClick={clearPending}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              color: 'var(--muted)',
                              padding: 2,
                              display: 'flex',
                              alignItems: 'center',
                              flexShrink: 0,
                            }}
                            aria-label="Dismiss"
                          >
                            <Icon icon={X} size="sm" />
                          </button>
                        ) : (
                          <span className="proposal-card-gen-dots">
                            <span />
                            <span />
                            <span />
                          </span>
                        )}
                      </div>
                      <div className="proposal-card-footer">
                        <div className="proposal-card-meta">
                          {pending.namespace && <span className="proposal-card-ns">{pending.namespace}</span>}
                          {pending.namespace && <span style={{ color: 'var(--border)' }}>·</span>}
                          {pending.status === 'failed' ? (
                            <span style={{ fontSize: 12, color: 'var(--danger)' }}>
                              {pending.error ?? 'Generation failed'}
                            </span>
                          ) : (
                            <span className="proposal-card-date" style={{ color: 'var(--primary)', fontWeight: 500 }}>
                              Building proposal…
                            </span>
                          )}
                        </div>
                        {pending.status !== 'failed' && <span className="proposal-card-gen-spinner" />}
                      </div>
                    </div>
                  )}

                  {filteredProposals.map((p) => {
                    const ns = nsFromFileName(p.fileName);
                    const dateLabel = formatCreatedAt(p.createdAt);
                    const href = proposalHref(p);
                    const isHovered = hoveredCard === p.fileName;
                    return (
                      <div
                        key={p.fileName}
                        className="proposal-card"
                        style={{ position: 'relative' }}
                        onMouseEnter={() => setHoveredCard(p.fileName)}
                        onMouseLeave={() => setHoveredCard(null)}
                      >
                        <button
                          ref={(el) => {
                            cardMenuBtnRefs.current[p.fileName] = el;
                          }}
                          className="btn btn-sm"
                          title="Options"
                          onClick={(e) => {
                            e.stopPropagation();
                            const btn = cardMenuBtnRefs.current[p.fileName];
                            if (!btn) return;
                            const rect = btn.getBoundingClientRect();
                            setCardMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                            setCardMenuProposal(p);
                          }}
                          style={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            padding: '1px 5px',
                            border: 'none',
                            lineHeight: 1,
                            opacity: isHovered || cardMenuProposal?.fileName === p.fileName ? 1 : 0,
                            pointerEvents: isHovered || cardMenuProposal?.fileName === p.fileName ? 'auto' : 'none',
                            transition: 'opacity 0.15s',
                            zIndex: 1,
                          }}
                        >
                          <Icon icon={MoreHorizontal} size="sm" />
                        </button>
                        <div className="proposal-card-header">
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <span className="proposal-card-eyebrow">Proposal</span>
                            <span className="proposal-card-name">{p.client}</span>
                            {dateLabel && (
                              <span
                                style={{
                                  display: 'block',
                                  fontSize: 12,
                                  color: 'var(--muted)',
                                  marginTop: 3,
                                  lineHeight: 1.4,
                                }}
                              >
                                {dateLabel}
                              </span>
                            )}
                            {p.status && statusBadgeClass(p.status) && (
                              <span
                                className={statusBadgeClass(p.status)!}
                                style={{
                                  display: 'inline-block',
                                  marginTop: 4,
                                  fontSize: 10,
                                  fontWeight: 500,
                                  background: 'transparent',
                                  border: 'none',
                                  padding: 0,
                                }}
                              >
                                {statusLabel(p.status)}
                              </span>
                            )}
                          </div>
                          {p.version != null && (
                            <span
                              style={{
                                flexShrink: 0,
                                alignSelf: 'flex-start',
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
                              v{p.version}
                            </span>
                          )}
                        </div>
                        <div className="proposal-card-footer">
                          {ns ? (
                            <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1 }}>{ns}</span>
                          ) : (
                            <span />
                          )}
                          <button className="chat-v2-clear-btn" onClick={() => router.push(href)}>
                            View
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Namespace dropdown (portalled, browser mode only) */}
      {nsDropOpen &&
        createPortal(
          <div
            ref={nsDropRef}
            className="card"
            style={{
              position: 'fixed',
              top: nsDropPos.top,
              right: nsDropPos.right,
              minWidth: 180,
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
                setBrowseNs('');
                setNsDropOpen(false);
              }}
            >
              <span style={{ flex: 1 }}>All</span>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>{knownProposals.length}</span>
              {!browseNs && <Icon icon={Check} size="sm" style={{ color: 'var(--primary)', flexShrink: 0 }} />}
            </button>
            {namespaces.length > 0 && <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />}
            {namespaces.map((ns) => (
              <button
                key={ns}
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
                  setBrowseNs(ns);
                  setNsDropOpen(false);
                }}
              >
                <span style={{ flex: 1 }}>{ns}</span>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>{nsCounts[ns] ?? 0}</span>
                {browseNs === ns && <Icon icon={Check} size="sm" style={{ color: 'var(--primary)', flexShrink: 0 }} />}
              </button>
            ))}
          </div>,
          window.document.body,
        )}

      {/* Overflow menu (portalled) */}
      {overflowOpen &&
        createPortal(
          <div
            ref={overflowDropRef}
            className="card"
            style={{
              position: 'fixed',
              top: overflowMenuPos.top,
              right: overflowMenuPos.right,
              minWidth: 180,
              padding: '4px 0',
              zIndex: 99999,
            }}
          >
            {fromChat && (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
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
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    allCollapsed ? expandAll() : collapseAll();
                    setOverflowOpen(false);
                  }}
                >
                  {allCollapsed ? 'Expand All' : 'Collapse All'}
                </button>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
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
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    handleShowDiff();
                    setOverflowOpen(false);
                  }}
                >
                  Compare Versions
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
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    handleDownload();
                    setOverflowOpen(false);
                  }}
                >
                  Download .md
                </button>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
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
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    handleRegenerateAll();
                    setOverflowOpen(false);
                  }}
                  disabled={isGenerating || meta?.status === 'finalized'}
                >
                  {isGenerating ? 'Regenerating…' : 'Regenerate All'}
                </button>
              </>
            )}
          </div>,
          window.document.body,
        )}

      {/* Generate Proposal modal (portalled) */}
      {showGenerateModal &&
        createPortal(
          <div
            className="generate-proposal-overlay"
            onClick={() => {
              if (!isGenerating) setShowGenerateModal(false);
            }}
          >
            <div className="generate-proposal-modal" onClick={(e) => e.stopPropagation()}>
              <div className="generate-proposal-header">
                <h3>Generate Proposal</h3>
                <button
                  className="chat-v2-panel-toggle"
                  onClick={() => setShowGenerateModal(false)}
                  disabled={isGenerating}
                  aria-label="Close"
                >
                  <Icon icon={X} size="sm" />
                </button>
              </div>
              <div className="generate-proposal-body">
                <ProposalForm
                  modalMode
                  onGenerateStart={(req) => {
                    startPending(req.client, req.namespace ?? '');
                    if (req.namespace) setBrowseNs(req.namespace);
                    setShowGenerateModal(false);
                  }}
                  onGenerate={(doc, req) => {
                    handleGenerate(doc, req);
                  }}
                  onGenerateFail={(err) => {
                    failPending(err);
                  }}
                  isGenerating={isGenerating}
                  setIsGenerating={setIsGenerating}
                />
              </div>
              <div className="generate-proposal-footer">
                <button
                  form="generate-proposal-form"
                  type="submit"
                  className="btn btn-sm btn-primary"
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <span className="spinner" style={{ width: 12, height: 12 }} /> Generating...
                    </>
                  ) : (
                    'Generate Proposal'
                  )}
                </button>
              </div>
            </div>
          </div>,
          window.document.body,
        )}

      {/* Status dropdown (portalled) */}
      {statusOpen &&
        createPortal(
          <div
            ref={statusDropRef}
            className="card"
            style={{
              position: 'fixed',
              top: statusMenuPos.top,
              right: statusMenuPos.right,
              minWidth: 170,
              padding: '4px 0',
              zIndex: 99999,
            }}
          >
            {STATUS_ORDER.map((s) => {
              const isCurrent = s === currentStatus;
              return (
                <button
                  key={s}
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
                    opacity: isCurrent ? 0.5 : 1,
                    cursor: isCurrent ? 'default' : 'pointer',
                  }}
                  disabled={isCurrent}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    handleSetStatus(s);
                    setStatusOpen(false);
                  }}
                >
                  <span
                    style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLORS[s], flexShrink: 0 }}
                  />
                  <span style={{ flex: 1 }}>{STATUS_LABELS[s]}</span>
                  {isCurrent && <Icon icon={Check} size="sm" style={{ color: 'var(--primary)', flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>,
          window.document.body,
        )}

      {showDiff && <DiffViewer diffs={diffData} onClose={() => setShowDiff(false)} />}

      {showGlobalAIEditor && (
        <ProposalAIEditor
          mode="global"
          sectionTitle=""
          onGenerate={handleGlobalAIEdit}
          onCancel={() => setShowGlobalAIEditor(false)}
          isLoading={isGlobalAIEditing}
        />
      )}

      {aiEditingSection && (
        <ProposalAIEditor
          sectionTitle={aiEditingSection}
          onGenerate={handleAIGenerate}
          onCancel={() => setAiEditingSection(null)}
          isLoading={isAIRewriting}
        />
      )}

      {aiPreview && (
        <ProposalSectionPreview
          sectionTitle={aiPreview.section}
          originalContent={aiPreview.original}
          rewrittenContent={aiPreview.rewritten}
          onAccept={handleAcceptRewrite}
          onDiscard={() => setAiPreview(null)}
        />
      )}

      {/* Card overflow dropdown */}
      {cardMenuProposal &&
        createPortal(
          <div
            ref={cardDropdownRef}
            className="card"
            style={{
              position: 'fixed',
              top: cardMenuPos.top,
              right: cardMenuPos.right,
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
                const p = cardMenuProposal;
                setCardMenuProposal(null);
                setConfirmDeleteProposal(p);
              }}
            >
              <Icon icon={Trash2} size="sm" />
              <span>Delete</span>
            </button>
          </div>,
          window.document.body,
        )}

      {/* Confirm delete proposal dialog */}
      {confirmDeleteProposal &&
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
              if (e.target === e.currentTarget && !deletingProposal) setConfirmDeleteProposal(null);
            }}
          >
            <div
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                width: '100%',
                maxWidth: 420,
                boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: 52,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 20px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--panel-soft)',
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Delete proposal</span>
                <button
                  onClick={() => setConfirmDeleteProposal(null)}
                  disabled={deletingProposal}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    background: 'none',
                    border: '1px solid var(--border)',
                    cursor: deletingProposal ? 'not-allowed' : 'pointer',
                    color: 'var(--muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  aria-label="Close"
                >
                  <Icon icon={X} size="sm" />
                </button>
              </div>
              <div style={{ padding: 24 }}>
                <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 20, lineHeight: 1.5 }}>
                  Delete <strong>"{confirmDeleteProposal.client}"</strong>?
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
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
          window.document.body,
        )}
    </>
  );
}
