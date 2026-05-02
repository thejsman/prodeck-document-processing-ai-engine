'use client';

import { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { editProposalSection } from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────

interface Props {
  section: string;
  content: string;
  artifactId: string;
  namespace: string;
  apiKey: string;
  onUpdated?: (section: string, newContent: string, versionLabel: string) => void;
}

const TONE_PRESETS = [
  { label: 'More formal',     instruction: 'Rewrite this section in a more formal, professional tone' },
  { label: 'More persuasive', instruction: 'Rewrite this section to be more persuasive and compelling' },
  { label: 'Shorten',         instruction: 'Make this section more concise without losing key information' },
];

// ── Component ──────────────────────────────────────────────────────

export function ProposalSectionBlock({
  section,
  content: initialContent,
  artifactId,
  namespace,
  apiKey,
  onUpdated,
}: Props) {
  const [content, setContent] = useState(initialContent);
  const [isApplying, setIsApplying] = useState(false);
  const [versionLabel, setVersionLabel] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toneOpen, setToneOpen] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);

  async function applyEdit(instruction: string) {
    setIsApplying(true);
    setError(null);
    setToneOpen(false);

    try {
      const result = await editProposalSection(apiKey, {
        namespace,
        artifactId,
        section,
        instruction,
      });

      setContent(result.content);
      setVersionLabel(result.versionLabel);
      setIsApplying(false);

      setHighlight(true);
      setTimeout(() => setHighlight(false), 1800);

      blockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      onUpdated?.(section, result.content, result.versionLabel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Edit failed');
      setIsApplying(false);
    }
  }

  return (
    <div
      ref={blockRef}
      className={`psb${highlight ? ' psb--highlight' : ''}`}
    >
      {/* ── Header ── */}
      <div className="psb-header">
        <h3 className="psb-title">{section}</h3>
        <div className="psb-meta">
          {versionLabel && <span className="psb-version-badge">{versionLabel}</span>}
          {isApplying && <span className="psb-loading-badge">Updating…</span>}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="psb-body">
        <div className="prose psb-prose">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      </div>

      {/* ── Error ── */}
      {error && <p className="psb-error">{error}</p>}

      {/* ── Actions ── */}
      <div className="psb-actions">
        <button
          className="psb-btn"
          onClick={() => void applyEdit('Improve clarity, impact, and persuasiveness of this section')}
          disabled={isApplying}
        >
          Improve
        </button>
        <button
          className="psb-btn"
          onClick={() => void applyEdit('Rewrite this section from scratch using the proposal context and objectives')}
          disabled={isApplying}
        >
          Regenerate
        </button>

        <div className="psb-tone-wrap">
          <button
            className={`psb-btn psb-btn--tone${toneOpen ? ' active' : ''}`}
            onClick={() => setToneOpen((v) => !v)}
            disabled={isApplying}
          >
            Tone ▾
          </button>
          {toneOpen && (
            <div className="psb-tone-menu">
              {TONE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  className="psb-tone-item"
                  onClick={() => void applyEdit(preset.instruction)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
