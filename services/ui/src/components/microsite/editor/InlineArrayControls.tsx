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
  /** Override the wrapper element — use "tr" when the child is a <tr> inside a table */
  as?: 'div' | 'tr';
}

export function InlineArrayItem({ arrayPath, index, total, children, as: Tag = 'div' }: ItemProps) {
  const ctx = useEditContext();
  const sectionId = useSectionId();
  const [hovered, setHovered] = useState(false);

  if (!ctx || !sectionId) return <>{children}</>;

  // Controls are rendered inside a <td> when wrapping a <tr> to keep valid HTML
  const controls = hovered ? (
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
  ) : null;

  if (Tag === 'tr') {
    return (
      <>
        {/* Clone children (the <tr>) and inject hover handlers via a wrapping approach:
            since we can't add onMouseEnter to a fragment, we render a sibling <tr>
            for the controls and use CSS :hover on the parent tbody via onMouseEnter on the tr itself.
            Instead, we just pass hover state directly onto the tr via cloneElement. */}
        <tr
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{ position: 'relative' }}
        >
          {/* Render the original tr's children by unwrapping — children IS the <tr> so render its props */}
          {(children as React.ReactElement<{ children?: React.ReactNode }>).props.children}
          {hovered && (
            <td style={{ position: 'relative', width: 0, padding: 0, overflow: 'visible' }}>
              <div style={{ position: 'absolute', top: 4, right: 4, zIndex: 10000, display: 'flex', gap: 3 }}
                onClick={e => e.stopPropagation()}>
                {index > 0 && <button title="Move up" onClick={() => ctx.moveArrayItem(sectionId, arrayPath, index, index - 1)} style={chipStyle}>↑</button>}
                {index < total - 1 && <button title="Move down" onClick={() => ctx.moveArrayItem(sectionId, arrayPath, index, index + 1)} style={chipStyle}>↓</button>}
                <button title="Remove item" onClick={() => ctx.removeArrayItem(sectionId, arrayPath, index)} style={{ ...chipStyle, background: '#fef2f2', color: '#dc2626', borderColor: '#fecaca' }}>×</button>
              </div>
            </td>
          )}
        </tr>
      </>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative' }}
    >
      {children}
      {controls}
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
  template: unknown;
  label?: string;
}

export function InlineAddItem({ arrayPath, template, label = 'Add item' }: AddProps) {
  const ctx = useEditContext();
  const sectionId = useSectionId();

  if (!ctx || !sectionId) return null;

  function cloneTemplate() {
    if (Array.isArray(template)) return [...template];
    if (template !== null && typeof template === 'object') return { ...(template as Record<string, unknown>) };
    return template;
  }

  return (
    <button
      onClick={e => { e.stopPropagation(); ctx.addArrayItem(sectionId, arrayPath, cloneTemplate()); }}
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
