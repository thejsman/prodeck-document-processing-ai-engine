'use client';

/**
 * Inline add / remove / reorder controls for array items.
 * Use inside section components so users can manage items directly
 * on the canvas without needing the right-side panel.
 */

import { useState } from 'react';
import { useEditContext } from './EditContext';
import { useSectionId } from './SectionIdContext';

const ACCENT = '#6366f1';

// ── Per-item wrapper ──────────────────────────────────────────────────────────

interface ItemProps {
  arrayPath: string;
  index: number;
  total: number;
  children: React.ReactNode;
}

export function InlineArrayItem({ arrayPath, index, total, children }: ItemProps) {
  const ctx = useEditContext();
  const sectionId = useSectionId();
  const [hovered, setHovered] = useState(false);

  if (!ctx || !sectionId) return <>{children}</>;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative' }}
    >
      {children}

      {hovered && (
        <div
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            zIndex: 10000,
            display: 'flex',
            gap: 3,
            alignItems: 'center',
          }}
          onClick={e => e.stopPropagation()}
        >
          {index > 0 && (
            <button
              title="Move up"
              onClick={() => ctx.moveArrayItem(sectionId, arrayPath, index, index - 1)}
              style={chipStyle}
            >↑</button>
          )}
          {index < total - 1 && (
            <button
              title="Move down"
              onClick={() => ctx.moveArrayItem(sectionId, arrayPath, index, index + 1)}
              style={chipStyle}
            >↓</button>
          )}
          <button
            title="Remove item"
            onClick={() => ctx.removeArrayItem(sectionId, arrayPath, index)}
            style={{ ...chipStyle, background: '#fef2f2', color: '#dc2626', borderColor: '#fecaca' }}
          >×</button>
        </div>
      )}
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 6,
  border: '1px solid rgba(0,0,0,0.15)',
  background: 'rgba(255,255,255,0.92)',
  color: '#475569',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backdropFilter: 'blur(6px)',
  boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
  fontFamily: 'system-ui',
};

// ── Add-item button ───────────────────────────────────────────────────────────

interface AddProps {
  arrayPath: string;
  template: Record<string, unknown>;
  label?: string;
}

export function InlineAddItem({ arrayPath, template, label = 'Add item' }: AddProps) {
  const ctx = useEditContext();
  const sectionId = useSectionId();

  if (!ctx || !sectionId) return null;

  return (
    <button
      onClick={e => { e.stopPropagation(); ctx.addArrayItem(sectionId, arrayPath, { ...template }); }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginTop: 12,
        padding: '7px 16px',
        borderRadius: 20,
        border: `1.5px dashed ${ACCENT}66`,
        background: `${ACCENT}08`,
        color: ACCENT,
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        letterSpacing: '0.02em',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = `${ACCENT}15`;
        (e.currentTarget as HTMLElement).style.borderColor = ACCENT;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = `${ACCENT}08`;
        (e.currentTarget as HTMLElement).style.borderColor = `${ACCENT}66`;
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>＋</span>
      {label}
    </button>
  );
}
