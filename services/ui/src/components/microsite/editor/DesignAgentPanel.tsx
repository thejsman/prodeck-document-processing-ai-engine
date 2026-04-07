'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { designEditMicrosite } from '../../../lib/api';
import type { LayoutAST } from '../../../types/presentation';

// ── Grouped preset definitions ─────────────────────────────────────────────

const DESIGN_GROUPS = [
  {
    label: 'Visual style',
    presets: [
      { icon: '🪟', text: 'Glassmorphic' },
      { icon: '💎', text: 'Luxury' },
      { icon: '⚡', text: 'Cyberpunk' },
      { icon: '📖', text: 'Editorial' },
      { icon: '🎮', text: 'Playful' },
      { icon: '⬛', text: 'Brutalist' },
    ],
  },
  {
    label: 'Color',
    presets: [
      { icon: '🎵', text: 'Generate color harmony' },
      { icon: '🌑', text: 'Make it darker and more dramatic' },
      { icon: '🌄', text: 'Warmer palette with earthy tones' },
      { icon: '🔲', text: 'Monochrome with high contrast' },
    ],
  },
  {
    label: 'Typography',
    presets: [
      { icon: 'Aa', text: 'Bold, monumental typography' },
      { icon: 'Aa', text: 'More editorial — light and airy' },
      { icon: 'Aa', text: 'Condensed and tight' },
    ],
  },
  {
    label: 'Motion & FX',
    presets: [
      { icon: '✨', text: 'Animate the counters' },
      { icon: '✋', text: 'Add hover effects' },
      { icon: '〰', text: 'Add wavy dividers' },
      { icon: '✦', text: 'Add floating orbs' },
      { icon: '🖼', text: 'Add image overlay' },
    ],
  },
];

const CONTENT_GROUPS = [
  {
    label: 'Tone',
    presets: [
      { icon: '🔥', text: 'Make the hero headline more urgent' },
      { icon: '🎯', text: 'Make the copy more direct' },
      { icon: '❤️', text: 'Make it warmer and more human' },
      { icon: '🏛', text: 'Use a more authoritative tone' },
    ],
  },
  {
    label: 'Length',
    presets: [
      { icon: '✂️', text: 'Make the copy more concise' },
      { icon: '↕', text: 'Expand with more detail' },
      { icon: '💡', text: 'Add concrete examples' },
    ],
  },
];

// ── Token diff display ────────────────────────────────────────────────────

function TokenDiff({
  before,
  after,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
  if (changed.length === 0) return null;

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Design changes
      </div>
      {changed.map((key) => (
        <div
          key={key}
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            fontSize: 11,
            marginBottom: 3,
            padding: '4px 8px',
            background: '#f8fafc',
            borderRadius: 4,
          }}
        >
          <span style={{ fontWeight: 600, color: '#475569', minWidth: 80, flexShrink: 0 }}>{key}</span>
          {typeof before[key] === 'string' && (before[key] as string).startsWith('#') && (
            <span style={{ width: 14, height: 14, borderRadius: 3, background: before[key] as string, border: '1px solid #e2e8f0', flexShrink: 0 }} />
          )}
          <span style={{ color: '#94a3b8', textDecoration: 'line-through', maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {String(before[key] ?? '—')}
          </span>
          <span style={{ color: '#64748b', flexShrink: 0 }}>→</span>
          {typeof after[key] === 'string' && (after[key] as string).startsWith('#') && (
            <span style={{ width: 14, height: 14, borderRadius: 3, background: after[key] as string, border: '1px solid #e2e8f0', flexShrink: 0 }} />
          )}
          <span style={{ color: '#1e293b', fontWeight: 600, maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {String(after[key] ?? '—')}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Mode badge ─────────────────────────────────────────────────────────────

const MODE_META: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  mood:      { icon: '🎨', label: 'Mood',      color: '#4f46e5', bg: '#eef2ff' },
  design:    { icon: '✦',  label: 'Design',    color: '#4f46e5', bg: '#eef2ff' },
  hover:     { icon: '✋', label: 'Hover',     color: '#4f46e5', bg: '#eef2ff' },
  animate:   { icon: '✨', label: 'Animate',   color: '#4f46e5', bg: '#eef2ff' },
  dividers:  { icon: '〰', label: 'Dividers',  color: '#4f46e5', bg: '#eef2ff' },
  harmonize: { icon: '🎵', label: 'Harmonize', color: '#4f46e5', bg: '#eef2ff' },
  overlay:   { icon: '🖼', label: 'Overlay',   color: '#4f46e5', bg: '#eef2ff' },
  decorate:  { icon: '✦',  label: 'Decorate',  color: '#4f46e5', bg: '#eef2ff' },
  content:   { icon: '✎',  label: 'Content',   color: '#92400e', bg: '#fffbeb' },
};

// ── Panel ─────────────────────────────────────────────────────────────────

interface Props {
  ast: LayoutAST;
  namespace: string;
  proposalId: string;
  targetSectionId?: string;
  initialInstruction?: string;
  onApply: (newAst: LayoutAST) => void;
  onClose: () => void;
}

type Step = 'idle' | 'analyzing' | 'synthesizing' | 'applying' | 'done';

const STEP_LABELS: Record<Step, string> = {
  idle:         '',
  analyzing:    'Analyzing instruction…',
  synthesizing: 'Synthesizing design…',
  applying:     'Applying changes…',
  done:         'Done',
};

const STEP_PROGRESS: Record<Step, number> = {
  idle:         0,
  analyzing:    25,
  synthesizing: 65,
  applying:     90,
  done:         100,
};

export function DesignAgentPanel({
  ast,
  namespace,
  proposalId,
  targetSectionId,
  initialInstruction,
  onApply,
  onClose,
}: Props) {
  const { apiKey } = useAuth();
  const [tab, setTab] = useState<'design' | 'content'>(targetSectionId ? 'content' : 'design');
  const [instruction, setInstruction] = useState(initialInstruction ?? '');
  const [autoApply, setAutoApply] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [previewResult, setPreviewResult] = useState<{
    ast: LayoutAST;
    mode: string;
    summary: string;
    tokensBefore: Record<string, unknown>;
    tokensAfter: Record<string, unknown>;
  } | null>(null);

  const isLoading = step !== 'idle' && step !== 'done';

  // Autofocus textarea on open; if initialInstruction provided, trigger immediately
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (initialInstruction) {
      setInstruction(initialInstruction);
    }
  }, [initialInstruction]);

  async function handleGenerate() {
    if (!instruction.trim() || isLoading) return;
    setError('');
    setPreviewResult(null);
    setStep('analyzing');

    try {
      await new Promise((r) => setTimeout(r, 350));
      setStep('synthesizing');

      const result = await designEditMicrosite(apiKey, namespace, proposalId, {
        instruction: instruction.trim(),
        targetSectionId,
        currentAst: ast,
        commit: autoApply,
      });

      setStep('applying');
      await new Promise((r) => setTimeout(r, 180));

      const newAst = result.ast as LayoutAST;

      if (autoApply) {
        onApply(newAst);
        onClose();
        return;
      }

      const tokensBefore = (ast.customTokens ?? {}) as Record<string, unknown>;
      const tokensAfter = (newAst.customTokens ?? {}) as Record<string, unknown>;

      setPreviewResult({
        ast: newAst,
        mode: result.mode,
        summary: result.summary,
        tokensBefore,
        tokensAfter,
      });
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('idle');
    }
  }

  function handleApply() {
    if (!previewResult) return;
    onApply(previewResult.ast);
    onClose();
  }

  function handleRevert() {
    setPreviewResult(null);
    setStep('idle');
  }

  function handleRefine() {
    setPreviewResult(null);
    setStep('idle');
    // keep instruction for refinement
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleGenerate();
    }
  }

  const groups = tab === 'design' ? DESIGN_GROUPS : CONTENT_GROUPS;
  const modeMeta = previewResult ? (MODE_META[previewResult.mode] ?? { icon: '✦', label: previewResult.mode, color: '#4f46e5', bg: '#eef2ff' }) : null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 340,
        background: '#fff',
        borderLeft: '1px solid #e2e8f0',
        zIndex: 10100,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        boxShadow: '-4px 0 32px rgba(0,0,0,0.10)',
      }}
    >
      {/* Progress bar */}
      <div style={{ height: 3, background: '#f1f5f9', flexShrink: 0 }}>
        <div
          style={{
            height: '100%',
            width: `${STEP_PROGRESS[step]}%`,
            background: 'linear-gradient(90deg, #6366f1, #818cf8)',
            borderRadius: 2,
            transition: step === 'idle' ? 'none' : 'width 0.5s cubic-bezier(0.4,0,0.2,1)',
          }}
        />
      </div>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          height: 48,
          borderBottom: '1px solid #e2e8f0',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>✦ Design AI</span>
          {targetSectionId && (
            <span style={{ fontSize: 11, color: '#94a3b8', background: '#f1f5f9', padding: '2px 8px', borderRadius: 10 }}>
              Section edit
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18, lineHeight: 1, padding: 4 }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
        {(['design', 'content'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '10px 0',
              border: 'none',
              background: 'none',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              color: tab === t ? '#6366f1' : '#94a3b8',
              borderBottom: tab === t ? '2px solid #6366f1' : '2px solid transparent',
              marginBottom: -1,
              transition: 'color 0.15s',
              textTransform: 'capitalize',
              letterSpacing: '0.02em',
            }}
          >
            {t === 'design' ? '✦ Design' : '✎ Content'}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>

        {/* Instruction input */}
        <div style={{ marginBottom: 14 }}>
          <textarea
            ref={textareaRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              tab === 'design'
                ? 'Describe the look you want — e.g. "Make it feel like a high-end SaaS brand"'
                : 'Describe the edit — e.g. "Rewrite the hero to be more urgent and specific"'
            }
            rows={4}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1.5px solid #e2e8f0',
              fontSize: 13,
              color: '#1e293b',
              resize: 'vertical',
              fontFamily: 'inherit',
              lineHeight: 1.6,
              boxSizing: 'border-box',
              outline: 'none',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#6366f1'; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
            disabled={isLoading}
          />
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, textAlign: 'right' }}>
            ⌘↵ to generate
          </div>
        </div>

        {/* Grouped presets */}
        {groups.map((group) => (
          <div key={group.label} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              {group.label}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {group.presets.map((p) => (
                <button
                  key={p.text}
                  onClick={() => setInstruction(p.text)}
                  disabled={isLoading}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 100,
                    border: '1px solid',
                    borderColor: instruction === p.text ? '#6366f1' : '#e2e8f0',
                    background: instruction === p.text ? '#eef2ff' : '#f8fafc',
                    color: instruction === p.text ? '#4f46e5' : '#475569',
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    transition: 'all 0.12s',
                  }}
                >
                  <span style={{ fontSize: 12 }}>{p.icon}</span>
                  {p.text}
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Loading */}
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', color: '#6366f1' }}>
            <span style={{ animation: 'dap-spin 0.9s linear infinite', display: 'inline-block', fontSize: 15 }}>⟳</span>
            <span style={{ fontSize: 12, fontWeight: 500 }}>{STEP_LABELS[step]}</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* Preview result */}
        {previewResult && modeMeta && (
          <div style={{ marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 100,
                background: modeMeta.bg, color: modeMeta.color,
                fontSize: 11, fontWeight: 700,
              }}>
                {modeMeta.icon} {modeMeta.label}
              </span>
              <span style={{ fontSize: 12, color: '#475569', flex: 1 }}>{previewResult.summary}</span>
            </div>
            <TokenDiff before={previewResult.tokensBefore} after={previewResult.tokensAfter} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid #e2e8f0',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* Auto-apply toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 11, color: '#64748b', fontWeight: 500 }}>
          <input
            type="checkbox"
            checked={autoApply}
            onChange={(e) => setAutoApply(e.target.checked)}
            disabled={isLoading}
            style={{ accentColor: '#6366f1', width: 13, height: 13 }}
          />
          ⚡ Apply immediately (skip preview)
        </label>

        {previewResult ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleRevert}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #e2e8f0',
                background: '#fff',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                color: '#64748b',
              }}
            >
              Revert
            </button>
            <button
              onClick={handleRefine}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #c7d2fe',
                background: '#eef2ff',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                color: '#4f46e5',
              }}
            >
              Refine
            </button>
            <button
              onClick={handleApply}
              style={{
                flex: 2,
                padding: '8px 12px',
                borderRadius: 6,
                border: 'none',
                background: '#6366f1',
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Apply changes
            </button>
          </div>
        ) : (
          <button
            onClick={() => { void handleGenerate(); }}
            disabled={!instruction.trim() || isLoading}
            style={{
              width: '100%',
              padding: '9px 12px',
              borderRadius: 6,
              border: 'none',
              background: !instruction.trim() || isLoading ? '#e2e8f0' : '#6366f1',
              color: !instruction.trim() || isLoading ? '#94a3b8' : '#fff',
              fontSize: 13,
              fontWeight: 700,
              cursor: !instruction.trim() || isLoading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {isLoading ? 'Generating…' : 'Generate'}
          </button>
        )}
      </div>

      <style>{`@keyframes dap-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
