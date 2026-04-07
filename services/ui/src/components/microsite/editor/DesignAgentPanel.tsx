'use client';

import { useState } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { designEditMicrosite } from '../../../lib/api';
import type { LayoutAST } from '../../../types/presentation';

// ── Preset suggestions ────────────────────────────────────────────────────

const DESIGN_PRESETS = [
  'Make it glassmorphic',
  'Make it luxury',
  'Make it cyberpunk',
  'Add hover effects',
  'Add tilt hover',
  'Animate the counters',
  'Add wavy dividers',
  'Add floating orbs',
  'Generate color harmony',
  'Add image overlay',
  'Make it darker and more dramatic',
  'Warmer palette with earthy tones',
  'Bold, monumental typography',
  'More editorial — light and airy',
];

const CONTENT_PRESETS = [
  'Make the hero headline more urgent',
  'Make the copy more concise',
  'Use a more authoritative tone',
  'Make it warmer and more human',
];

// ── Token diff display ────────────────────────────────────────────────────

function TokenDiff({
  before,
  after,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  const changed = Object.keys(after).filter(
    (k) => after[k] !== before[k],
  );
  if (changed.length === 0) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Design changes
      </div>
      {changed.map((key) => (
        <div
          key={key}
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            fontSize: 11,
            marginBottom: 4,
            padding: '4px 8px',
            background: '#f8fafc',
            borderRadius: 4,
          }}
        >
          <span style={{ fontWeight: 600, color: '#475569', minWidth: 80 }}>{key}</span>
          {typeof before[key] === 'string' && (before[key] as string).startsWith('#') && (
            <span style={{ width: 12, height: 12, borderRadius: 2, background: before[key] as string, border: '1px solid #e2e8f0', flexShrink: 0 }} />
          )}
          <span style={{ color: '#94a3b8', textDecoration: 'line-through', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {String(before[key] ?? '—')}
          </span>
          <span style={{ color: '#64748b' }}>→</span>
          {typeof after[key] === 'string' && (after[key] as string).startsWith('#') && (
            <span style={{ width: 12, height: 12, borderRadius: 2, background: after[key] as string, border: '1px solid #e2e8f0', flexShrink: 0 }} />
          )}
          <span style={{ color: '#1e293b', fontWeight: 600, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {String(after[key] ?? '—')}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────

interface Props {
  ast: LayoutAST;
  namespace: string;
  proposalId: string;
  targetSectionId?: string;
  onApply: (newAst: LayoutAST) => void;
  onClose: () => void;
}

type Step = 'idle' | 'analyzing' | 'synthesizing' | 'applying' | 'done';

const STEP_LABELS: Record<Step, string> = {
  idle:        '',
  analyzing:   'Analyzing instruction…',
  synthesizing:'Synthesizing design…',
  applying:    'Applying changes…',
  done:        'Done',
};

export function DesignAgentPanel({
  ast,
  namespace,
  proposalId,
  targetSectionId,
  onApply,
  onClose,
}: Props) {
  const { apiKey } = useAuth();
  const [instruction, setInstruction] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');

  const [previewResult, setPreviewResult] = useState<{
    ast: LayoutAST;
    mode: string;
    summary: string;
    tokensBefore: Record<string, unknown>;
    tokensAfter: Record<string, unknown>;
  } | null>(null);

  const isLoading = step !== 'idle' && step !== 'done';

  async function handleGenerate() {
    if (!instruction.trim() || isLoading) return;
    setError('');
    setPreviewResult(null);
    setStep('analyzing');

    try {
      await new Promise((r) => setTimeout(r, 400));
      setStep('synthesizing');

      const result = await designEditMicrosite(apiKey, namespace, proposalId, {
        instruction: instruction.trim(),
        targetSectionId,
        currentAst: ast,
        commit: false, // preview only — don't save yet
      });

      setStep('applying');
      await new Promise((r) => setTimeout(r, 200));

      const newAst = result.ast as LayoutAST;
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
        boxShadow: '-4px 0 24px rgba(0,0,0,0.08)',
      }}
    >
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
          <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
            ✦ Design AI
          </span>
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

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {/* Instruction input */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Instruction
          </label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder='e.g. "Make it darker and bolder" or "Rewrite the hero to be more urgent"'
            rows={3}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid #e2e8f0',
              fontSize: 13,
              color: '#1e293b',
              resize: 'vertical',
              fontFamily: 'inherit',
              lineHeight: 1.5,
              boxSizing: 'border-box',
            }}
            disabled={isLoading}
          />
        </div>

        {/* Preset suggestions */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {targetSectionId ? 'Content presets' : 'Design presets'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(targetSectionId ? CONTENT_PRESETS : DESIGN_PRESETS).map((preset) => (
              <button
                key={preset}
                onClick={() => setInstruction(preset)}
                disabled={isLoading}
                style={{
                  padding: '4px 10px',
                  borderRadius: 100,
                  border: '1px solid #e2e8f0',
                  background: instruction === preset ? '#6366f1' : '#f8fafc',
                  color: instruction === preset ? '#fff' : '#475569',
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s',
                }}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', color: '#6366f1' }}>
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', fontSize: 16 }}>⟳</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{STEP_LABELS[step]}</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* Preview result */}
        {previewResult && (
          <div>
            <div style={{ padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 12, color: '#166534', marginBottom: 12 }}>
              <strong>
                {{
                  mood:      '🎨 Mood',
                  hover:     '✋ Hover',
                  animate:   '✨ Animate',
                  dividers:  '〰 Dividers',
                  harmonize: '🎨 Harmonize',
                  overlay:   '🖼 Overlay',
                  decorate:  '✦ Decorate',
                  design:    '✦ Design',
                  content:   '✎ Content',
                }[previewResult.mode] ?? `✦ ${previewResult.mode}`}
              </strong>{' '}— {previewResult.summary}
            </div>

            <TokenDiff
              before={previewResult.tokensBefore}
              after={previewResult.tokensAfter}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          gap: 8,
          flexShrink: 0,
        }}
      >
        {previewResult ? (
          <>
            <button
              onClick={handleRevert}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #e2e8f0',
                background: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                color: '#64748b',
              }}
            >
              Revert
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
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Apply changes
            </button>
          </>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={!instruction.trim() || isLoading}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 6,
              border: 'none',
              background: !instruction.trim() || isLoading ? '#e2e8f0' : '#6366f1',
              color: !instruction.trim() || isLoading ? '#94a3b8' : '#fff',
              fontSize: 13,
              fontWeight: 700,
              cursor: !instruction.trim() || isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            Generate
          </button>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
