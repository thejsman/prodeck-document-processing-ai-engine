'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ProposalDocument, ProposalMeta, ProposalStatus } from '@/lib/api';
import {
  parseProposalSections,
  type ParsedProposal,
} from '@/lib/proposal-utils';
import { SectionCard } from './SectionCard';

// ---------------------------------------------------------------------------
// Status helpers (exported so ProposalPage can reuse)
// ---------------------------------------------------------------------------

export const STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: 'Draft',
  under_review: 'Under Review',
  approved: 'Approved',
  finalized: 'Finalized',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  document: ProposalDocument | null;
  isGenerating: boolean;
  regeneratingSection: string | null;
  meta: ProposalMeta | null;
  onRegenerateAll: () => void;
  onRegenerateSection: (sectionTitle: string) => void;
  onImproveWithAI: (sectionTitle: string) => void;
  onToggleLock: (sectionTitle: string) => void;
  onShowDiff: () => void;
  onSaveSection: (sectionTitle: string, newContent: string) => Promise<void>;
  isSaving: boolean;
  collapsedSections: Set<string>;
  onToggleSection: (title: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProposalWorkspace({
  document,
  isGenerating,
  regeneratingSection,
  meta,
  onRegenerateAll,
  onRegenerateSection,
  onImproveWithAI,
  onToggleLock,
  onShowDiff,
  onSaveSection,
  isSaving,
  collapsedSections,
  onToggleSection,
}: Props) {
  const parsed: ParsedProposal | null = useMemo(() => {
    if (!document) return null;
    const retried = (document.metadata.retried_sections as string[]) ?? [];
    return parseProposalSections(document.content, retried);
  }, [document]);

  const isFinalized = meta?.status === 'finalized';
  const lockedSet = new Set(meta?.lockedSections ?? []);

  // ── Empty state ──────────────────────────────────────────
  if (!document && !isGenerating) {
    return (
      <div className="card">
        <div className="placeholder">
          <p className="muted">Configure your proposal on the left and click Generate</p>
        </div>
      </div>
    );
  }

  // ── Full generating state (no previous document) ─────────
  if (isGenerating && !document) {
    return (
      <div className="card">
        <div className="placeholder">
          <div>
            <span className="spinner" />
            <p style={{ marginTop: 12 }}>Generating proposal sections...</p>
            <p className="muted">This may take a minute</p>
          </div>
        </div>
      </div>
    );
  }

  if (!parsed || !document) return null;

  const m = document.metadata as Record<string, string | number | string[] | undefined>;

  return (
    <div className="workspace">
      {/* ── Document Header ──────────────────────────── */}
      {parsed.header && (
        <div className="card workspace-header-card">
          <div className="prose">
            <ReactMarkdown>{parsed.header}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* ── Section Cards ────────────────────────────── */}
      <div className="workspace-sections">
        {parsed.sections.map((section, index) => (
          <SectionCard
            key={`${section.title}-${index}`}
            title={section.title}
            content={section.content}
            failed={section.failed}
            locked={lockedSet.has(section.title)}
            expanded={!collapsedSections.has(section.title)}
            isRegenerating={
              isGenerating &&
              (regeneratingSection === null || regeneratingSection === section.title)
            }
            isFinalized={isFinalized}
            isSaving={isSaving}
            onToggle={() => onToggleSection(section.title)}
            onRegenerate={() => onRegenerateSection(section.title)}
            onImproveWithAI={() => onImproveWithAI(section.title)}
            onToggleLock={() => onToggleLock(section.title)}
            onSave={onSaveSection}
          />
        ))}
      </div>

      {/* ── Metadata Bar ─────────────────────────────── */}
      <div className="metadata-bar">
        {m.client ? <span>Client: <strong>{String(m.client)}</strong></span> : null}
        {m.version != null ? <span>Version: <strong>v{String(m.version)}</strong></span> : null}
        {m.template ? <span>Template: <strong>{String(m.template)}</strong></span> : null}
        {m.source_documents != null ? <span>Sources: <strong>{String(m.source_documents)}</strong></span> : null}
      </div>

    </div>
  );
}
