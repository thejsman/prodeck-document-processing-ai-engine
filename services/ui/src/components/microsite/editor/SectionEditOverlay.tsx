'use client';

import { useState, useRef, useEffect } from 'react';
import { useEditContext } from './EditContext';
import type { LayoutSection } from '../../../types/presentation';

// ── Colour swatch presets ─────────────────────────────────────────────────────

const BG_PRESETS = [
  { label: 'Surface', value: 'var(--ms-surface)' },
  { label: 'Surface Alt', value: 'var(--ms-surface-alt)' },
  { label: 'Dark', value: '#0a0a0a' },
  { label: 'White', value: '#ffffff' },
  { label: 'Accent tint', value: 'rgba(var(--ms-accent-rgb,99,102,241),0.08)' },
];

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

  function handleSave() {
    ctx.updateField(sectionId, 'diagram', value);
    onClose();
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 30000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          width: '100%',
          maxWidth: 640,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#1e293b' }}>Edit Diagram</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>Mermaid syntax — changes apply on save</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ padding: 20 }}>
          <textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            rows={14}
            spellCheck={false}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid #e2e8f0',
              fontSize: 12,
              fontFamily: 'Consolas, "Courier New", monospace',
              lineHeight: 1.6,
              resize: 'vertical',
              color: '#1e293b',
              boxSizing: 'border-box',
              background: '#f8fafc',
            }}
          />
          <p style={{ fontSize: 11, color: '#94a3b8', margin: '8px 0 0', lineHeight: 1.5 }}>
            Supported: <code>graph TD</code>, <code>sequenceDiagram</code>, <code>flowchart LR</code>, <code>gantt</code>
          </p>
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#64748b' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            Save diagram
          </button>
        </div>
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
  const [tab, setTab] = useState<'image' | 'color'>('image');
  const [imgUrl, setImgUrl] = useState(section.image?.url ?? '');
  const [imgQuery, setImgQuery] = useState(section.image?.query ?? '');

  function applyImage() {
    if (imgUrl.trim()) ctx.updateField(section.id, '__imageUrl', imgUrl.trim());
    if (imgQuery.trim()) ctx.updateField(section.id, '__imageQuery', imgQuery.trim());
    onClose();
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 8,
        zIndex: 25000,
        width: 320,
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
        {(['image', 'color'] as const).map(t => (
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
              fontSize: 12,
              cursor: 'pointer',
              borderBottom: tab === t ? '2px solid #6366f1' : '2px solid transparent',
            }}
          >
            {t === 'image' ? '🖼 Image' : '🎨 Color'}
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
              Image URL (paste or override)
            </label>
            <input
              type="text"
              value={imgUrl}
              onChange={e => setImgUrl(e.target.value)}
              placeholder="https://images.unsplash.com/..."
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
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Pick any color for the section background</span>
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

// ── Main overlay ──────────────────────────────────────────────────────────────

interface Props {
  section: LayoutSection;
  sectionIndex: number;
  totalSections: number;
  children: React.ReactNode;
}

const ACCENT = '#6366f1';

export function SectionEditOverlay({ section, sectionIndex, totalSections, children }: Props) {
  const ctx = useEditContext();
  const [hovered, setHovered] = useState(false);
  const [showBgPanel, setShowBgPanel] = useState(false);
  const [showDiagramModal, setShowDiagramModal] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const bgPanelRef = useRef<HTMLDivElement>(null);

  // Outside editor — render children as-is
  if (!ctx) return <>{children}</>;

  const isActive = ctx.activeSectionId === section.id;
  const hasDiagram = !!(section.content as unknown as Record<string, unknown>).diagram;

  // Close bg panel when clicking outside
  useEffect(() => {
    if (!showBgPanel) return;
    function handleClick(e: MouseEvent) {
      if (bgPanelRef.current && !bgPanelRef.current.contains(e.target as Node)) {
        setShowBgPanel(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showBgPanel]);

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
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

          {/* Background button */}
          <div style={{ position: 'relative' }} ref={bgPanelRef}>
            <button
              onClick={() => setShowBgPanel(v => !v)}
              style={{
                padding: '4px 10px',
                borderRadius: 100,
                border: 'none',
                background: showBgPanel ? ACCENT : 'rgba(255,255,255,0.9)',
                color: showBgPanel ? '#fff' : '#475569',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              🖼 Background
            </button>
            {showBgPanel && (
              <BackgroundPanel section={section} onClose={() => setShowBgPanel(false)} />
            )}
          </div>

          {/* Diagram editor button (only for sections that have diagrams) */}
          {hasDiagram && (
            <button
              onClick={() => setShowDiagramModal(true)}
              style={{
                padding: '4px 10px',
                borderRadius: 100,
                border: 'none',
                background: 'rgba(255,255,255,0.9)',
                color: '#475569',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              ◈ Diagram
            </button>
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
