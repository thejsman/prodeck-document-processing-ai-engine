'use client';

import { useEditContext, type EditSelection } from './EditContext';

interface Props {
  sectionId: string;
  fieldPath: string;
  elementType: EditSelection['elementType'];
  label: string;
  children: React.ReactNode;
  /** Use 'inline' for text spans, 'block' (default) for divs */
  display?: 'block' | 'inline' | 'flex' | 'inline-block';
}

const ACCENT = '#6366f1';

export function Editable({
  sectionId,
  fieldPath,
  elementType,
  label,
  children,
  display = 'block',
}: Props) {
  const ctx = useEditContext();

  // Outside editor — render children as-is
  if (!ctx) return <>{children}</>;

  const isSelected =
    ctx.selection?.sectionId === sectionId &&
    ctx.selection?.fieldPath === fieldPath;

  return (
    <div
      role="button"
      tabIndex={0}
      title={`Edit: ${label}`}
      onClick={e => {
        e.stopPropagation();
        ctx.selectElement({ sectionId, fieldPath, elementType, label });
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          ctx.selectElement({ sectionId, fieldPath, elementType, label });
        }
      }}
      style={{
        display,
        position: 'relative',
        cursor: 'pointer',
        outline: isSelected
          ? `2px solid ${ACCENT}`
          : '2px solid transparent',
        outlineOffset: 3,
        borderRadius: 4,
        transition: 'outline-color 0.12s',
      }}
      onMouseEnter={e => {
        if (!isSelected)
          (e.currentTarget as HTMLElement).style.outlineColor = `${ACCENT}55`;
      }}
      onMouseLeave={e => {
        if (!isSelected)
          (e.currentTarget as HTMLElement).style.outlineColor = 'transparent';
      }}
    >
      {/* Selection label badge */}
      {isSelected && (
        <span
          style={{
            position: 'absolute',
            top: -22,
            left: 0,
            fontSize: 10,
            fontWeight: 700,
            color: '#fff',
            background: ACCENT,
            padding: '2px 7px',
            borderRadius: 4,
            pointerEvents: 'none',
            zIndex: 200,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            whiteSpace: 'nowrap',
            letterSpacing: '0.03em',
          }}
        >
          {label}
        </span>
      )}
      {children}
    </div>
  );
}
