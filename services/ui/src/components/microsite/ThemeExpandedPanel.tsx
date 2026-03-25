'use client';

import { useState } from 'react';
import { ThemePreviewCard } from './ThemePreviewCard';
import { THEME_REGISTRY, type ThemeCategory } from '../../lib/presentation/pluginRegistry';

const ALL_CATEGORIES: Array<ThemeCategory | 'all'> = ['all', 'dark', 'light', 'bold', 'minimal', 'nature', 'premium'];

const CATEGORY_COLORS: Record<ThemeCategory | 'all', string> = {
  all:     'var(--color-primary)',
  dark:    '#3b82f6',
  light:   '#6b7280',
  bold:    '#ef4444',
  minimal: '#8b5cf6',
  nature:  '#22c55e',
  premium: '#f59e0b',
};

interface Props {
  selectedPlugin: string | null;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
  onClose: () => void;
}

export function ThemeExpandedPanel({ selectedPlugin, onSelect, onPreview, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState<ThemeCategory | 'all'>('all');

  const filteredThemes = activeCategory === 'all'
    ? THEME_REGISTRY
    : THEME_REGISTRY.filter(t => t.category === activeCategory);

  return (
    <div style={{
      marginTop: 16,
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      overflow: 'hidden',
      background: 'var(--color-surface)',
    }}>
      {/* Panel header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--color-bg)',
      }}>
        <div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>All Themes</p>
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>{THEME_REGISTRY.length} themes · click any card to select</p>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: '1px solid var(--color-border)',
            borderRadius: 6, padding: '4px 10px', fontSize: 12,
            color: 'var(--color-text-muted)', cursor: 'pointer',
          }}
        >
          Close ✕
        </button>
      </div>

      {/* Category filters */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {ALL_CATEGORIES.map(cat => {
          const active = activeCategory === cat;
          const color = CATEGORY_COLORS[cat];
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: '4px 12px', borderRadius: 100,
                border: active ? `1px solid ${color}` : '1px solid var(--color-border)',
                background: active ? `${color}18` : 'transparent',
                color: active ? color : 'var(--color-text-muted)',
                fontSize: 11, fontWeight: active ? 700 : 500,
                cursor: 'pointer', textTransform: 'capitalize',
                transition: 'all 0.15s',
              }}
            >
              {cat === 'all' ? `All (${THEME_REGISTRY.length})` : cat}
            </button>
          );
        })}
      </div>

      {/* Theme grid */}
      <div style={{
        padding: 16,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 10,
      }}>
        {filteredThemes.map(theme => (
          <ThemePreviewCard
            key={theme.id}
            theme={theme}
            selected={selectedPlugin === theme.id}
            onSelect={onSelect}
            onPreview={onPreview}
            size="default"
          />
        ))}
      </div>
    </div>
  );
}
