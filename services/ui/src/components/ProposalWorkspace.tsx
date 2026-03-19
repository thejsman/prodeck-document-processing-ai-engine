'use client';

import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ProposalDocument, ProposalMeta, ProposalStatus } from '@/lib/api';
import {
  parseProposalSections,
  reassembleMarkdown,
  downloadMarkdown,
  type ParsedProposal,
} from '@/lib/proposal-utils';
import { SectionCard } from './SectionCard';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: 'Draft',
  under_review: 'Under Review',
  approved: 'Approved',
  finalized: 'Finalized',
};

const STATUS_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  draft: ['under_review'],
  under_review: ['approved', 'draft'],
  approved: ['finalized', 'under_review'],
  finalized: [],
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
  onSetStatus: (status: ProposalStatus) => void;
  onShowDiff: () => void;
  onSaveSection: (sectionTitle: string, newContent: string) => Promise<void>;
  isSaving: boolean;
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
  onSetStatus,
  onShowDiff,
  onSaveSection,
  isSaving,
}: Props) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(),
  );

  const parsed: ParsedProposal | null = useMemo(() => {
    if (!document) return null;
    const retried = (document.metadata.retried_sections as string[]) ?? [];
    return parseProposalSections(document.content, retried);
  }, [document]);

  const isFinalized = meta?.status === 'finalized';
  const lockedSet = new Set(meta?.lockedSections ?? []);

  function toggleSection(title: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  }

  function expandAll() {
    setCollapsedSections(new Set());
  }

  function collapseAll() {
    if (!parsed) return;
    setCollapsedSections(new Set(parsed.sections.map((s) => s.title)));
  }

  function handleDownload() {
    if (!document) return;
    const client = (document.metadata.client as string) ?? 'proposal';
    downloadMarkdown(document.content, client);
  }

  // ── Empty state ──────────────────────────────────────────
  if (!document && !isGenerating) {
    return (
      <div className="card">
        <div className="placeholder">
          <p className="muted">
            Configure your proposal on the left and click Generate
          </p>
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

  const m = document.metadata as Record<
    string,
    string | number | string[] | undefined
  >;
  const failedCount = ((m.retried_sections as string[]) ?? []).length;
  const totalSections = parsed.sections.length;
  const lockedCount = meta?.lockedSections.length ?? 0;
  const currentStatus = meta?.status ?? 'draft';
  const transitions = STATUS_TRANSITIONS[currentStatus];

  return (
    <div className="workspace">
      {/* ── Toolbar ───────────────────────────────────── */}
      <div className="workspace-toolbar">
        <div className="workspace-toolbar-left">
          <span className="workspace-stat">
            {totalSections} section{totalSections !== 1 ? 's' : ''}
          </span>
          {failedCount > 0 && (
            <span className="workspace-stat workspace-stat--error">
              {failedCount} failed
            </span>
          )}
          {lockedCount > 0 && (
            <span className="workspace-stat">
              {lockedCount} locked
            </span>
          )}
          {m.retrieval_mode ? (
            <span className="badge">
              {String(m.retrieval_mode).toUpperCase()}
            </span>
          ) : null}
          {m.pricing_mode ? (
            <span className="badge">Pricing: {String(m.pricing_mode)}</span>
          ) : null}
          <span className={`badge badge--${currentStatus.replace('_', '-')}`}>
            {STATUS_LABELS[currentStatus]}
          </span>
        </div>
        <div className="workspace-toolbar-right">
          {/* Status transition buttons */}
          {transitions.length > 0 && (
            <div className="status-controls">
              {transitions.map((next) => (
                <button
                  key={next}
                  className="btn btn-sm"
                  onClick={() => onSetStatus(next)}
                  disabled={isGenerating}
                >
                  {STATUS_LABELS[next]}
                </button>
              ))}
            </div>
          )}
          <button
            className="btn btn-sm"
            onClick={expandAll}
            disabled={isGenerating}
          >
            Expand All
          </button>
          <button
            className="btn btn-sm"
            onClick={collapseAll}
            disabled={isGenerating}
          >
            Collapse All
          </button>
          <button
            className="btn btn-sm"
            onClick={onShowDiff}
            disabled={isGenerating}
          >
            Compare Versions
          </button>
          <button
            className="btn btn-sm"
            onClick={handleDownload}
            disabled={isGenerating}
          >
            Download .md
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={onRegenerateAll}
            disabled={isGenerating || isFinalized}
            style={{ width: 'auto' }}
          >
            {isGenerating && regeneratingSection === null ? (
              <>
                <span className="spinner" /> Regenerating...
              </>
            ) : (
              'Regenerate All'
            )}
          </button>
        </div>
      </div>

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
              (regeneratingSection === null ||
                regeneratingSection === section.title)
            }
            isFinalized={isFinalized}
            isSaving={isSaving}
            onToggle={() => toggleSection(section.title)}
            onRegenerate={() => onRegenerateSection(section.title)}
            onImproveWithAI={() => onImproveWithAI(section.title)}
            onToggleLock={() => onToggleLock(section.title)}
            onSave={onSaveSection}
          />
        ))}
      </div>

      {/* ── Metadata Bar ─────────────────────────────── */}
      <div className="metadata-bar">
        {m.client ? (
          <span>
            Client: <strong>{String(m.client)}</strong>
          </span>
        ) : null}
        {m.version != null ? (
          <span>
            Version: <strong>v{String(m.version)}</strong>
          </span>
        ) : null}
        {m.template ? (
          <span>
            Template: <strong>{String(m.template)}</strong>
          </span>
        ) : null}
        {m.source_documents != null ? (
          <span>
            Sources: <strong>{String(m.source_documents)}</strong>
          </span>
        ) : null}
      </div>
    </div>
  );
}
