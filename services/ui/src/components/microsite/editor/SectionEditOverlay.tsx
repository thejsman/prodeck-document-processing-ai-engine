'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useEditContext } from './EditContext';
import type { LayoutSection } from '../../../types/presentation';
// ── Colour swatch presets ─────────────────────────────────────────────────────

const BG_PRESETS = [
  { label: 'Surface', value: 'var(--ms-surface)' },
  { label: 'Surface Alt', value: 'var(--ms-surface-alt)' },
  { label: 'Dark', value: '#0a0a0a' },
  { label: 'White', value: '#ffffff' },
  { label: 'Indigo', value: '#1e1b4b' },
  { label: 'Slate', value: '#0f172a' },
  { label: 'Rose', value: '#1c0a0e' },
  { label: 'Teal', value: '#042f2e' },
  { label: 'Accent tint', value: 'rgba(var(--ms-accent-rgb,99,102,241),0.08)' },
];
// ── Icon picker ────────────────────────────────────────────────────────────────

const ICON_HINTS = [
  { hint: 'identity',  emoji: '👤', label: 'Identity' },
  { hint: 'digital',   emoji: '💻', label: 'Digital' },
  { hint: 'content',   emoji: '📄', label: 'Content' },
  { hint: 'strategy',  emoji: '⭐', label: 'Strategy' },
  { hint: 'research',  emoji: '🔍', label: 'Research' },
  { hint: 'launch',    emoji: '🚀', label: 'Launch' },
  { hint: 'document',  emoji: '📁', label: 'Document' },
  { hint: 'website',   emoji: '🌐', label: 'Website' },
  { hint: 'photo',     emoji: '🖼', label: 'Photo' },
  { hint: 'campaign',  emoji: '📢', label: 'Campaign' },
  { hint: 'default',   emoji: '⊞',  label: 'Grid' },
  { hint: 'check',     emoji: '✓',  label: 'Check' },
  { hint: 'star',      emoji: '✦',  label: 'Star' },
  { hint: 'lock',      emoji: '🔒', label: 'Lock' },
  { hint: 'bolt',      emoji: '⚡', label: 'Bolt' },
  { hint: 'target',    emoji: '🎯', label: 'Target' },
  { hint: 'chart',     emoji: '📊', label: 'Chart' },
  { hint: 'tool',      emoji: '🔧', label: 'Tool' },
  { hint: 'gem',       emoji: '💎', label: 'Gem' },
  { hint: 'trophy',    emoji: '🏆', label: 'Trophy' },
  { hint: 'shield',    emoji: '🛡',  label: 'Shield' },
  { hint: 'flag',      emoji: '🚩', label: 'Flag' },
  { hint: 'leaf',      emoji: '🌿', label: 'Leaf' },
  { hint: 'fire',      emoji: '🔥', label: 'Fire' },
];

function IconPickerPanel({
  sectionId,
  fieldPath,
  currentHint,
  onClose,
}: {
  sectionId: string;
  fieldPath: string;
  currentHint: string;
  onClose: () => void;
}) {
  const ctx = useEditContext()!;

  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 8,
        zIndex: 25000,
        width: 280,
        background: '#fff',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        border: '1px solid #e2e8f0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Pick Icon
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 10, color: '#94a3b8' }}>
          Field: <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>{fieldPath}</code>
        </p>
      </div>
      <div style={{ padding: 10, display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
        {ICON_HINTS.map(({ hint, emoji, label }) => (
          <button
            key={hint}
            title={label}
            onClick={() => { ctx.updateField(sectionId, fieldPath, hint); onClose(); }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 6,
              border: currentHint === hint ? '2px solid #6366f1' : '1px solid #e2e8f0',
              background: currentHint === hint ? '#f5f3ff' : '#f8fafc',
              fontSize: 18,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.1s',
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div style={{ padding: '8px 12px', borderTop: '1px solid #e2e8f0' }}>
        <label style={{ fontSize: 10, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Custom hint text
        </label>
        <input
          type="text"
          defaultValue={currentHint}
          placeholder="e.g. check, star, rocket…"
          onKeyDown={e => {
            if (e.key === 'Enter') {
              ctx.updateField(sectionId, fieldPath, (e.target as HTMLInputElement).value);
              onClose();
            }
          }}
          style={{ width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid #e2e8f0', fontSize: 12, boxSizing: 'border-box' }}
        />
      </div>
    </div>
  );
}

// ── Background picker panel ───────────────────────────────────────────────────

function BackgroundPanel({
  section,
  onClose,
}: {
  section: LayoutSection;
  onClose: () => void;
}) {
  const ctx = useEditContext()!;
  const [tab, setTab] = useState<'image' | 'color' | 'upload'>('image');
  const [imgUrl, setImgUrl] = useState(section.image?.url ?? '');
  const [imgQuery, setImgQuery] = useState(section.image?.query ?? '');

  function applyImage() {
    ctx.updateField(section.id, '__bgColor', '');   // clear solid color override
    if (imgUrl.trim()) {
      ctx.updateField(section.id, '__imageUrl', imgUrl.trim());
      ctx.updateField(section.id, '__imageSource', 'custom');
    }
    if (imgQuery.trim()) ctx.updateField(section.id, '__imageQuery', imgQuery.trim());
    onClose();
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      ctx.updateField(section.id, '__bgColor', '');  // clear solid color override
      ctx.updateField(section.id, '__imageUrl', dataUrl);
      ctx.updateField(section.id, '__imageSource', 'custom');
      onClose();
    };
    reader.onerror = () => onClose();
    reader.readAsDataURL(file);
  }

  function resetToTheme() {
    ctx.updateField(section.id, '__bgColor', '');
    ctx.updateField(section.id, '__imageUrl', null);
    ctx.updateField(section.id, '__imageSource', 'gradient');
    onClose();
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 8,
        zIndex: 25000,
        width: 340,
        background: '#fff',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        border: '1px solid #e2e8f0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0' }}>
        {(['image', 'color', 'upload'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '10px 0',
              border: 'none',
              background: tab === t ? '#f5f3ff' : '#fff',
              color: tab === t ? '#6366f1' : '#64748b',
              fontWeight: tab === t ? 700 : 500,
              fontSize: 11,
              cursor: 'pointer',
              borderBottom: tab === t ? '2px solid #6366f1' : '2px solid transparent',
            }}
          >
            {t === 'image' ? '🔗 URL' : t === 'color' ? '🎨 Color' : '⬆ Upload'}
          </button>
        ))}
      </div>

      <div style={{ padding: 14 }}>
        {tab === 'image' ? (
          <>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Search query
            </label>
            <input
              type="text"
              value={imgQuery}
              onChange={e => setImgQuery(e.target.value)}
              placeholder="e.g. modern office collaboration"
              style={{ width: '100%', padding: '7px 9px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, marginBottom: 10, boxSizing: 'border-box' }}
            />
            <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Image URL
            </label>
            <input
              type="text"
              value={imgUrl}
              onChange={e => setImgUrl(e.target.value)}
              placeholder="https://images.unsplash.com/…"
              style={{ width: '100%', padding: '7px 9px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, marginBottom: 10, boxSizing: 'border-box' }}
            />
            {imgUrl && (
              <div style={{ borderRadius: 6, overflow: 'hidden', height: 80, marginBottom: 10 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imgUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { ctx.updateField(section.id, '__bgColor', ''); ctx.updateField(section.id, '__imageUrl', null); ctx.updateField(section.id, '__imageSource', 'gradient'); onClose(); }}
                style={{ flex: 1, padding: '7px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#475569' }}
              >
                Use gradient
              </button>
              <button
                onClick={applyImage}
                style={{ flex: 2, padding: '7px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                Apply
              </button>
            </div>
          </>
        ) : tab === 'upload' ? (
          <>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Upload image file
            </label>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '20px',
                border: '2px dashed #c7d2fe',
                borderRadius: 8,
                background: '#f5f3ff',
                cursor: 'pointer',
                marginBottom: 10,
              }}
            >
              <span style={{ fontSize: 24 }}>⬆</span>
              <span style={{ fontSize: 12, color: '#6366f1', fontWeight: 600 }}>Click to upload</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>PNG, JPG, WebP, SVG</span>
              <input type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
            </label>
            {section.image?.url?.startsWith('data:') && (
              <div style={{ borderRadius: 6, overflow: 'hidden', height: 60 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={section.image.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
          </>
        ) : (
          <>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Custom color
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <input
                type="color"
                defaultValue="#1e293b"
                onChange={e => { ctx.updateField(section.id, '__imageUrl', null); ctx.updateField(section.id, '__bgColor', e.target.value); }}
                style={{ width: 40, height: 36, borderRadius: 6, border: '1px solid #e2e8f0', cursor: 'pointer', padding: 2 }}
              />
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Pick any background color</span>
            </div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Presets
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {BG_PRESETS.map(preset => (
                <button
                  key={preset.label}
                  onClick={() => { ctx.updateField(section.id, '__imageUrl', null); ctx.updateField(section.id, '__bgColor', preset.value); onClose(); }}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 100,
                    border: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    color: '#475569',
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Reset to theme default */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid #e2e8f0' }}>
        <button
          onClick={resetToTheme}
          style={{
            width: '100%', padding: '7px', borderRadius: 6,
            border: '1px solid #e2e8f0', background: '#f8fafc',
            color: '#64748b', fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}
        >
          ↺ Reset to theme default
        </button>
      </div>
    </div>
  );
}

// ── Section layout variant definitions ───────────────────────────────────────

const SECTION_VARIANTS: Record<string, { id: string; label: string; icon: string; desc: string }[]> = {
  hero: [
    { id: 'centered',     label: 'Centered',     icon: '⊡', desc: 'Centered headline + CTA' },
    { id: 'split',        label: 'Split',        icon: '⊞', desc: 'Text left, visual right' },
    { id: 'asymmetric',   label: 'Asymmetric',   icon: '⊟', desc: 'Bold headline + aside' },
    { id: 'editorial',    label: 'Editorial',    icon: '⊠', desc: 'Magazine-style layout' },
    { id: 'card-grid',    label: 'Card Grid',    icon: '▦', desc: 'Full-width card grid' },
    { id: 'type-forward', label: 'Type Forward', icon: '⊞', desc: 'Typography-first hero' },
  ],
  approach: [
    { id: 'grid', label: 'Grid',  icon: '▦', desc: 'Cards in a responsive grid' },
    { id: 'list', label: 'List',  icon: '☰', desc: 'Rows with icon + text side-by-side' },
  ],
  benefits: [
    { id: 'grid', label: 'Grid', icon: '▦', desc: 'Cards in a responsive grid' },
    { id: 'list', label: 'List', icon: '☰', desc: 'Full-width rows' },
  ],
  deliverables: [
    { id: 'grid', label: 'Grid', icon: '▦', desc: 'Cards in a responsive grid' },
    { id: 'list', label: 'List', icon: '☰', desc: 'Full-width rows' },
  ],
  security: [
    { id: 'grid', label: 'Grid', icon: '▦', desc: 'Items in a responsive grid' },
    { id: 'list', label: 'List', icon: '☰', desc: 'Rows with large icon + text' },
  ],
  team: [
    { id: 'grid', label: 'Grid', icon: '▦', desc: 'Centered profile cards' },
    { id: 'list', label: 'List', icon: '☰', desc: 'Avatar left, bio right' },
  ],
  timeline: [
    { id: 'vertical',   label: 'Vertical',   icon: '⬇', desc: 'Spine on left, cards right' },
    { id: 'horizontal', label: 'Horizontal', icon: '⮕', desc: 'Phases in a row' },
  ],
  faq: [
    { id: 'accordion',  label: 'Accordion',  icon: '⊟', desc: 'Collapsible Q&A rows' },
    { id: 'two-column', label: 'Two Column', icon: '⊞', desc: 'All items always visible' },
  ],
  problem: [
    { id: 'list', label: 'List', icon: '☰', desc: 'Stacked pain point rows' },
    { id: 'grid', label: 'Grid', icon: '▦', desc: '2-column pain point cards' },
  ],
};

const VARIANT_DEFAULTS: Record<string, string> = {
  hero: 'centered',
  approach: 'grid',
  benefits: 'grid',
  deliverables: 'grid',
  security: 'grid',
  team: 'grid',
  timeline: 'vertical',
  faq: 'accordion',
  problem: 'list',
};

function LayoutVariantPanel({
  section,
  onClose,
}: {
  section: LayoutSection;
  onClose: () => void;
}) {
  const ctx = useEditContext()!;
  const variants = SECTION_VARIANTS[section.sectionType];

  if (!variants) return null;

  const content = section.content as unknown as Record<string, unknown>;
  const current = (content.variant as string) ?? VARIANT_DEFAULTS[section.sectionType] ?? variants[0].id;

  return (
    <div style={{
      position: 'absolute', top: '100%', left: 8, zIndex: 25000,
      background: '#fff', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      border: '1px solid #e2e8f0', fontFamily: 'system-ui', overflow: 'hidden', width: 240,
    }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Layout
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 10, color: '#94a3b8' }}>
          {section.sectionType} section
        </p>
      </div>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {variants.map(v => (
          <button
            key={v.id}
            onClick={() => { ctx.updateField(section.id, 'variant', v.id); onClose(); }}
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              border: 'none',
              background: current === v.id ? '#f5f3ff' : 'transparent',
              color: current === v.id ? '#6366f1' : '#475569',
              fontSize: 12,
              fontWeight: current === v.id ? 700 : 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              textAlign: 'left',
              transition: 'background 0.1s',
            }}
          >
            <span style={{ fontSize: 15 }}>{v.icon}</span>
            <span style={{ flex: 1 }}>
              {v.label}
              <span style={{ display: 'block', fontSize: 10, color: current === v.id ? '#818cf8' : '#94a3b8', fontWeight: 400 }}>
                {v.desc}
              </span>
            </span>
            {current === v.id && <span style={{ fontSize: 10, color: '#6366f1' }}>✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Embed media panel ─────────────────────────────────────────────────────────

function EmbedPanel({ section, onClose }: { section: LayoutSection; onClose: () => void }) {
  const ctx = useEditContext()!;
  const [url, setUrl] = useState((section.embed?.url) ?? '');
  const [title, setTitle] = useState((section.embed?.title) ?? '');

  function detectType(u: string): string {
    if (u.match(/youtube\.com|youtu\.be/)) return 'YouTube';
    if (u.match(/loom\.com/)) return 'Loom';
    if (u.startsWith('http')) return 'Iframe';
    return '';
  }

  function handleSave() {
    if (!url.trim()) {
      // Remove embed
      const sections = ctx.ast.sections.map(sec =>
        sec.id === section.id ? { ...sec, embed: undefined } : sec
      ) as typeof ctx.ast.sections;
      ctx.replaceAst({ ...ctx.ast, sections });
    } else {
      const sections = ctx.ast.sections.map(sec =>
        sec.id === section.id ? { ...sec, embed: { url: url.trim(), title: title.trim() || undefined } } : sec
      ) as typeof ctx.ast.sections;
      ctx.replaceAst({ ...ctx.ast, sections });
    }
    onClose();
  }

  const detected = detectType(url);

  return (
    <div style={{
      position: 'absolute',
      top: '100%',
      left: 0,
      zIndex: 25000,
      marginTop: 6,
      background: '#fff',
      borderRadius: 10,
      boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
      border: '1px solid #e2e8f0',
      padding: 14,
      width: 320,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#1e293b' }}>📎 Embed Media</p>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: '#94a3b8' }}>Paste a YouTube, Loom, or any iframe URL</p>

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 10, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>URL</label>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 6,
            border: '1px solid #e2e8f0', fontSize: 12, outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        {detected && (
          <p style={{ margin: '4px 0 0', fontSize: 10, color: '#6366f1', fontWeight: 600 }}>✓ Detected: {detected}</p>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 10, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Caption (optional)</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Video title or description"
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 6,
            border: '1px solid #e2e8f0', fontSize: 12, outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={handleSave}
          style={{
            flex: 1, padding: '7px', borderRadius: 6, border: 'none',
            background: '#6366f1', color: '#fff', fontSize: 11, fontWeight: 700,
            cursor: 'pointer',
          }}
        >{url.trim() ? 'Embed' : 'Remove'}</button>
        <button
          onClick={onClose}
          style={{
            padding: '7px 12px', borderRadius: 6, border: '1px solid #e2e8f0',
            background: '#fff', color: '#64748b', fontSize: 11, fontWeight: 600,
            cursor: 'pointer',
          }}
        >Cancel</button>
      </div>
    </div>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────────

interface Props {
  section: LayoutSection;
  sectionIndex: number;
  totalSections: number;
  children: React.ReactNode;
  onAiAction?: (sectionId: string, instruction: string) => void;
}

const ACCENT = '#6366f1';

type ActivePanel = 'bg' | 'layout' | 'icon' | 'embed' | 'ai' | null;

export function SectionEditOverlay({ section, sectionIndex, totalSections, children, onAiAction }: Props) {
  const ctx = useEditContext();
  const [hovered, setHovered] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const togglePanel = useCallback((panel: ActivePanel) => {
    setActivePanel(prev => prev === panel ? null : panel);
  }, []);

  // Close panel when clicking outside toolbar
  useEffect(() => {
    if (!activePanel) return;
    function handleClick(e: MouseEvent) {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setActivePanel(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [activePanel]);

  // Outside editor — render children as-is
  if (!ctx) return <>{children}</>;

  const isActive = ctx.activeSectionId === section.id;

  function toolbarBtn(
    label: string,
    panelId: ActivePanel,
    onClick?: () => void,
  ) {
    const active = activePanel === panelId;
    return (
      <button
        onClick={onClick ?? (() => togglePanel(panelId))}
        style={{
          padding: '4px 10px',
          borderRadius: 100,
          border: 'none',
          background: active ? ACCENT : 'rgba(255,255,255,0.9)',
          color: active ? '#fff' : '#475569',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          whiteSpace: 'nowrap',
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => ctx.selectSection(section.id)}
      style={{
        position: 'relative',
        outline: isActive ? `2px solid ${ACCENT}` : hovered ? `2px solid ${ACCENT}55` : '2px solid transparent',
        outlineOffset: -2,
        transition: 'outline-color 0.15s, box-shadow 0.15s',
        cursor: 'pointer',
        boxShadow: isActive ? `inset 0 0 0 1px ${ACCENT}22` : 'none',
      }}
    >
      {children}

      {/* "Click text to edit" hint — shown below toolbar when section first becomes active */}
      {isActive && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 8,
            zIndex: 20000,
            background: 'rgba(99,102,241,0.9)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 600,
            padding: '3px 9px',
            borderRadius: 100,
            pointerEvents: 'none',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            letterSpacing: '0.03em',
            whiteSpace: 'nowrap',
          }}
          onClick={e => e.stopPropagation()}
        >
          ✎ Click any text to edit
        </div>
      )}

      {/* Toolbar — always visible when active, visible on hover too */}
      {(hovered || isActive) && (
        <div
          ref={toolbarRef}
          style={{
            position: 'absolute',
            top: 10,
            left: 8,
            zIndex: 20000,
            display: 'flex',
            gap: 4,
            alignItems: 'center',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Section label */}
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 100,
              background: isActive ? ACCENT : 'rgba(99,102,241,0.85)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              backdropFilter: 'blur(8px)',
            }}
          >
            {section.sectionType}
          </span>

          {/* AI quick-actions — single dropdown to keep toolbar compact */}
          {onAiAction && (
            <div style={{ position: 'relative' }}>
              {toolbarBtn('✦ AI', 'ai')}
              {activePanel === ('ai') && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    background: '#fff',
                    border: `1px solid ${ACCENT}28`,
                    borderRadius: 10,
                    boxShadow: `0 8px 24px rgba(0,0,0,0.1), 0 0 0 1px ${ACCENT}10`,
                    overflow: 'hidden',
                    minWidth: 172,
                    zIndex: 20001,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                  }}
                >
                  <div style={{ padding: '7px 12px 5px', borderBottom: `1px solid ${ACCENT}18` }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: ACCENT, letterSpacing: '0.07em', textTransform: 'uppercase' }}>✦ AI Actions</span>
                  </div>
                  {[
                    { icon: '✎', label: 'Rewrite',       desc: 'Improve copy',              instruction: 'Rewrite this section with improved copy' },
                    { icon: '✂', label: 'Shorten',       desc: 'Make concise',              instruction: 'Make this section more concise — 3 bullet points max' },
                    { icon: '↕', label: 'Expand',        desc: 'Add more detail',           instruction: 'Expand this section with more detail and supporting evidence' },
                    { icon: '💼', label: 'C-Suite tone',  desc: 'Executive-friendly',        instruction: 'Rewrite this section for a C-suite executive audience — strategic, concise, outcome-focused' },
                    { icon: '🔥', label: 'More urgent',   desc: 'Increase urgency',          instruction: 'Rewrite this section to feel more urgent and compelling' },
                    { icon: '📊', label: 'Add stats',     desc: 'Insert data points',        instruction: 'Enhance this section by adding relevant statistics, percentages, or data points' },
                    { icon: '◈', label: 'Restyle',       desc: 'New visual treatment',      instruction: 'Restyle this section — make it more visually striking' },
                    { icon: '🌍', label: 'Simplify',      desc: 'Plain language',            instruction: 'Rewrite this section in plain, simple language anyone can understand' },
                  ].map(({ icon, label, desc, instruction }) => (
                    <button
                      key={label}
                      onClick={() => { onAiAction(section.id, instruction); setActivePanel(null); }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        padding: '7px 12px',
                        border: 'none',
                        background: 'transparent',
                        color: '#1e293b',
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        textAlign: 'left',
                        whiteSpace: 'nowrap',
                        transition: 'background 0.1s',
                        fontFamily: 'inherit',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${ACCENT}12`; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <span style={{
                        width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                        background: `${ACCENT}18`,
                        color: ACCENT, fontSize: 13,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700,
                      }}>{icon}</span>
                      <span>
                        <span style={{ display: 'block', fontWeight: 600, color: '#1e293b', fontSize: 12 }}>{label}</span>
                        <span style={{ display: 'block', fontSize: 10, color: '#94a3b8', marginTop: 1 }}>{desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Background button */}
          <div style={{ position: 'relative' }}>
            {toolbarBtn('🖼 Background', 'bg')}
            {activePanel === 'bg' && (
              <BackgroundPanel section={section} onClose={() => setActivePanel(null)} />
            )}
          </div>

          {/* Embed media */}
          <div style={{ position: 'relative' }}>
            {toolbarBtn(section.embed?.url ? '📎 Embedded' : '📎 Embed', 'embed')}
            {activePanel === 'embed' && (
              <EmbedPanel section={section} onClose={() => setActivePanel(null)} />
            )}
          </div>

          {/* Layout variant — available for all sections that define variants */}
          {SECTION_VARIANTS[section.sectionType] && (
            <div style={{ position: 'relative' }}>
              {toolbarBtn('⊞ Layout', 'layout')}
              {activePanel === 'layout' && (
                <LayoutVariantPanel section={section} onClose={() => setActivePanel(null)} />
              )}
            </div>
          )}

          {/* Move up / down */}
          {sectionIndex > 0 && (
            <button
              onClick={() => ctx.moveArrayItem('__sections__', '__sections__', sectionIndex, sectionIndex - 1)}
              style={{
                padding: '4px 8px',
                borderRadius: 100,
                border: 'none',
                background: 'rgba(255,255,255,0.9)',
                color: '#475569',
                fontSize: 12,
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              }}
              title="Move section up"
            >↑</button>
          )}
          {sectionIndex < totalSections - 1 && (
            <button
              onClick={() => ctx.moveArrayItem('__sections__', '__sections__', sectionIndex, sectionIndex + 1)}
              style={{
                padding: '4px 8px',
                borderRadius: 100,
                border: 'none',
                background: 'rgba(255,255,255,0.9)',
                color: '#475569',
                fontSize: 12,
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              }}
              title="Move section down"
            >↓</button>
          )}

          {/* Duplicate section */}
          <button
            onClick={() => ctx.duplicateSection(section.id)}
            style={{
              padding: '4px 8px',
              borderRadius: 100,
              border: 'none',
              background: 'rgba(255,255,255,0.9)',
              color: '#475569',
              fontSize: 12,
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              fontWeight: 700,
            }}
            title="Duplicate section (Ctrl+D)"
          >⊕</button>

          {/* Delete section */}
          {totalSections > 1 && (
            <button
              onClick={() => {
                if (confirm(`Delete "${section.sectionType}" section? This can be undone with Ctrl+Z.`)) {
                  ctx.removeSection(section.id);
                }
              }}
              style={{
                padding: '4px 8px',
                borderRadius: 100,
                border: 'none',
                background: 'rgba(254,226,226,0.95)',
                color: '#dc2626',
                fontSize: 12,
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                fontWeight: 700,
              }}
              title="Delete section"
            >✕</button>
          )}
        </div>
      )}


    </div>
  );
}
