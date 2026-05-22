'use client';

import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import type { LayoutAST } from '../../../types/presentation';

// ── Chips ─────────────────────────────────────────────────────────────────────
// Design chips: instruct the LLM to restyle the section HTML (CSS + layout).
// All chips route through editSectionHtml — the LLM updates the <style> block.

const DESIGN_CHIPS = [
  { icon: '🌑', label: 'Darker',     text: 'Make the design darker and more dramatic — deepen background and shadow colors in the CSS' },
  { icon: '💎', label: 'Luxury',     text: 'Redesign with a luxury feel — deep dark background, gold accent color, premium typography' },
  { icon: '🪟', label: 'Glass',      text: 'Add glassmorphic frosted-glass panels — backdrop-filter blur, semi-transparent backgrounds' },
  { icon: '⚡', label: 'Cyberpunk',  text: 'Redesign with cyberpunk neon — dark background, bright neon accent color, glitch aesthetics' },
  { icon: '📖', label: 'Editorial',  text: 'Redesign with an editorial style — light background, airy layout, serif heading font' },
  { icon: '🎮', label: 'Playful',    text: 'Redesign with a playful rounded style — bright accent color, soft border-radius, fun spacing' },
  { icon: '⬛', label: 'Brutalist',  text: 'Redesign with a brutalist style — stark high contrast, heavy borders, oversized bold typography' },
  { icon: '🌿', label: 'Earthy',     text: 'Redesign with warm earthy tones — terracotta, beige, forest green color palette' },
  { icon: '✨', label: 'Animations', text: 'Add smooth CSS scroll animations — staggered fade-up, slide-in from edges on all elements' },
  { icon: '〰', label: 'Dividers',   text: 'Add wavy SVG decorative dividers at the top and bottom of this section' },
  { icon: '✋', label: 'Hover FX',   text: 'Add hover lift and glow effects to all cards, buttons, and interactive elements' },
];

const CONTENT_CHIPS_SECTION = [
  { icon: '✎', label: 'Rewrite',     text: 'Rewrite this section with improved, more compelling copy' },
  { icon: '✂', label: 'Shorten',     text: 'Make this section more concise — trim to 3 bullet points max' },
  { icon: '↕', label: 'Expand',      text: 'Expand this section with more detail and supporting evidence' },
  { icon: '💼', label: 'C-Suite',    text: 'Rewrite this section for a C-suite executive audience — strategic, concise, outcome-focused' },
  { icon: '🔥', label: 'Urgent',     text: 'Rewrite this section to feel more urgent and compelling' },
  { icon: '📊', label: 'Add stats',  text: 'Enhance this section by adding relevant statistics, percentages, or data points' },
  { icon: '◈', label: 'Restyle',     text: 'Restyle this section layout and visual design — make it more striking' },
  { icon: '🌍', label: 'Simplify',   text: 'Rewrite this section in plain, simple language anyone can understand' },
];

const CONTENT_CHIPS_DECK = [
  { icon: '✎', label: 'Rewrite all',  text: 'Rewrite all section copy to be more compelling and polished' },
  { icon: '✂', label: 'Shorten all',  text: 'Make every section more concise — trim to essentials' },
  { icon: '💼', label: 'C-Suite',     text: 'Rewrite all copy for a C-suite executive audience — strategic, concise, outcome-focused' },
  { icon: '🏢', label: 'CTO',         text: 'Rewrite all copy for a technical CTO audience' },
  { icon: '🔥', label: 'More urgent', text: 'Rewrite all sections to feel more urgent and action-oriented' },
  { icon: '🤝', label: 'Warmer',      text: 'Make the full proposal tone warmer and more conversational' },
  { icon: '📊', label: 'Add stats',   text: 'Enhance sections by adding relevant statistics and data points throughout' },
  { icon: '🌍', label: 'Simplify',    text: 'Rewrite the entire deck in plain, simple language anyone can understand' },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  ast: LayoutAST;
  targetSectionId?: string;
  initialInstruction?: string;
  initialTab?: 'design' | 'content';
  /** Applies instruction as an HTML edit via editSectionHtml. Required. */
  onContentApply: (instruction: string, targetSectionId?: string) => Promise<{ sectionsUpdated: number }>;
  onClose: () => void;
}

export function DesignAgentPanelPro({
  ast,
  targetSectionId,
  initialInstruction,
  initialTab,
  onContentApply,
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<'design' | 'content'>(initialTab ?? 'design');
  const [instruction, setInstruction] = useState(initialInstruction ?? '');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);
  useEffect(() => { if (initialInstruction) setInstruction(initialInstruction); }, [initialInstruction]);

  async function handleGenerate() {
    if (!instruction.trim() || running) return;
    setError('');
    setSuccessMsg('');
    setRunning(true);

    try {
      // Detect if a section name is mentioned (e.g. "change hero background")
      const lower = instruction.toLowerCase();
      const mentionedSection = targetSectionId
        ? undefined
        : ast.sections.find(s =>
            lower.includes(s.sectionType.toLowerCase()) ||
            (s.heading && lower.includes(s.heading.toLowerCase().split(' ')[0])),
          );

      // All instructions edit section HTML directly — the LLM updates the <style>
      // block and layout inside each section's HTML string.
      const resolvedTarget = mentionedSection?.id ?? targetSectionId;
      const res = await onContentApply(instruction.trim(), resolvedTarget);
      const n = res.sectionsUpdated;

      setRunning(false);
      setSuccessMsg(`✓ ${n} section${n === 1 ? '' : 's'} updated`);
      setTimeout(() => { setSuccessMsg(''); onClose(); }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  }

  const targetSection = targetSectionId ? ast.sections.find(s => s.id === targetSectionId) : undefined;
  const scopeLabel = targetSection
    ? (targetSection.heading || targetSection.sectionType)
    : 'Entire deck';

  const chips = activeTab === 'design'
    ? DESIGN_CHIPS
    : targetSectionId ? CONTENT_CHIPS_SECTION : CONTENT_CHIPS_DECK;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 360,
      background: '#0f172a', zIndex: 10100, display: 'flex', flexDirection: 'column',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxShadow: '-8px 0 48px rgba(0,0,0,0.40)', color: '#e2e8f0',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', height: 56, borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#6366f1,#818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>✦</span>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>
            Design AI
            {targetSectionId && (
              <span style={{ fontSize: 10, fontWeight: 500, color: '#6366f1', marginLeft: 6, background: 'rgba(99,102,241,0.15)', padding: '1px 6px', borderRadius: 6 }}>
                {targetSection?.sectionType ?? 'Section'}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, cursor: 'pointer', color: '#94a3b8', fontSize: 13, padding: '4px 8px', lineHeight: 1 }}
          aria-label="Close"
        >
          <Icon icon={X} size="md" />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Textarea */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            What do you want to change?
          </div>
          <textarea
            ref={textareaRef}
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleGenerate(); } }}
            placeholder={
              targetSectionId
                ? 'e.g. "Change background to dark blue", "Rewrite the headline"'
                : activeTab === 'design'
                  ? 'e.g. "Change background to green", "Make it darker with gold accent"'
                  : 'e.g. "Rewrite everything for a technical CTO audience"'
            }
            rows={3}
            disabled={running}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 10,
              border: '1.5px solid rgba(255,255,255,0.10)',
              background: 'rgba(255,255,255,0.05)', fontSize: 13, color: '#f1f5f9',
              resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6,
              boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.15s',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#6366f1'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }}
          />
          <div style={{ fontSize: 10, color: '#334155', marginTop: 4, textAlign: 'right' }}>⌘↵ to generate</div>
        </div>

        {/* Tabs + scope badge + chips */}
        {!running && !successMsg && (
          <div>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {(['design', 'content'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  flex: 1, padding: '6px 0', borderRadius: 7, border: '1px solid',
                  borderColor: activeTab === tab ? '#6366f1' : 'rgba(255,255,255,0.08)',
                  background: activeTab === tab ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.03)',
                  color: activeTab === tab ? '#818cf8' : '#64748b',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  textTransform: 'uppercase', letterSpacing: '0.06em', transition: 'all 0.12s',
                }}>
                  {tab === 'design' ? '🎨 Design' : '✍️ Content'}
                </button>
              ))}
            </div>

            {/* Scope badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
              borderRadius: 7, marginBottom: 8,
              background: targetSectionId ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${targetSectionId ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.08)'}`,
            }}>
              <span style={{ fontSize: 11 }}>{targetSectionId ? '📍' : '🌐'}</span>
              <span style={{ fontSize: 11, color: targetSectionId ? '#818cf8' : '#64748b', fontWeight: 600 }}>
                {scopeLabel}
              </span>
            </div>

            {/* Chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {chips.map(chip => (
                <button
                  key={chip.text}
                  onClick={() => { setInstruction(chip.text); textareaRef.current?.focus(); }}
                  style={{
                    padding: '5px 10px', borderRadius: 20, border: '1px solid',
                    borderColor: instruction === chip.text ? '#6366f1' : 'rgba(255,255,255,0.10)',
                    background: instruction === chip.text ? 'rgba(99,102,241,0.20)' : 'rgba(255,255,255,0.04)',
                    color: instruction === chip.text ? '#818cf8' : '#94a3b8',
                    fontSize: 11, fontWeight: 500, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 4,
                    transition: 'all 0.12s', whiteSpace: 'nowrap',
                  }}
                >
                  <span>{chip.icon}</span>
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {running && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16, background: 'rgba(99,102,241,0.08)', borderRadius: 10, border: '1px solid rgba(99,102,241,0.20)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ animation: 'dap-spin 0.9s linear infinite', display: 'inline-block', fontSize: 16 }}>⟳</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#818cf8' }}>
                {activeTab === 'design' ? 'Applying design changes…' : 'Applying content edits…'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#475569' }}>
              Editing {targetSectionId ? 'section' : 'all sections'} HTML & CSS…
            </div>
          </div>
        )}

        {/* Success flash */}
        {successMsg && (
          <div style={{ padding: '10px 14px', background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 10, fontSize: 12, color: '#4ade80', fontWeight: 600 }}>
            {successMsg}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: '12px 14px', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, fontSize: 12, color: '#fca5a5' }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>Error</div>
            {error}
          </div>
        )}

      </div>

      {/* Footer */}
      <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
        <button
          onClick={() => { void handleGenerate(); }}
          disabled={!instruction.trim() || running}
          style={{
            width: '100%', padding: '11px 12px', borderRadius: 8, border: 'none',
            background: !instruction.trim() || running ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg,#6366f1,#4f46e5)',
            color: !instruction.trim() || running ? '#475569' : '#fff',
            fontSize: 13, fontWeight: 700,
            cursor: !instruction.trim() || running ? 'not-allowed' : 'pointer',
            boxShadow: !instruction.trim() || running ? 'none' : '0 2px 12px rgba(99,102,241,0.4)',
            transition: 'all 0.15s',
          }}
        >
          {running ? '⟳ Generating…' : '✦ Generate'}
        </button>
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
