'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { MoreHorizontal } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import type { ProposalDocument, ProposalMeta, ProposalStatus } from '@/lib/api';
import {
  parseProposalSections,
  downloadMarkdown,
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
}: Props) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const overflowBtnRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!overflowOpen) return;
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    }
    window.document.addEventListener('mousedown', handle);
    return () => window.document.removeEventListener('mousedown', handle);
  }, [overflowOpen]);

  function openOverflow() {
    if (overflowOpen) { setOverflowOpen(false); return; }
    const rect = overflowBtnRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOverflowOpen(true);
  }

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
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  function expandAll() { setCollapsedSections(new Set()); }

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
  const failedCount = ((m.retried_sections as string[]) ?? []).length;
  const lockedCount = meta?.lockedSections.length ?? 0;
  const allCollapsed = parsed.sections.length > 0 && collapsedSections.size === parsed.sections.length;

  const menuItemStyle: React.CSSProperties = {
    width: '100%',
    textAlign: 'left',
    borderRadius: 0,
    border: 'none',
    justifyContent: 'flex-start',
    padding: '8px 14px',
    fontSize: 14,
  };

  return (
    <div className="workspace">
      {/* ── Toolbar ───────────────────────────────────── */}
      <div className="workspace-toolbar">
        <div className="workspace-toolbar-left">
          {failedCount > 0 && (
            <span className="workspace-stat workspace-stat--error">{failedCount} failed</span>
          )}
          {lockedCount > 0 && (
            <span className="workspace-stat">{lockedCount} locked</span>
          )}
          {m.retrieval_mode ? (
            <span className="badge">{String(m.retrieval_mode).toUpperCase()}</span>
          ) : null}
          {m.pricing_mode ? (
            <span className="badge">Pricing: {String(m.pricing_mode)}</span>
          ) : null}
        </div>
        <div className="workspace-toolbar-right">
          <button
            ref={overflowBtnRef}
            className="btn btn-sm"
            onClick={openOverflow}
            aria-label="More options"
            title="More options"
          >
            <Icon icon={MoreHorizontal} size="sm" />
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
              (regeneratingSection === null || regeneratingSection === section.title)
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
        {m.client ? <span>Client: <strong>{String(m.client)}</strong></span> : null}
        {m.version != null ? <span>Version: <strong>v{String(m.version)}</strong></span> : null}
        {m.template ? <span>Template: <strong>{String(m.template)}</strong></span> : null}
        {m.source_documents != null ? <span>Sources: <strong>{String(m.source_documents)}</strong></span> : null}
      </div>

      {/* ── Overflow Menu (portalled) ─────────────────── */}
      {overflowOpen && createPortal(
        <div
          ref={dropdownRef}
          className="card"
          style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, minWidth: 160, padding: '4px 0', zIndex: 99999 }}
        >
          <button
            className="btn btn-sm"
            style={menuItemStyle}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { allCollapsed ? expandAll() : collapseAll(); setOverflowOpen(false); }}
          >
            {allCollapsed ? 'Expand All' : 'Collapse All'}
          </button>
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <button
            className="btn btn-sm"
            style={menuItemStyle}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onShowDiff(); setOverflowOpen(false); }}
          >
            Compare Versions
          </button>
          <button
            className="btn btn-sm"
            style={menuItemStyle}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { handleDownload(); setOverflowOpen(false); }}
          >
            Download .md
          </button>
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <button
            className="btn btn-sm"
            style={menuItemStyle}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onRegenerateAll(); setOverflowOpen(false); }}
            disabled={isGenerating || isFinalized}
          >
            {isGenerating && regeneratingSection === null ? 'Regenerating…' : 'Regenerate All'}
          </button>
        </div>,
        window.document.body,
      )}
    </div>
  );
}
