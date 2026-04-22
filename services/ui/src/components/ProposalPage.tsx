'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { X } from 'lucide-react';
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
} from '@/lib/proposal-utils';
import { useAuth } from '@/lib/auth-context';
import { useExecutionStore } from '@/core/execution/execution-store';
import { ProposalForm } from './ProposalForm';
import { ProposalWorkspace } from './ProposalWorkspace';
import { VersionHistory } from './VersionHistory';
import { DiffViewer } from './DiffViewer';
import { ProposalAIEditor } from './ProposalAIEditor';
import { ProposalSectionPreview } from './ProposalSectionPreview';

export function ProposalPage() {
  const { apiKey } = useAuth();
  const searchParams = useSearchParams();
  const addExecution = useExecutionStore((s) => s.addExecution);
  const updateExecution = useExecutionStore((s) => s.updateExecution);
  const router = useRouter();
  const fromChat = searchParams.get('from') === 'chat';
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
  const proposalName = (currentDocument?.metadata as Record<string, unknown>)?.client as string | undefined
    ?? searchParams.get('artifact')
    ?? 'Proposals';
  const currentStatus = meta?.status ?? 'draft';
  const [showDiff, setShowDiff] = useState(false);
  const [diffData, setDiffData] = useState<SectionDiff[]>([]);
  const [workflowError, setWorkflowError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <header className="chat-v2-header">
          <div className="chat-v2-header-left">
            <span className="chat-v2-ns" style={{ lineHeight: 1 }}>{proposalName}</span>
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

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {fromChat ? (
            <>
              {(regenError || workflowError) && (
                <p className="error">{regenError || workflowError}</p>
              )}
              <ProposalWorkspace
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
            </>
          ) : (
            <div className="two-col">
              <div className="col-left">
                <ProposalForm
                  onGenerate={handleGenerate}
                  isGenerating={isGenerating}
                  setIsGenerating={setIsGenerating}
                />
                <VersionHistory refreshKey={refreshKey} onSelect={handleSelectHistory} />
              </div>
              <div className="col-right">
                {(regenError || workflowError) && (
                  <p className="error">{regenError || workflowError}</p>
                )}
                <ProposalWorkspace
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
            </div>
          )}
        </div>
      </div>

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
