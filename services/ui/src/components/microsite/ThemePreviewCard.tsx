'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import type { ThemeDefinition, ThemeCategory } from '../../lib/presentation/pluginRegistry';

const CATEGORY_COLORS: Record<ThemeCategory, string> = {
  dark:    '#3b82f6',
  light:   '#6b7280',
  bold:    '#ef4444',
  minimal: '#8b5cf6',
  nature:  '#22c55e',
  premium: '#f59e0b',
};

const SIZE_CONFIG = {
  default: { thumbnailWidth: 200, thumbnailHeight: 128, padding: '8px', labelSize: '12px', labelWeight: 500, badgeSize: '10px', badgePadding: '2px 8px' },
  modal:   { thumbnailWidth: 180, thumbnailHeight: 116, padding: '8px', labelSize: '12px', labelWeight: 500, badgeSize: '10px', badgePadding: '2px 8px' },
};

interface Props {
  theme: ThemeDefinition;
  selected: boolean;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
  size?: 'default' | 'modal';
}

export function ThemePreviewCard({ theme, selected, onSelect, onPreview, size = 'default' }: Props) {
  const [hovered, setHovered] = useState(false);
  const c = theme.previewColors;
  const categoryColor = CATEGORY_COLORS[theme.category];
  const cfg = SIZE_CONFIG[size];

  // Scale factor relative to 320px reference width
  const scale = cfg.thumbnailWidth / 320;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderRadius: 12,
        overflow: 'hidden',
        border: selected ? `2px solid var(--color-primary)` : '2px solid var(--color-border)',
        boxShadow: selected ? '0 0 0 3px #bfdbfe' : hovered ? '0 4px 16px rgba(0,0,0,0.12)' : 'var(--shadow)',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        cursor: 'pointer',
        background: 'var(--color-surface)',
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: cfg.thumbnailHeight,
          background: c.background,
          overflow: 'hidden',
        }}
        onClick={() => onSelect(theme.id)}
      >
        <div style={{
          position: 'absolute', inset: 0,
          padding: Math.round(14 * scale),
          display: 'flex', flexDirection: 'column', gap: Math.round(8 * scale),
        }}>

          {/* Fake hero section */}
          <div style={{ flex: '0 0 auto' }}>
            {/* Eyebrow pill */}
            <div style={{ width: Math.round(36 * scale), height: 4, background: c.accent, borderRadius: 3, marginBottom: Math.round(7 * scale), opacity: 0.9 }} />
            {/* Headline */}
            <div style={{
              fontFamily: `'${theme.fontPairing.heading}', Georgia, serif`,
              fontSize: Math.round(13 * scale), fontWeight: 700, color: c.text,
              lineHeight: 1.2, marginBottom: Math.round(5 * scale), maxWidth: Math.round(130 * scale),
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {theme.label}
            </div>
            {/* Body lines */}
            <div style={{ height: 3, width: Math.round(100 * scale), background: c.text, opacity: 0.18, borderRadius: 2, marginBottom: 3 }} />
            <div style={{ height: 3, width: Math.round(76 * scale), background: c.text, opacity: 0.13, borderRadius: 2, marginBottom: Math.round(9 * scale) }} />
            {/* CTA button */}
            <div style={{
              display: 'inline-block', padding: `3px ${Math.round(8 * scale)}px`,
              background: c.accent, borderRadius: 4,
              fontSize: Math.round(8 * scale), color: '#fff', fontWeight: 700, letterSpacing: '0.04em',
            }}>
              View Proposal
            </div>
          </div>

          {/* Fake stats row */}
          <div style={{ display: 'flex', gap: Math.round(5 * scale), flex: '0 0 auto' }}>
            {['42%', '3×', '$2M'].map((stat, i) => (
              <div key={i} style={{
                flex: 1, background: c.surface, border: `1px solid ${c.border}`,
                borderRadius: 5, padding: `${Math.round(4 * scale)}px ${Math.round(5 * scale)}px`, textAlign: 'center',
              }}>
                <div style={{ fontSize: Math.round(9 * scale), fontWeight: 700, color: c.accent, lineHeight: 1 }}>{stat}</div>
                <div style={{ height: 2, width: '60%', margin: '3px auto 0', background: c.text, opacity: 0.15, borderRadius: 1 }} />
              </div>
            ))}
          </div>

          {/* Fake card row */}
          <div style={{ display: 'flex', gap: Math.round(5 * scale), flex: '0 0 auto' }}>
            {[0, 1].map(i => (
              <div key={i} style={{
                flex: 1, background: c.surface, border: `1px solid ${c.border}`,
                borderRadius: 5, padding: `${Math.round(5 * scale)}px ${Math.round(6 * scale)}px`,
              }}>
                <div style={{ height: 3, width: '70%', background: c.text, opacity: 0.25, borderRadius: 1, marginBottom: 3 }} />
                <div style={{ height: 2, width: '90%', background: c.text, opacity: 0.12, borderRadius: 1, marginBottom: 2 }} />
                <div style={{ height: 2, width: '55%', background: c.text, opacity: 0.10, borderRadius: 1 }} />
              </div>
            ))}
          </div>
        </div>

        {/* Color swatch strip */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, display: 'flex' }}>
          <div style={{ flex: 1, background: c.background }} />
          <div style={{ flex: 1, background: c.accent }} />
          <div style={{ flex: 1, background: c.text }} />
          <div style={{ flex: 1, background: c.surface }} />
        </div>

        {/* Hover overlay with Preview button */}
        <div style={{
          position: 'absolute', inset: 0,
          background: hovered ? 'rgba(0,0,0,0.40)' : 'rgba(0,0,0,0)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.2s',
          pointerEvents: hovered ? 'auto' : 'none',
        }}>
          {hovered && (
            <button
              onClick={e => { e.stopPropagation(); onPreview(theme.id); }}
              style={{
                background: 'rgba(255,255,255,0.92)', color: '#111',
                border: 'none', borderRadius: 100,
                fontSize: 11, fontWeight: 700, padding: '6px 14px',
                cursor: 'pointer', letterSpacing: '0.02em',
              }}
            >
              Preview
            </button>
          )}
        </div>

        {/* Selected checkmark */}
        {selected && (
          <div style={{
            position: 'absolute', top: 7, right: 7,
            width: 20, height: 20, borderRadius: '50%',
            background: 'var(--color-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, color: '#fff',
          }}><Check size={10} strokeWidth={3} /></div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: cfg.padding,
        background: selected ? '#eff6ff' : 'var(--color-surface)',
        borderTop: `1px solid ${selected ? '#bfdbfe' : 'var(--color-border)'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <p style={{
            fontSize: cfg.labelSize, fontWeight: cfg.labelWeight, margin: 0,
            color: selected ? 'var(--color-primary)' : 'var(--color-text)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            minWidth: 0, flex: 1,
          }}>
            {theme.label}
          </p>
          <span style={{
            fontSize: cfg.badgeSize, fontWeight: 600, padding: cfg.badgePadding, borderRadius: 100,
            background: `${categoryColor}22`, color: categoryColor,
            letterSpacing: '0.05em', textTransform: 'uppercase',
            whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 4,
          }}>
            {theme.category}
          </span>
        </div>
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '0 0 8px', lineHeight: 1.4 }}>
          {theme.description}
        </p>
        <button
          onClick={() => onSelect(theme.id)}
          style={{
            width: '100%', padding: '5px 0',
            background: selected ? 'var(--color-primary)' : 'transparent',
            color: selected ? '#fff' : 'var(--color-text)',
            border: `1px solid ${selected ? 'var(--color-primary)' : 'var(--color-border)'}`,
            borderRadius: 6, fontSize: 11, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          {selected ? <><Check size={10} strokeWidth={3} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />Selected</> : 'Select'}
        </button>
      </div>
    </div>
  );
}
