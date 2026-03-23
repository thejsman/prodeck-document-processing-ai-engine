'use client';

import { useState, useRef, useEffect } from 'react';
import { useEditContext, type EditSelection } from './EditContext';

interface Props {
  sectionId: string;
  fieldPath: string;
  elementType: EditSelection['elementType'];
  label: string;
  children: React.ReactNode;
  /** Use 'inline' for text spans, 'block' (default) for divs */
  display?: 'block' | 'inline' | 'flex' | 'inline-block';
  /** When true, renders a textarea instead of single-line input */
  multiline?: boolean;
  /** Raw string value for inline editing — if omitted, inline edit is disabled */
  value?: string;
}

const ACCENT = '#6366f1';

export function Editable({
  sectionId,
  fieldPath,
  elementType,
  label,
  children,
  display = 'block',
  multiline = false,
  value,
}: Props) {
  const ctx = useEditContext();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  // Sync draft when value prop changes externally
  useEffect(() => { setDraft(value ?? ''); }, [value]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      // Move cursor to end
      const el = inputRef.current;
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [editing]);

  // Outside editor — render children as-is
  if (!ctx) return <>{children}</>;

  const isSelected =
    ctx.selection?.sectionId === sectionId &&
    ctx.selection?.fieldPath === fieldPath;

  const canInlineEdit = value !== undefined;

  const commit = () => {
    if (draft !== value) ctx.updateField(sectionId, fieldPath, draft);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value ?? '');
    setEditing(false);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (canInlineEdit) {
      ctx.selectElement({ sectionId, fieldPath, elementType, label });
      setEditing(true);
    } else {
      ctx.selectElement({ sectionId, fieldPath, elementType, label });
    }
  };

  // Shared inline editor style — transparent overlay on the element
  const editorBaseStyle: React.CSSProperties = {
    position: 'absolute',
    inset: -2,
    width: 'calc(100% + 4px)',
    background: 'rgba(0,0,0,0.75)',
    backdropFilter: 'blur(4px)',
    color: '#fff',
    border: `2px solid ${ACCENT}`,
    borderRadius: 4,
    padding: '6px 8px',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'inherit',
    lineHeight: 'inherit',
    letterSpacing: 'inherit',
    resize: 'none',
    outline: 'none',
    zIndex: 1000,
  };

  return (
    <div
      role={editing ? undefined : 'button'}
      tabIndex={editing ? undefined : 0}
      title={editing ? undefined : `Click to edit: ${label}`}
      onClick={editing ? undefined : handleClick}
      onKeyDown={editing ? undefined : (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick(e as unknown as React.MouseEvent);
        }
      }}
      style={{
        display,
        position: 'relative',
        cursor: editing ? 'default' : 'text',
        outline: (isSelected && !editing)
          ? `2px solid ${ACCENT}`
          : '2px solid transparent',
        outlineOffset: 3,
        borderRadius: 4,
        transition: 'outline-color 0.12s',
      }}
      onMouseEnter={e => {
        if (!isSelected && !editing)
          (e.currentTarget as HTMLElement).style.outlineColor = `${ACCENT}55`;
      }}
      onMouseLeave={e => {
        if (!isSelected && !editing)
          (e.currentTarget as HTMLElement).style.outlineColor = 'transparent';
      }}
    >
      {/* Selection label badge */}
      {isSelected && !editing && (
        <span style={{
          position: 'absolute',
          top: -22, left: 0,
          fontSize: 10, fontWeight: 700,
          color: '#fff', background: ACCENT,
          padding: '2px 7px', borderRadius: 4,
          pointerEvents: 'none', zIndex: 200,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          whiteSpace: 'nowrap', letterSpacing: '0.03em',
        }}>
          {label}
        </span>
      )}

      {/* Inline editor overlay */}
      {editing && canInlineEdit && (
        multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            rows={Math.max(3, draft.split('\n').length)}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); cancel(); }
              // Shift+Enter = newline, Enter alone = commit for non-multiline
            }}
            style={{ ...editorBaseStyle, minHeight: 60 }}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            }}
            style={{ ...editorBaseStyle, height: '1.5em' }}
          />
        )
      )}

      {children}
    </div>
  );
}
