'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
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

// ── Chart type templates ──────────────────────────────────────────────────────

const CHART_TYPES = [
  {
    id: 'flowchart',
    label: 'Flowchart',
    icon: '◆',
    template: `flowchart TD
    A[Start] --> B{Decision?}
    B -->|Yes| C[Process A]
    B -->|No| D[Process B]
    C --> E[End]
    D --> E`,
  },
  {
    id: 'sequence',
    label: 'Sequence',
    icon: '⇄',
    template: `sequenceDiagram
    Client->>+API: Request
    API->>+Service: Process
    Service-->>-API: Result
    API-->>-Client: Response`,
  },
  {
    id: 'gantt',
    label: 'Gantt',
    icon: '▤',
    template: `gantt
    title Project Timeline
    dateFormat  YYYY-MM-DD
    section Phase 1
    Discovery   :a1, 2024-01-01, 14d
    Design      :a2, after a1,   21d
    section Phase 2
    Development :a3, after a2,   42d
    Testing     :a4, after a3,   14d`,
  },
  {
    id: 'pie',
    label: 'Pie Chart',
    icon: '◉',
    template: `pie title Budget Allocation
    "Strategy" : 25
    "Design" : 20
    "Development" : 40
    "QA" : 15`,
  },
  {
    id: 'mindmap',
    label: 'Mind Map',
    icon: '❋',
    template: `mindmap
  root((Project))
    Strategy
      Research
      Planning
    Execution
      Dev
      Testing
    Delivery
      Launch
      Support`,
  },
  {
    id: 'custom',
    label: 'Custom',
    icon: '✎',
    template: '',
  },
];

// ── Live diagram preview ──────────────────────────────────────────────────────

let _previewCounter = 0;

function DiagramPreview({ code }: { code: string }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const idRef = useRef(`mmd-prev-${++_previewCounter}`);

  useEffect(() => {
    if (!code.trim()) { setSvg(''); setError(''); return; }
    const timer = setTimeout(async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
        const { svg: rendered } = await mermaid.render(idRef.current, code);
        setSvg(rendered);
        setError('');
      } catch {
        setError('Invalid syntax — check your diagram code');
        setSvg('');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [code]);

  if (!code.trim()) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 12, gap: 8 }}>
        <span style={{ fontSize: 32 }}>◈</span>
        <span>Select a chart type or enter code</span>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#dc2626', fontSize: 12, gap: 6, padding: 16 }}>
        <span style={{ fontSize: 24 }}>⚠</span>
        <span style={{ textAlign: 'center' }}>{error}</span>
      </div>
    );
  }
  return (
    <div
      style={{ width: '100%', height: '100%', overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// ── Diagram editor modal ──────────────────────────────────────────────────────

function DiagramModal({
  sectionId,
  diagram,
  onClose,
}: {
  sectionId: string;
  diagram: string;
  onClose: () => void;
}) {
  const ctx = useEditContext()!;
  const [value, setValue] = useState(diagram);
  const [activeType, setActiveType] = useState(() => {
    if (!diagram) return 'flowchart';
    if (diagram.startsWith('sequenceDiagram')) return 'sequence';
    if (diagram.startsWith('gantt')) return 'gantt';
    if (diagram.startsWith('pie')) return 'pie';
    if (diagram.startsWith('mindmap')) return 'mindmap';
    if (diagram.startsWith('flowchart') || diagram.startsWith('graph')) return 'flowchart';
    return 'custom';
  });

  function handleTypeSelect(typeId: string) {
    setActiveType(typeId);
    const found = CHART_TYPES.find(t => t.id === typeId);
    if (found && found.template) setValue(found.template);
  }

  function handleSave() {
    ctx.updateField(sectionId, 'diagram', value);
    onClose();
  }

  function handleRemove() {
    ctx.updateField(sectionId, 'diagram', '');
    onClose();
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 30000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 14,
          width: '100%',
          maxWidth: 900,
          height: 'min(640px, 90vh)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#1e293b' }}>Edit Diagram</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>Select a chart type, then customize the code. Preview updates automatically.</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18, padding: 4 }}>✕</button>
        </div>

        {/* Chart type selector */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 6, flexShrink: 0, overflowX: 'auto' }}>
          {CHART_TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => handleTypeSelect(t.id)}
              style={{
                padding: '5px 12px',
                borderRadius: 20,
                border: activeType === t.id ? 'none' : '1px solid #e2e8f0',
                background: activeType === t.id ? '#6366f1' : '#f8fafc',
                color: activeType === t.id ? '#fff' : '#475569',
                fontSize: 12,
                fontWeight: activeType === t.id ? 700 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                flexShrink: 0,
                transition: 'all 0.15s',
              }}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body: editor + preview side by side */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Code editor */}
          <div style={{ flex: '0 0 50%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e2e8f0' }}>
            <div style={{ padding: '8px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Code</span>
              <span style={{ fontSize: 10, color: '#94a3b8' }}>Mermaid syntax</span>
            </div>
            <textarea
              value={value}
              onChange={e => setValue(e.target.value)}
              spellCheck={false}
              style={{
                flex: 1,
                padding: '12px 16px',
                border: 'none',
                outline: 'none',
                fontSize: 12,
                fontFamily: 'Consolas, "Courier New", monospace',
                lineHeight: 1.7,
                resize: 'none',
                color: '#1e293b',
                background: '#fafafa',
              }}
            />
          </div>

          {/* Live preview */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '8px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Preview</span>
              <span style={{ fontSize: 10, color: '#94a3b8' }}>Updates automatically</span>
            </div>
            <div style={{ flex: 1, overflow: 'hidden', background: '#fff' }}>
              <DiagramPreview code={value} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, justifyContent: 'space-between', flexShrink: 0 }}>
          <button
            onClick={handleRemove}
            style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#dc2626' }}
          >
            Remove diagram
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#64748b' }}>
              Cancel
            </button>
            <button onClick={handleSave} style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Save diagram
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
    if (imgUrl.trim()) ctx.updateField(section.id, '__imageUrl', imgUrl.trim());
    if (imgQuery.trim()) ctx.updateField(section.id, '__imageQuery', imgQuery.trim());
    onClose();
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      ctx.updateField(section.id, '__imageUrl', dataUrl);
      onClose();
    };
    reader.readAsDataURL(file);
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
                onClick={() => { ctx.updateField(section.id, '__imageSource', 'gradient'); onClose(); }}
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
                onChange={e => ctx.updateField(section.id, '__bgColor', e.target.value)}
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
                  onClick={() => { ctx.updateField(section.id, '__bgColor', preset.value); onClose(); }}
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
    </div>
  );
}

// ── Section layout variant picker ─────────────────────────────────────────────

const HERO_VARIANTS = [
  { id: 'centered',    label: 'Centered',     icon: '⊡' },
  { id: 'split',       label: 'Split',        icon: '⊞' },
  { id: 'asymmetric',  label: 'Asymmetric',   icon: '⊟' },
  { id: 'editorial',   label: 'Editorial',    icon: '⊠' },
  { id: 'card-grid',   label: 'Card Grid',    icon: '⊟' },
  { id: 'type-forward',label: 'Type Forward', icon: '⊞' },
];

function LayoutVariantPanel({
  section,
  onClose,
}: {
  section: LayoutSection;
  onClose: () => void;
}) {
  const ctx = useEditContext()!;
  const content = section.content as unknown as Record<string, unknown>;
  const current = (content.variant as string) ?? 'centered';

  if (section.sectionType !== 'hero') {
    return (
      <div style={{
        position: 'absolute', top: '100%', left: 8, zIndex: 25000,
        background: '#fff', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        border: '1px solid #e2e8f0', padding: 14, fontFamily: 'system-ui', width: 220,
      }}>
        <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
          Layout variants only available for Hero sections
        </p>
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute', top: '100%', left: 8, zIndex: 25000,
      background: '#fff', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      border: '1px solid #e2e8f0', fontFamily: 'system-ui', overflow: 'hidden', width: 240,
    }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Layout Variant
        </p>
      </div>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {HERO_VARIANTS.map(v => (
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
            <span style={{ fontSize: 16 }}>{v.icon}</span>
            {v.label}
            {current === v.id && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6366f1' }}>✓</span>}
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
}

const ACCENT = '#6366f1';

type ActivePanel = 'bg' | 'diagram' | 'layout' | 'icon' | 'embed' | null;

export function SectionEditOverlay({ section, sectionIndex, totalSections, children }: Props) {
  const ctx = useEditContext();
  const [hovered, setHovered] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [showDiagramModal, setShowDiagramModal] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Outside editor — render children as-is
  if (!ctx) return <>{children}</>;

  const isActive = ctx.activeSectionId === section.id;
  const hasDiagram = !!(section.content as unknown as Record<string, unknown>).diagram;

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
        outline: isActive ? `2px solid ${ACCENT}` : hovered ? `2px solid ${ACCENT}44` : '2px solid transparent',
        outlineOffset: -2,
        transition: 'outline-color 0.15s',
        cursor: 'default',
      }}
    >
      {children}

      {/* Hover toolbar */}
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
            alignItems: 'flex-start',
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
              alignSelf: 'center',
            }}
          >
            {section.sectionType}
          </span>

          {/* Background button */}
          <div style={{ position: 'relative' }}>
            {toolbarBtn('🖼 Background', 'bg')}
            {activePanel === 'bg' && (
              <BackgroundPanel section={section} onClose={() => setActivePanel(null)} />
            )}
          </div>

          {/* Diagram button — always shown */}
          <div style={{ position: 'relative' }}>
            {toolbarBtn(
              hasDiagram ? '◈ Diagram' : '+ Diagram',
              null,
              () => setShowDiagramModal(true),
            )}
          </div>

          {/* Embed media */}
          <div style={{ position: 'relative' }}>
            {toolbarBtn(section.embed?.url ? '📎 Embedded' : '📎 Embed', 'embed')}
            {activePanel === 'embed' && (
              <EmbedPanel section={section} onClose={() => setActivePanel(null)} />
            )}
          </div>

          {/* Layout variant (hero only) */}
          {section.sectionType === 'hero' && (
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

      {/* Diagram modal */}
      {showDiagramModal && (
        <DiagramModal
          sectionId={section.id}
          diagram={String((section.content as unknown as Record<string, unknown>).diagram ?? '')}
          onClose={() => setShowDiagramModal(false)}
        />
      )}
    </div>
  );
}
