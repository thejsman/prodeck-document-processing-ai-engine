'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
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

// Colour swatches available in the inline toolbar
const COLOR_SWATCHES = [
  { label: 'Accent',  value: ACCENT },
  { label: 'Red',     value: '#ef4444' },
  { label: 'Orange',  value: '#f97316' },
  { label: 'Yellow',  value: '#eab308' },
  { label: 'Green',   value: '#22c55e' },
  { label: 'Cyan',    value: '#06b6d4' },
  { label: 'Blue',    value: '#3b82f6' },
  { label: 'Purple',  value: '#8b5cf6' },
  { label: 'Pink',    value: '#ec4899' },
  { label: 'White',   value: '#ffffff' },
  { label: 'Muted',   value: '#94a3b8' },
];

// Slash command options
const SLASH_COMMANDS = [
  { id: 'bold',   label: '**Bold**',       icon: 'B', desc: 'Bold text',       apply: (t: string) => `**${t || 'bold text'}**` },
  { id: 'italic', label: '_Italic_',       icon: 'I', desc: 'Italic text',     apply: (t: string) => `_${t || 'italic text'}_` },
  { id: 'bullet', label: '• Bullet list',  icon: '•', desc: 'Bullet list item', apply: (t: string) => `• ${t || 'list item'}` },
  { id: 'h2',     label: '## Heading',     icon: 'H', desc: 'Section heading', apply: (t: string) => `## ${t || 'Heading'}` },
];

function wrapSelection(
  el: HTMLTextAreaElement | HTMLInputElement,
  before: string,
  after: string,
  fallback: string,
): string {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const val = el.value;
  const selected = val.slice(start, end) || fallback;
  return val.slice(0, start) + before + selected + after + val.slice(end);
}

function prefixLines(
  el: HTMLTextAreaElement | HTMLInputElement,
  prefix: string,
): string {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const val = el.value;
  const before = val.slice(0, start);
  const selection = val.slice(start, end) || 'list item';
  const prefixed = selection.split('\n').map(l => `${prefix} ${l}`).join('\n');
  return before + prefixed + val.slice(end);
}

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
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [mounted, setMounted] = useState(false);
  const [inputRect, setInputRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  // Sync draft when value prop changes externally
  useEffect(() => { setDraft(value ?? ''); }, [value]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      const el = inputRef.current;
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [editing]);

  // Close slash menu on outside click
  useEffect(() => {
    if (!slashOpen) return;
    function handleClick() { setSlashOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [slashOpen]);

  // Track input position for portal-based toolbar/slash menu
  useEffect(() => {
    if (!editing) { setInputRect(null); return; }
    function update() {
      if (inputRef.current) setInputRect(inputRef.current.getBoundingClientRect());
    }
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
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
    setSlashOpen(false);
  };

  const cancel = () => {
    setDraft(value ?? '');
    setEditing(false);
    setSlashOpen(false);
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

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const val = e.target.value;
    setDraft(val);
    // Detect slash command: '/' at start or after newline
    const pos = e.target.selectionStart ?? val.length;
    const textBefore = val.slice(0, pos);
    const slashIdx = textBefore.lastIndexOf('/');
    if (slashIdx !== -1 && (slashIdx === 0 || textBefore[slashIdx - 1] === '\n' || textBefore[slashIdx - 1] === ' ')) {
      const query = textBefore.slice(slashIdx + 1);
      if (!query.includes(' ') && query.length <= 10) {
        setSlashQuery(query);
        setSlashOpen(true);
        return;
      }
    }
    setSlashOpen(false);
  };

  const applySlashCommand = (cmdId: string) => {
    const cmd = SLASH_COMMANDS.find(c => c.id === cmdId);
    if (!cmd || !inputRef.current) { setSlashOpen(false); return; }
    // Find the slash position
    const el = inputRef.current;
    const pos = el.selectionStart ?? draft.length;
    const textBefore = draft.slice(0, pos);
    const slashIdx = textBefore.lastIndexOf('/');
    const before = draft.slice(0, slashIdx);
    const after = draft.slice(pos);
    setDraft(before + cmd.apply('') + after);
    setSlashOpen(false);
    setTimeout(() => el.focus(), 0);
  };

  const applyFormat = (type: 'bold' | 'italic' | 'bullet') => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    let newVal = draft;
    let cursorOffset = 0;
    if (type === 'bold') { newVal = wrapSelection(el, '**', '**', 'bold text'); cursorOffset = 2; }
    if (type === 'italic') { newVal = wrapSelection(el, '_', '_', 'italic text'); cursorOffset = 1; }
    if (type === 'bullet') { newVal = prefixLines(el, '•'); cursorOffset = 2; }
    setDraft(newVal);
    setTimeout(() => {
      el.focus();
      const newPos = start === end ? start + cursorOffset : end + cursorOffset * 2;
      el.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const applyColor = (color: string) => {
    const el = inputRef.current;
    if (!el) return;
    const newVal = wrapSelection(el, `[c=${color}]`, '[/c]', 'text');
    setDraft(newVal);
    setTimeout(() => el.focus(), 0);
  };

  const clearFormatting = () => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = el.value.slice(start, end);
    if (!selected) return;
    // Strip bold, italic, color markup from the selection
    const stripped = selected
      .replace(/\[c=#?[a-zA-Z0-9]+\](.*?)\[\/c\]/gs, '$1')
      .replace(/\*\*(.+?)\*\*/gs, '$1')
      .replace(/_(.+?)_/gs, '$1');
    const newVal = el.value.slice(0, start) + stripped + el.value.slice(end);
    setDraft(newVal);
    setTimeout(() => { el.focus(); el.setSelectionRange(start, start + stripped.length); }, 0);
  };

  // Shared inline editor style
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

  const filteredCmds = slashOpen
    ? SLASH_COMMANDS.filter(c => c.id.startsWith(slashQuery) || c.label.toLowerCase().includes(slashQuery.toLowerCase()))
    : [];

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
        <>
          {/* Rich text formatting toolbar — rendered in portal to escape overflow:hidden */}
          {inputRect && mounted && createPortal(
            <div
              style={{
                position: 'fixed',
                top: Math.max(4, inputRect.top - 44),
                left: inputRect.left,
                zIndex: 60000,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                background: '#1e293b',
                borderRadius: 6,
                padding: '3px 6px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                pointerEvents: 'auto',
                flexWrap: 'wrap',
                maxWidth: 420,
              }}
              onMouseDown={e => e.preventDefault()}
            >
              {/* Format buttons */}
              {[
                { icon: 'B', title: 'Bold (Ctrl+B)', style: { fontWeight: 900 }, action: () => applyFormat('bold') },
                { icon: 'I', title: 'Italic (Ctrl+I)', style: { fontStyle: 'italic' as const }, action: () => applyFormat('italic') },
                ...(multiline ? [{ icon: '•', title: 'Bullet list', style: {}, action: () => applyFormat('bullet') }] : []),
              ].map(btn => (
                <button
                  key={btn.icon}
                  title={btn.title}
                  onMouseDown={e => { e.preventDefault(); btn.action(); }}
                  style={{ width: 24, height: 24, borderRadius: 4, border: 'none', background: 'transparent', color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui', ...btn.style }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.15)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                >{btn.icon}</button>
              ))}

              {/* Separator */}
              <div style={{ width: 1, background: 'rgba(255,255,255,0.2)', margin: '2px 3px', alignSelf: 'stretch' }} />

              {/* Colour swatches */}
              {COLOR_SWATCHES.map(swatch => (
                <button
                  key={swatch.value}
                  title={`Color: ${swatch.label}`}
                  onMouseDown={e => { e.preventDefault(); applyColor(swatch.value); }}
                  style={{
                    width: 16, height: 16, borderRadius: '50%',
                    border: '2px solid rgba(255,255,255,0.25)',
                    background: swatch.value,
                    cursor: 'pointer',
                    padding: 0,
                    flexShrink: 0,
                    transition: 'transform 0.1s, border-color 0.1s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.3)'; (e.currentTarget as HTMLElement).style.borderColor = '#fff'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.25)'; }}
                />
              ))}

              {/* Separator */}
              <div style={{ width: 1, background: 'rgba(255,255,255,0.2)', margin: '2px 3px', alignSelf: 'stretch' }} />

              {/* Clear formatting */}
              <button
                title="Clear formatting from selection"
                onMouseDown={e => { e.preventDefault(); clearFormatting(); }}
                style={{ width: 24, height: 24, borderRadius: 4, border: 'none', background: 'transparent', color: '#94a3b8', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.15)'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#94a3b8'; }}
              >Tx</button>

              {multiline && (
                <>
                  <div style={{ width: 1, background: 'rgba(255,255,255,0.2)', margin: '2px 3px', alignSelf: 'stretch' }} />
                  <span style={{ fontSize: 9, color: '#94a3b8', alignSelf: 'center', paddingRight: 2, fontFamily: 'system-ui' }}>/ cmds</span>
                </>
              )}
            </div>,
            document.body
          )}

          {multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={draft}
              rows={Math.max(3, draft.split('\n').length)}
              onChange={handleChange}
              onBlur={commit}
              onKeyDown={e => {
                if (e.key === 'Escape') { e.preventDefault(); cancel(); }
                if (e.ctrlKey || e.metaKey) {
                  if (e.key === 'b') { e.preventDefault(); applyFormat('bold'); }
                  if (e.key === 'i') { e.preventDefault(); applyFormat('italic'); }
                }
                if (e.key === 'Enter' && slashOpen) {
                  e.preventDefault();
                  if (filteredCmds.length > 0) applySlashCommand(filteredCmds[0].id);
                }
                if (e.key === 'Escape' && slashOpen) { e.preventDefault(); setSlashOpen(false); }
              }}
              style={{ ...editorBaseStyle, minHeight: 60 }}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              value={draft}
              onChange={handleChange}
              onBlur={commit}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                if (e.key === 'Escape') { e.preventDefault(); cancel(); }
                if (e.ctrlKey || e.metaKey) {
                  if (e.key === 'b') { e.preventDefault(); applyFormat('bold'); }
                  if (e.key === 'i') { e.preventDefault(); applyFormat('italic'); }
                }
              }}
              style={{ ...editorBaseStyle, height: '1.5em' }}
            />
          )}

          {/* Slash command menu — rendered in portal to escape overflow:hidden */}
          {slashOpen && filteredCmds.length > 0 && inputRect && mounted && createPortal(
            <div
              style={{
                position: 'fixed',
                top: inputRect.bottom + 4,
                left: inputRect.left,
                zIndex: 60000,
                background: '#1e293b',
                borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                border: '1px solid rgba(255,255,255,0.1)',
                overflow: 'hidden',
                minWidth: 200,
                pointerEvents: 'auto',
              }}
              onMouseDown={e => e.preventDefault()}
            >
              {filteredCmds.map(cmd => (
                <button
                  key={cmd.id}
                  onMouseDown={e => { e.preventDefault(); applySlashCommand(cmd.id); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    color: '#fff',
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                    fontSize: 12,
                    fontFamily: 'system-ui',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.1)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                >
                  <span style={{ width: 22, height: 22, borderRadius: 4, background: ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                    {cmd.icon}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{cmd.label}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>{cmd.desc}</div>
                  </div>
                </button>
              ))}
            </div>,
            document.body
          )}
        </>
      )}

      {children}
    </div>
  );
}
