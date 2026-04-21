'use client';

import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '../../../lib/auth-context';
import { designEditMicrosite } from '../../../lib/api';
import type { LayoutAST } from '../../../types/presentation';

// ── Quick suggestion chips ─────────────────────────────────────────────────

const DESIGN_CHIPS = [
  { icon: '🌑', text: 'Darker & dramatic' },
  { icon: '💎', text: 'Luxury — deep dark, gold accent' },
  { icon: '🪟', text: 'Glassmorphic' },
  { icon: '⚡', text: 'Cyberpunk neon' },
  { icon: '📖', text: 'Editorial — light, airy, serif' },
  { icon: '🎮', text: 'Playful & rounded' },
  { icon: '⬛', text: 'Brutalist — stark, high contrast' },
  { icon: '🌿', text: 'Warm earthy tones' },
  { icon: '✨', text: 'Add animations & motion' },
  { icon: '〰', text: 'Add wavy section dividers' },
  { icon: '✦', text: 'Add floating orbs decoration' },
  { icon: '✋', text: 'Add hover lift effects' },
];

const CONTENT_CHIPS_SECTION = [
  { icon: '✎', label: 'Rewrite', text: 'Rewrite this section with improved copy' },
  { icon: '✂', label: 'Shorten', text: 'Make this section more concise — 3 bullet points max' },
  { icon: '↕', label: 'Expand', text: 'Expand this section with more detail and supporting evidence' },
  { icon: '💼', label: 'C-Suite tone', text: 'Rewrite this section for a C-suite executive audience — strategic, concise, outcome-focused' },
  { icon: '🔥', label: 'More urgent', text: 'Rewrite this section to feel more urgent and compelling' },
  { icon: '📊', label: 'Add stats', text: 'Enhance this section by adding relevant statistics, percentages, or data points' },
  { icon: '◈', label: 'Restyle', text: 'Restyle this section — make it more visually striking' },
  { icon: '🌍', label: 'Simplify', text: 'Rewrite this section in plain, simple language anyone can understand' },
];

const CONTENT_CHIPS_DECK = [
  { icon: '✎', label: 'Rewrite all', text: 'Rewrite all section copy to be more compelling and polished' },
  { icon: '✂', label: 'Shorten all', text: 'Make every section more concise — trim to essentials' },
  { icon: '💼', label: 'C-Suite tone', text: 'Rewrite all copy for a C-suite executive audience — strategic, concise, outcome-focused' },
  { icon: '🏢', label: 'CTO audience', text: 'Rewrite all copy for a technical CTO audience' },
  { icon: '🔥', label: 'More urgent', text: 'Rewrite all sections to feel more urgent and action-oriented' },
  { icon: '🤝', label: 'Warmer tone', text: 'Make the full proposal tone warmer and more conversational' },
  { icon: '📊', label: 'Add stats', text: 'Enhance sections by adding relevant statistics and data points throughout' },
  { icon: '🌍', label: 'Simplify', text: 'Rewrite the entire deck in plain, simple language anyone can understand' },
];

// ── Panel ─────────────────────────────────────────────────────────────────

interface Props {
  ast: LayoutAST;
  namespace: string;
  proposalId: string;
  targetSectionId?: string;
  initialInstruction?: string;
  initialTab?: 'design' | 'content';
  onApply: (newAst: LayoutAST) => void;
  onClose: () => void;
  onPreview?: (previewAst: LayoutAST | null) => void;
  onRunningChange?: (running: boolean) => void;
}

type Step = 'idle' | 'running' | 'done';

function ColorSwatch({ hex }: { hex: string }) {
  if (!hex.startsWith('#')) return null;
  return (
    <span style={{
      display: 'inline-block',
      width: 12, height: 12,
      borderRadius: 3,
      background: hex,
      border: '1px solid rgba(0,0,0,0.12)',
      verticalAlign: 'middle',
      marginRight: 3,
      flexShrink: 0,
    }} />
  );
}

export function DesignAgentPanel({
  ast,
  namespace,
  proposalId,
  targetSectionId,
  initialInstruction,
  initialTab,
  onApply,
  onClose,
  onPreview,
  onRunningChange,
}: Props) {
  const { apiKey } = useAuth();
  const [activeTab, setActiveTab] = useState<'design' | 'content'>(initialTab ?? 'design');
  const [instruction, setInstruction] = useState(initialInstruction ?? '');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    ast: LayoutAST;
    mode: string;
    summary: string;
    changed: string[];
    tokensBefore: Record<string, unknown>;
    tokensAfter: Record<string, unknown>;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (initialInstruction) setInstruction(initialInstruction);
  }, [initialInstruction]);

  async function handleGenerate() {
    if (!instruction.trim() || step === 'running') return;
    setError('');
    setResult(null);
    onPreview?.(null);
    setStep('running');
    onRunningChange?.(true);

    try {
      const apiResult = await designEditMicrosite(apiKey, namespace, proposalId, {
        instruction: instruction.trim(),
        targetSectionId,
        currentAst: ast,
        commit: false,
      });

      // Debug: log to console so we can see what came back
      console.log('[DesignAI] API result:', {
        mode: apiResult.mode,
        changed: apiResult.changed,
        summary: apiResult.summary,
        customTokens: (apiResult.ast as Record<string, unknown>)?.['customTokens'],
        customFonts: (apiResult.ast as Record<string, unknown>)?.['customFonts'],
      });

      const newAst = apiResult.ast as LayoutAST;
      const tokensBefore = (ast.customTokens ?? {}) as Record<string, unknown>;
      const tokensAfter = (newAst.customTokens ?? {}) as Record<string, unknown>;

      setResult({
        ast: newAst,
        mode: apiResult.mode,
        summary: apiResult.summary,
        changed: apiResult.changed,
        tokensBefore,
        tokensAfter,
      });

      onPreview?.(newAst);
      onRunningChange?.(false);
      setStep('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[DesignAI] Error:', err);
      setError(msg);
      onRunningChange?.(false);
      setStep('idle');
    }
  }

  function handleApply() {
    if (!result) return;
    onPreview?.(null);
    onApply(result.ast);
    onClose();
  }

  function handleRevert() {
    setResult(null);
    onPreview?.(null);
    setStep('idle');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleGenerate();
    }
  }

  const changedTokens = result
    ? Object.keys(result.tokensAfter).filter(k => result.tokensAfter[k] !== result.tokensBefore[k])
    : [];

  // When preview is ready, collapse to a bottom bar so the canvas is fully visible
  if (step === 'done' && result) {
    return (
      <div style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10100,
        background: '#0f172a',
        border: '1px solid rgba(99,102,241,0.35)',
        borderRadius: 16,
        boxShadow: '0 8px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(99,102,241,0.2)',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        minWidth: 460,
        maxWidth: 640,
      }}>
        <span style={{ fontSize: 16 }}>✦</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#818cf8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {result.summary || 'Design updated'}
          </div>
          <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
            Previewing changes — scroll to review
          </div>
        </div>
        <button onClick={handleRevert} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#94a3b8', whiteSpace: 'nowrap' }}>
          ✕ Revert
        </button>
        <button
          onClick={() => { setResult(null); onPreview?.(null); setStep('idle'); }}
          style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.10)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#818cf8', whiteSpace: 'nowrap' }}
        >
          ↺ Refine
        </button>
        <button
          onClick={handleApply}
          disabled={result.changed.length === 0}
          style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: result.changed.length === 0 ? '#334155' : 'linear-gradient(135deg,#6366f1,#4f46e5)', color: result.changed.length === 0 ? '#475569' : '#fff', fontSize: 12, fontWeight: 700, cursor: result.changed.length === 0 ? 'not-allowed' : 'pointer', boxShadow: result.changed.length === 0 ? 'none' : '0 2px 8px rgba(99,102,241,0.4)', whiteSpace: 'nowrap' }}
        >
          ✓ Apply
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 360,
        background: '#0f172a',
        zIndex: 10100,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        boxShadow: '-8px 0 48px rgba(0,0,0,0.40)',
        color: '#e2e8f0',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        height: 56,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 28, height: 28,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #6366f1, #818cf8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14,
          }}>✦</span>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>
            Design AI
            {targetSectionId && (
              <span style={{ fontSize: 10, fontWeight: 500, color: '#6366f1', marginLeft: 6, background: 'rgba(99,102,241,0.15)', padding: '1px 6px', borderRadius: 6 }}>
                Section
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => { onPreview?.(null); onClose(); }}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6,
            cursor: 'pointer',
            color: '#94a3b8',
            fontSize: 13,
            padding: '4px 8px',
            lineHeight: 1,
          }}
          aria-label="Close"
        >
          <Icon icon={X} size="md" />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Input area */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            What do you want to change?
          </div>
          <textarea
            ref={textareaRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              targetSectionId
                ? 'Describe the change — e.g. "Rewrite the headline to be more urgent"'
                : activeTab === 'content'
                  ? 'Describe the copy change — e.g. "Rewrite everything for a technical CTO"'
                  : 'Describe the look — e.g. "Make it darker with a gold accent and luxury feel"'
            }
            rows={3}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 10,
              border: '1.5px solid rgba(255,255,255,0.10)',
              background: 'rgba(255,255,255,0.05)',
              fontSize: 13,
              color: '#f1f5f9',
              resize: 'vertical',
              fontFamily: 'inherit',
              lineHeight: 1.6,
              boxSizing: 'border-box',
              outline: 'none',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#6366f1'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }}
            disabled={step === 'running'}
          />
          <div style={{ fontSize: 10, color: '#334155', marginTop: 4, textAlign: 'right' }}>
            ⌘↵ to generate
          </div>
        </div>

        {/* Tab switcher + chips */}
        {step === 'idle' && !result && (
          <div>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
              {(['design', 'content'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    borderRadius: 7,
                    border: '1px solid',
                    borderColor: activeTab === tab ? '#6366f1' : 'rgba(255,255,255,0.08)',
                    background: activeTab === tab ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.03)',
                    color: activeTab === tab ? '#818cf8' : '#64748b',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    transition: 'all 0.12s',
                  }}
                >
                  {tab === 'design' ? '🎨 Design' : '✍️ Content'}
                </button>
              ))}
            </div>

            {/* Scope badge — only for content tab */}
            {activeTab === 'content' && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', borderRadius: 7, marginBottom: 6,
                background: targetSectionId ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${targetSectionId ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.08)'}`,
              }}>
                <span style={{ fontSize: 11 }}>{targetSectionId ? '📍' : '🌐'}</span>
                <span style={{ fontSize: 11, color: targetSectionId ? '#818cf8' : '#64748b', fontWeight: 600 }}>
                  {targetSectionId
                    ? `Section: ${ast.sections.find(s => s.id === targetSectionId)?.heading || ast.sections.find(s => s.id === targetSectionId)?.sectionType || 'selected section'}`
                    : 'Entire deck — all sections'}
                </span>
              </div>
            )}

            {/* Chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(activeTab === 'design' ? DESIGN_CHIPS : targetSectionId ? CONTENT_CHIPS_SECTION : CONTENT_CHIPS_DECK).map((chip) => (
                <button
                  key={chip.text}
                  onClick={() => {
                    setInstruction(chip.text);
                    textareaRef.current?.focus();
                  }}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 20,
                    border: '1px solid',
                    borderColor: instruction === chip.text ? '#6366f1' : 'rgba(255,255,255,0.10)',
                    background: instruction === chip.text ? 'rgba(99,102,241,0.20)' : 'rgba(255,255,255,0.04)',
                    color: instruction === chip.text ? '#818cf8' : '#94a3b8',
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    transition: 'all 0.12s',
                    whiteSpace: activeTab === 'design' ? 'nowrap' : 'normal',
                    textAlign: 'left',
                    lineHeight: 1.4,
                  }}
                >
                  <span style={{ flexShrink: 0 }}>{chip.icon}</span>
                  {'label' in chip ? (chip as { label: string }).label : chip.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {step === 'running' && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '16px',
            background: 'rgba(99,102,241,0.08)',
            borderRadius: 10,
            border: '1px solid rgba(99,102,241,0.20)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ animation: 'dap-spin 0.9s linear infinite', display: 'inline-block', fontSize: 16 }}>⟳</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#818cf8' }}>Generating design…</span>
            </div>
            <div style={{ fontSize: 11, color: '#475569' }}>
              Claude is synthesizing your design changes. This may take a moment.
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            padding: '12px 14px',
            background: 'rgba(239,68,68,0.10)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 10,
            fontSize: 12,
            color: '#fca5a5',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>Error</div>
            {error}
          </div>
        )}

        {/* Result */}
        {result && step === 'done' && (
          <div style={{
            background: 'rgba(99,102,241,0.08)',
            border: '1px solid rgba(99,102,241,0.20)',
            borderRadius: 10,
            overflow: 'hidden',
          }}>
            {/* Result header */}
            <div style={{
              padding: '10px 14px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span style={{ fontSize: 14 }}>✦</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#818cf8' }}>
                {result.summary || 'Design updated'}
              </span>
            </div>

            {/* Changed tokens */}
            {changedTokens.length > 0 && (
              <div style={{ padding: '10px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Changed ({changedTokens.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {changedTokens.slice(0, 8).map(key => {
                    const before = result.tokensBefore[key];
                    const after = result.tokensAfter[key];
                    const isColor = typeof after === 'string' && (after as string).startsWith('#');
                    return (
                      <div key={key} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11,
                        padding: '4px 8px',
                        background: 'rgba(255,255,255,0.04)',
                        borderRadius: 6,
                      }}>
                        <span style={{ color: '#64748b', minWidth: 90, flexShrink: 0 }}>{key}</span>
                        <span style={{ color: '#334155', textDecoration: 'line-through', fontSize: 10 }}>
                          {typeof before === 'string' && (before as string).startsWith('#') && <ColorSwatch hex={before as string} />}
                          {String(before ?? '—').slice(0, 14)}
                        </span>
                        <span style={{ color: '#475569', fontSize: 10 }}>→</span>
                        <span style={{ color: '#94a3b8', fontWeight: 600 }}>
                          {isColor && <ColorSwatch hex={after as string} />}
                          {String(after ?? '—').slice(0, 14)}
                        </span>
                      </div>
                    );
                  })}
                  {changedTokens.length > 8 && (
                    <div style={{ fontSize: 10, color: '#475569', padding: '2px 8px' }}>
                      +{changedTokens.length - 8} more changes
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* No token changes notice */}
            {changedTokens.length === 0 && result.changed.length > 0 && (
              <div style={{ padding: '10px 14px', fontSize: 11, color: '#475569' }}>
                Applied: {result.changed.join(', ')}
              </div>
            )}

            {/* No changes at all */}
            {result.changed.length === 0 && (
              <div style={{ padding: '10px 14px', fontSize: 11, color: '#ef4444' }}>
                No changes were made. The AI may not have understood the instruction — try being more specific.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '14px 20px',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        {result ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleRevert}
              style={{
                flex: 1,
                padding: '9px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.10)',
                background: 'rgba(255,255,255,0.04)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                color: '#94a3b8',
              }}
            >
              Revert
            </button>
            <button
              onClick={() => {
                setResult(null);
                onPreview?.(null);
                setStep('idle');
                textareaRef.current?.focus();
              }}
              style={{
                flex: 1,
                padding: '9px 12px',
                borderRadius: 8,
                border: '1px solid rgba(99,102,241,0.3)',
                background: 'rgba(99,102,241,0.10)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                color: '#818cf8',
              }}
            >
              Refine
            </button>
            <button
              onClick={handleApply}
              disabled={result.changed.length === 0}
              style={{
                flex: 2,
                padding: '9px 12px',
                borderRadius: 8,
                border: 'none',
                background: result.changed.length === 0 ? '#334155' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                color: result.changed.length === 0 ? '#475569' : '#fff',
                fontSize: 12,
                fontWeight: 700,
                cursor: result.changed.length === 0 ? 'not-allowed' : 'pointer',
                boxShadow: result.changed.length === 0 ? 'none' : '0 2px 8px rgba(99,102,241,0.4)',
              }}
            >
              Apply changes
            </button>
          </div>
        ) : (
          <button
            onClick={() => { void handleGenerate(); }}
            disabled={!instruction.trim() || step === 'running'}
            style={{
              width: '100%',
              padding: '11px 12px',
              borderRadius: 8,
              border: 'none',
              background: !instruction.trim() || step === 'running'
                ? 'rgba(255,255,255,0.06)'
                : 'linear-gradient(135deg, #6366f1, #4f46e5)',
              color: !instruction.trim() || step === 'running' ? '#475569' : '#fff',
              fontSize: 13,
              fontWeight: 700,
              cursor: !instruction.trim() || step === 'running' ? 'not-allowed' : 'pointer',
              boxShadow: !instruction.trim() || step === 'running' ? 'none' : '0 2px 12px rgba(99,102,241,0.4)',
              transition: 'all 0.15s',
            }}
          >
            {step === 'running' ? '⟳ Generating…' : '✦ Generate'}
          </button>
        )}
      </div>

      <style>{`
        @keyframes dap-spin { to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.10); border-radius: 4px; }
      `}</style>
    </div>
  );
}
