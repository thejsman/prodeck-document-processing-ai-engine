'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { X, MoreVertical, ChevronDown, ChevronRight, RefreshCw, GitBranch, Plus, ArrowDown } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
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
  fetchProposalMeta,
  fetchProposalContent,
  saveProposalContent,
  lockSection,
  unlockSection,
  setProposalStatus,
  fetchProposalDiff,
  runAgent,
} from '@/lib/api';
import {
  parseProposalSections,
  reassembleMarkdown,
  downloadMarkdown,
} from '@/lib/proposal-utils';
import { useAuth } from '@/lib/auth-context';
import { useExecutionStore } from '@/core/execution/execution-store';
import { ProposalForm } from './ProposalForm';
import { ProposalWorkspace, type ProposalWorkspaceHandle, STATUS_LABELS } from './ProposalWorkspace';
import { DiffViewer } from './DiffViewer';
import { ProposalAIEditor } from './ProposalAIEditor';
import { ProposalSectionPreview } from './ProposalSectionPreview';

export function ProposalPage() {
  const { apiKey } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const addExecution = useExecutionStore((s) => s.addExecution);
  const updateExecution = useExecutionStore((s) => s.updateExecution);
  const [currentDocument, setCurrentDocument] =
    useState<ProposalDocument | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRequest, setLastRequest] =
    useState<GenerateProposalRequest | null>(null);
  const [regeneratingSection, setRegeneratingSection] = useState<string | null>(
    null,
  );
  const [regenError, setRegenError] = useState('');

  // Workflow state
  const [meta, setMeta] = useState<ProposalMeta | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [diffData, setDiffData] = useState<SectionDiff[]>([]);
  const [workflowError, setWorkflowError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Modal open state
  const [modalOpen, setModalOpen] = useState(false);

  // Overflow menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [allExpanded, setAllExpanded] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<ProposalWorkspaceHandle>(null);

  // Proposal display name
  const proposalName = (currentDocument?.metadata as Record<string, unknown>)?.client as string | undefined
    ?? searchParams.get('artifact')
    ?? 'Proposals';

  // Close overflow menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [menuOpen]);

  // Section count + status for header display
  const sectionCount = useMemo(() => {
    if (!currentDocument) return 0;
    const retried = (currentDocument.metadata as Record<string, unknown>).retried_sections as string[] ?? [];
    return parseProposalSections(currentDocument.content, retried).sections.length;
  }, [currentDocument]);

  const currentStatus = meta?.status ?? 'draft';
  const isFinalized = currentStatus === 'finalized';

  function handleDownload() {
    if (!currentDocument) return;
    const client = (currentDocument.metadata as Record<string, unknown>).client as string ?? 'proposal';
    downloadMarkdown(currentDocument.content, client);
  }

  const handleExpandCollapse = useCallback(() => {
    if (allExpanded) {
      workspaceRef.current?.collapseAll();
      setAllExpanded(false);
    } else {
      workspaceRef.current?.expandAll();
      setAllExpanded(true);
    }
    setMenuOpen(false);
  }, [allExpanded]);

  // AI rewrite state
  const [aiEditingSection, setAiEditingSection] = useState<string | null>(null);
  const [isAIRewriting, setIsAIRewriting] = useState(false);
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
    // The API resolves namespace-prefixed filenames via "ns::file.md" format
    const fileKey = ns ? `${ns}::${artifact}` : artifact;
    fetchProposalContent(apiKey, fileKey)
      .then((doc) => {
        setCurrentDocument(doc);
        return fetchProposalMeta(apiKey, fileKey).catch(() => null);
      })
      .then((m) => { if (m) setMeta(m); })
      .catch(() => { /* silently ignore — user can load manually */ });
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
      if (ns && ns !== 'namespaces') return `${ns}::${fileName}`;
    }
    return fileName;
  }

  async function handleGenerate(
    doc: ProposalDocument,
    request: GenerateProposalRequest,
  ) {
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

  async function handleRegenerateSection(
    sectionTitle: string,
    instruction = '',
  ) {
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
        s.title === sectionTitle
          ? { ...s, content: stripHeading(regeneratedSection, sectionTitle) }
          : s,
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
      const originalSection = parsed.sections.find(
        (s) => s.title === aiEditingSection,
      );

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
        s.title === aiPreview.section
          ? { ...s, content: aiPreview.rewritten }
          : s,
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
      sessionStorage.setItem('ms_wizard_state', JSON.stringify({
        step: 'brand',
        wasGenerating: false,
        progress: [],
        streamingSections: [],
        error: null,
        selectedNamespace: ns,
        selectedProposal: proposalFile,
      }));
      if (ns) localStorage.setItem('ms_namespace', ns);
    } catch { /* ignore */ }
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
        (currentDocument.metadata as Record<string, unknown>)
          .retried_sections as string[] | undefined ?? [];
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

  const STATUS_COLORS: Record<string, { color: string; borderColor: string }> = {
    draft:        { color: '#6b7280',  borderColor: '#d1d5db' },
    under_review: { color: '#2563eb',  borderColor: '#93c5fd' },
    approved:     { color: '#16a34a',  borderColor: '#86efac' },
    finalized:    { color: '#7c3aed',  borderColor: '#c4b5fd' },
  };
  const sc = STATUS_COLORS[currentStatus] ?? STATUS_COLORS.draft;

  const menuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '10px 16px',
    fontSize: 13,
    color: 'var(--text)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* ── Header ── */}
      <header className="chat-v2-header">
        <div className="chat-v2-header-left">
          <span className="chat-v2-ns" style={{ lineHeight: 1 }}>{proposalName}</span>
          {currentDocument && (
            <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1 }}>
              {sectionCount} section{sectionCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="chat-v2-header-right">
          <button
            style={{
              height: 30,
              padding: '0 12px',
              whiteSpace: 'nowrap',
              background: currentDocument && currentStatus === 'approved' ? 'var(--primary)' : 'var(--panel-soft)',
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
          </button>
          {currentDocument && (
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <select
                className="select"
                style={{
                  width: 'auto',
                  height: 30,
                  padding: '0 24px 0 8px',
                  color: sc.color,
                  borderColor: sc.borderColor,
                  fontWeight: 500,
                  fontSize: 13,
                  transition: 'border-color 0.15s, color 0.15s',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  paddingRight: 24,
                }}
                value={currentStatus}
                disabled={isGenerating}
                onChange={e => handleSetStatus(e.target.value as ProposalStatus)}
              >
                <option value="draft" style={{ color: STATUS_COLORS.draft.color }}>Draft</option>
                <option value="under_review" style={{ color: STATUS_COLORS.under_review.color }}>Under Review</option>
                <option value="approved" style={{ color: STATUS_COLORS.approved.color }}>Approved</option>
              </select>
              <Icon
                icon={ChevronDown}
                size="sm"
                style={{
                  position: 'absolute',
                  right: 6,
                  pointerEvents: 'none',
                  color: sc.color,
                  flexShrink: 0,
                }}
              />
            </div>
          )}
          {/* Overflow menu */}
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              className="chat-v2-panel-toggle"
              onClick={() => setMenuOpen(v => !v)}
              title="More actions"
              aria-label="More actions"
            >
              <Icon icon={MoreVertical} size="sm" />
            </button>

            {menuOpen && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 0,
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                zIndex: 100,
                minWidth: 210,
                padding: '4px 0',
              }}>
                <button
                  style={menuItemStyle}
                  onClick={handleExpandCollapse}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel-soft)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <Icon icon={allExpanded ? ChevronDown : ChevronRight} size="sm" style={{ color: 'var(--muted)', flexShrink: 0 }} />
                  {allExpanded ? 'Collapse All' : 'Expand All'}
                </button>
                <button
                  style={menuItemStyle}
                  onClick={() => { handleShowDiff(); setMenuOpen(false); }}
                  disabled={!currentDocument || isGenerating}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel-soft)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <Icon icon={GitBranch} size="sm" style={{ color: 'var(--muted)', flexShrink: 0 }} />
                  Compare Versions
                </button>
                <button
                  style={menuItemStyle}
                  onClick={() => { handleDownload(); setMenuOpen(false); }}
                  disabled={!currentDocument}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel-soft)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <Icon icon={ArrowDown} size="sm" style={{ color: 'var(--muted)', flexShrink: 0 }} />
                  Download .md
                </button>
                <button
                  style={menuItemStyle}
                  onClick={() => { handleRegenerateAll(); setMenuOpen(false); }}
                  disabled={!currentDocument || isGenerating || isFinalized}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel-soft)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <Icon icon={RefreshCw} size="sm" style={{ color: 'var(--muted)', flexShrink: 0 }} />
                  Regenerate All
                </button>
                <button
                  style={menuItemStyle}
                  onClick={() => { setModalOpen(true); setMenuOpen(false); }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel-soft)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <Icon icon={Plus} size="sm" style={{ color: 'var(--muted)', flexShrink: 0 }} />
                  Generate Proposal
                </button>
              </div>
            )}
          </div>

          <button
            className="chat-v2-panel-toggle"
            onClick={() => router.back()}
            title="Close"
            aria-label="Close"
          >
            <Icon icon={X} size="sm" />
          </button>
        </div>
      </header>

      {/* ── Content ── */}
      <div className="page-container" style={{ flex: 1, overflowY: 'auto' }}>
        {(regenError || workflowError) && (
          <p className="error">{regenError || workflowError}</p>
        )}
        <ProposalWorkspace
          ref={workspaceRef}
          document={currentDocument}
          isGenerating={isGenerating}
          regeneratingSection={regeneratingSection}
          meta={meta}
          onRegenerateAll={handleRegenerateAll}
          onRegenerateSection={handleRegenerateSection}
          onImproveWithAI={handleOpenAIEditor}
          onToggleLock={handleToggleLock}
          onSetStatus={handleSetStatus}
          onShowDiff={handleShowDiff}
          onSaveSection={handleSaveSection}
          isSaving={isSaving}
        />
      </div>
      </div>{/* end flex-column wrapper */}

      {/* ── Generate Proposal modal ── */}
      {modalOpen && (
        <div className="ai-editor-overlay" onClick={() => setModalOpen(false)}>
          <div
            className="ai-editor-modal"
            style={{ maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ai-editor-header">
              <h3>Generate Proposal</h3>
              <button
                onClick={() => setModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', color: 'var(--muted)' }}
                aria-label="Close"
              >
                <Icon icon={X} size="md" />
              </button>
            </div>
            <div style={{ padding: '20px', overflowY: 'auto' }}>
              <ProposalForm
                onGenerate={(doc, req) => { handleGenerate(doc, req); setModalOpen(false); }}
                isGenerating={isGenerating}
                setIsGenerating={setIsGenerating}
              />
            </div>
          </div>
        </div>
      )}

      {showDiff && (
        <DiffViewer diffs={diffData} onClose={() => setShowDiff(false)} />
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
    </>
  );
}
