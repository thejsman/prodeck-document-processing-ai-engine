'use client';

import { useState } from 'react';
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

  // AI rewrite state
  const [aiEditingSection, setAiEditingSection] = useState<string | null>(null);
  const [isAIRewriting, setIsAIRewriting] = useState(false);
  const [aiPreview, setAiPreview] = useState<{
    section: string;
    original: string;
    rewritten: string;
  } | null>(null);

  // Derive the current proposal file name from document metadata
  function currentFileName(): string | null {
    if (!currentDocument) return null;
    const meta = currentDocument.metadata as Record<string, unknown>;
    const outputFile = (meta.output_file ?? meta.output_path) as string | undefined;
    if (!outputFile) return null;
    // Split on both forward and back slashes to handle Windows paths
    return outputFile.split(/[\\/]/).pop() ?? null;
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
      <div className="page-header">
        <h1>Proposal Generator</h1>
      </div>

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
