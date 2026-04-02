'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { editProposalSection } from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────

interface Props {
  section: string;
  content: string;
  artifactId: string;
  namespace: string;
  apiKey: string;
  /** Called after a successful edit with the new content and version label. */
  onUpdated?: (section: string, newContent: string, versionLabel: string) => void;
}

type BlockMode = 'view' | 'editing';

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
  const [mode, setMode] = useState<BlockMode>('view');
  const [isApplying, setIsApplying] = useState(false);
  const [editText, setEditText] = useState(initialContent);
  const [versionLabel, setVersionLabel] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toneOpen, setToneOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const blockRef = useRef<HTMLDivElement>(null);

  // Auto-grow textarea
  useEffect(() => {
    if (mode === 'editing' && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      textareaRef.current.focus();
    }
  }, [mode]);

  async function applyEdit(instruction?: string, newContent?: string) {
    setIsApplying(true);
    setMode('view');
    setError(null);
    setToneOpen(false);

    try {
      const result = await editProposalSection(apiKey, {
        namespace,
        artifactId,
        section,
        instruction,
        newContent,
      });

      setContent(result.content);
      setEditText(result.content);
      setVersionLabel(result.versionLabel);
      setIsApplying(false);
      setMode('view');

      // Flash highlight to signal update
      setHighlight(true);
      setTimeout(() => setHighlight(false), 1800);

      // Scroll block into view
      blockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      onUpdated?.(section, result.content, result.versionLabel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Edit failed');
      setIsApplying(false);
      setMode('view');
    }
  }

  function handleEditSubmit() {
    if (editText.trim() === content) {
      setMode('view');
      return;
    }
    void applyEdit(undefined, editText.trim());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleEditSubmit();
    }
    if (e.key === 'Escape') {
      setEditText(content);
      setMode('view');
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
          {versionLabel && (
            <span className="psb-version-badge">{versionLabel}</span>
          )}
          {isApplying && (
            <span className="psb-loading-badge">Updating…</span>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="psb-body">
        {mode === 'editing' ? (
          <textarea
            ref={textareaRef}
            className="psb-textarea"
            value={editText}
            onChange={(e) => {
              setEditText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <div className="prose psb-prose">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {error && <p className="psb-error">{error}</p>}

      {/* ── Actions ── */}
      <div className="psb-actions">
        {mode === 'editing' ? (
          <>
            <button
              className="psb-btn psb-btn--primary"
              onClick={handleEditSubmit}
              disabled={isApplying}
            >
              Save
            </button>
            <button
              className="psb-btn"
              onClick={() => { setEditText(content); setMode('view'); }}
            >
              Cancel
            </button>
            <span className="psb-hint">⌘↵ save &nbsp;·&nbsp; Esc cancel</span>
          </>
        ) : (
          <>
            <button
              className="psb-btn"
              onClick={() => { setEditText(content); setMode('editing'); }}
              disabled={isApplying}
            >
              Edit
            </button>
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

            {/* Tone presets dropdown */}
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
          </>
        )}
      </div>
    </div>
  );
}
