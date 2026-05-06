'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ThemePreviewCard } from './ThemePreviewCard';
import { THEME_REGISTRY, type ThemeCategory } from '../../lib/presentation/pluginRegistry';

const ALL_CATEGORIES: Array<ThemeCategory | 'all'> = ['all', 'dark', 'light', 'bold', 'minimal', 'nature', 'premium'];

const CATEGORY_COLORS: Record<ThemeCategory | 'all', string> = {
  all:     'var(--color-primary)',
  dark:    '#3b82f6',
  light:   'var(--muted)',
  bold:    '#ef4444',
  minimal: '#8b5cf6',
  nature:  '#22c55e',
  premium: '#f59e0b',
};

interface Props {
  selectedPlugin: string | null;
  onSelect: (id: string | null) => void;
  onPreview: (id: string) => void;
  onClose: () => void;
}

export function ThemeModal({ selectedPlugin, onSelect, onPreview, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState<ThemeCategory | 'all'>('all');
  // highlightedId = user's in-modal selection before clicking Apply
  const [highlightedId, setHighlightedId] = useState<string | null>(selectedPlugin);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus the modal container on open for keyboard accessibility
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const filteredThemes = activeCategory === 'all'
    ? THEME_REGISTRY
    : THEME_REGISTRY.filter(t => t.category === activeCategory);

  const highlightedTheme = THEME_REGISTRY.find(t => t.id === highlightedId);
  const isDirty = highlightedId !== selectedPlugin;

  function handleApply() {
    onSelect(highlightedId);
    onClose();
  }

  const content = (
    <>
      <style>{`
        @keyframes _tm_backdrop {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes _tm_slide {
          from { opacity: 0; transform: translate(-50%, calc(-50% + 14px)) scale(0.96); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>

      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 50000,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          animation: '_tm_backdrop 180ms ease-out forwards',
        }}
      />

      {/* Dialog */}
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Theme selector"
        tabIndex={-1}
        style={{
          position: 'fixed',
          top: '50%', left: '50%',
          zIndex: 50001,
          width: 'min(900px, 92vw)',
          height: 'min(680px, 90vh)',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
          display: 'flex', flexDirection: 'column',
          outline: 'none',
          animation: '_tm_slide 180ms ease-out forwards',
        }}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <div style={{
          height: 56, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
        }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 500, color: 'var(--color-text)' }}>
            All Themes
          </p>
          <button
            aria-label="Close"
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'none', border: '1px solid var(--color-border)',
              cursor: 'pointer', fontSize: 14, color: 'var(--color-text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >✕</button>
        </div>

        {/* ── Filter bar ─────────────────────────────────────── */}
        <div style={{
          height: 48, flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 24px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          overflowX: 'auto',
        }}>
          {ALL_CATEGORIES.map(cat => {
            const active = activeCategory === cat;
            const color = CATEGORY_COLORS[cat];
            const count = cat === 'all'
              ? THEME_REGISTRY.length
              : THEME_REGISTRY.filter(t => t.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                style={{
                  padding: '5px 14px', borderRadius: 20,
                  border: active ? `1px solid ${color}` : '1px solid var(--color-border)',
                  background: active ? `color-mix(in srgb, ${color} 10%, transparent)` : 'transparent',
                  color: active ? color : 'var(--color-text-muted)',
                  fontSize: 12, fontWeight: active ? 700 : 500,
                  cursor: 'pointer', textTransform: 'capitalize',
                  whiteSpace: 'nowrap', flexShrink: 0,
                  transition: 'all 0.15s',
                }}
              >
                {cat === 'all' ? `All (${count})` : `${cat} (${count})`}
              </button>
            );
          })}
        </div>

        {/* ── Body — scrollable ──────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <style>{`
            @media (max-width: 700px) { ._tm_grid { grid-template-columns: repeat(3, 1fr) !important; } }
            @media (max-width: 480px) { ._tm_grid { grid-template-columns: repeat(2, 1fr) !important; } }
          `}</style>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            {filteredThemes.length}{' '}
            {activeCategory === 'all' ? 'themes' : `${activeCategory} themes`}
          </p>
          <div
            className="_tm_grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
            }}
          >
            {filteredThemes.map(theme => (
              <ThemePreviewCard
                key={theme.id}
                theme={theme}
                selected={highlightedId === theme.id}
                onSelect={setHighlightedId}
                onPreview={onPreview}
                size="modal"
              />
            ))}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div style={{
          height: 60, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px',
          borderTop: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
        }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            {selectedPlugin
              ? `Selected: ${THEME_REGISTRY.find(t => t.id === selectedPlugin)?.label ?? selectedPlugin}`
              : 'No theme selected'}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} className="btn btn-sm">
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!isDirty}
              className="btn btn-sm btn-primary"
              style={{ width: 'auto' }}
            >
              {highlightedTheme ? `Apply "${highlightedTheme.label}"` : 'Apply Theme'}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  if (typeof window === 'undefined') return null;
  return createPortal(content, document.body);
}
