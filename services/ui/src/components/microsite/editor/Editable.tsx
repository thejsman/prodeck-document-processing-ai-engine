'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
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
const GLOW = 'rgba(99,102,241,0.35)';

// Colour swatches available in the inline toolbar
const COLOR_SWATCHES = [
  { label: 'Accent',  value: '#6366f1' },
  { label: 'Cyan',    value: '#06b6d4' },
  { label: 'Green',   value: '#22c55e' },
  { label: 'Yellow',  value: '#eab308' },
  { label: 'Orange',  value: '#f97316' },
  { label: 'Red',     value: '#ef4444' },
  { label: 'Pink',    value: '#ec4899' },
  { label: 'Purple',  value: '#8b5cf6' },
  { label: 'Blue',    value: '#3b82f6' },
  { label: 'White',   value: '#f1f5f9' },
  { label: 'Muted',   value: '#64748b' },
];

// Slash command options
const SLASH_COMMANDS = [
  { id: 'bold',   label: '**Bold**',       icon: 'B', desc: 'Bold text',        apply: (t: string) => `**${t || 'bold text'}**` },
  { id: 'italic', label: '_Italic_',       icon: 'I', desc: 'Italic text',      apply: (t: string) => `_${t || 'italic text'}_` },
  { id: 'bullet', label: '• Bullet',       icon: '•', desc: 'Bullet list item', apply: (t: string) => `• ${t || 'list item'}` },
  { id: 'h2',     label: '## Heading',     icon: 'H', desc: 'Section heading',  apply: (t: string) => `## ${t || 'Heading'}` },
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

// Auto-grow textarea height based on content
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// Clamp a portal position within viewport bounds
function clampPortalRect(
  preferredLeft: number,
  preferredTop: number,
  width: number,
  height: number,
  margin = 8,
): { left: number; top: number } {
  const maxLeft = window.innerWidth - width - margin;
  const maxTop = window.innerHeight - height - margin;
  return {
    left: Math.max(margin, Math.min(preferredLeft, maxLeft)),
    top: Math.max(margin, Math.min(preferredTop, maxTop)),
  };
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
  const [slashSelected, setSlashSelected] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [inputRect, setInputRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const filteredCmdsRef = useRef<typeof SLASH_COMMANDS>([]);
  const applySlashCommandRef = useRef<(cmdId: string) => void>(() => {});
  const toolbarWidth = 380; // estimated toolbar width for clamping

  useEffect(() => setMounted(true), []);

  // Sync draft when value prop changes externally
  useEffect(() => { setDraft(value ?? ''); }, [value]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      const el = inputRef.current;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
      if (multiline && el instanceof HTMLTextAreaElement) autoGrow(el);
    }
  }, [editing, multiline]);

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

  // Keyboard navigation for slash menu — uses refs to avoid stale closures over
  // filteredCmds and applySlashCommand, which are computed later in the render.
  const handleSlashKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!slashOpen) return;
    const cmds = filteredCmdsRef.current;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSlashSelected(s => Math.min(s + 1, cmds.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSlashSelected(s => Math.max(s - 1, 0)); }
    if (e.key === 'Escape') { e.preventDefault(); setSlashOpen(false); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = cmds[slashSelected];
      if (cmd) applySlashCommandRef.current(cmd.id);
    }
  }, [slashOpen, slashSelected]);

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
    if (multiline && e.target instanceof HTMLTextAreaElement) autoGrow(e.target);
    // Detect slash command: '/' at start or after newline/space
    const pos = e.target.selectionStart ?? val.length;
    const textBefore = val.slice(0, pos);
    const slashIdx = textBefore.lastIndexOf('/');
    if (slashIdx !== -1 && (slashIdx === 0 || textBefore[slashIdx - 1] === '\n' || textBefore[slashIdx - 1] === ' ')) {
      const query = textBefore.slice(slashIdx + 1);
      if (!query.includes(' ') && query.length <= 10) {
        setSlashQuery(query);
        setSlashSelected(0);
        setSlashOpen(true);
        return;
      }
    }
    setSlashOpen(false);
  };

  const applySlashCommand = (cmdId: string) => {
    const cmd = SLASH_COMMANDS.find(c => c.id === cmdId);
    if (!cmd || !inputRef.current) { setSlashOpen(false); return; }
    const el = inputRef.current;
    const pos = el.selectionStart ?? draft.length;
    const textBefore = draft.slice(0, pos);
    const slashIdx = textBefore.lastIndexOf('/');
    if (slashIdx === -1) { setSlashOpen(false); return; }
    const before = draft.slice(0, slashIdx);
    const after = draft.slice(pos);
    setDraft(before + cmd.apply('') + after);
    setSlashOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
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
      if (!inputRef.current) return;
      inputRef.current.focus();
      const newPos = start === end ? start + cursorOffset : end + cursorOffset * 2;
      inputRef.current.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const applyColor = (color: string) => {
    const el = inputRef.current;
    if (!el) return;
    const newVal = wrapSelection(el, `[c=${color}]`, '[/c]', 'text');
    setDraft(newVal);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const clearFormatting = () => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = el.value.slice(start, end);
    if (!selected) return;
    const stripped = selected
      .replace(/\[c=#?[a-zA-Z0-9]+\](.*?)\[\/c\]/gs, '$1')
      .replace(/\*\*(.*?)\*\*/gs, '$1')
      .replace(/_(.+?)_/gs, '$1');
    const newVal = el.value.slice(0, start) + stripped + el.value.slice(end);
    setDraft(newVal);
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(start, start + stripped.length); }, 0);
  };

  const filteredCmds = slashOpen
    ? SLASH_COMMANDS.filter(c =>
        c.id.startsWith(slashQuery) ||
        c.label.toLowerCase().includes(slashQuery.toLowerCase())
      )
    : [];
  // Keep refs in sync so the memoized handleSlashKeyDown always sees current values
  filteredCmdsRef.current = filteredCmds;
  applySlashCommandRef.current = applySlashCommand;

  // Compute clamped toolbar position
  const toolbarPos = inputRect
    ? clampPortalRect(
        inputRect.left,
        inputRect.top - 44,
        toolbarWidth,
        40,
      )
    : null;

  // Shared inline editor style — futuristic glassmorphism
  const editorBaseStyle: React.CSSProperties = {
    position: 'absolute',
    inset: -3,
    width: 'calc(100% + 6px)',
    background: 'rgba(6,10,20,0.82)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    color: '#f1f5f9',
    border: `1.5px solid ${ACCENT}`,
    borderRadius: 6,
    padding: '6px 10px',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'inherit',
    lineHeight: 'inherit',
    letterSpacing: 'inherit',
    resize: 'none',
    outline: 'none',
    zIndex: 1000,
    boxShadow: `0 0 0 3px ${GLOW}, 0 8px 32px rgba(0,0,0,0.4)`,
    transition: 'box-shadow 0.2s',
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
        outlineOffset: 4,
        borderRadius: 5,
        transition: 'outline-color 0.15s, outline-offset 0.15s',
      }}
      onMouseEnter={e => {
        if (!isSelected && !editing) {
          (e.currentTarget as HTMLElement).style.outlineColor = `${ACCENT}55`;
          (e.currentTarget as HTMLElement).style.outlineOffset = '3px';
        }
      }}
      onMouseLeave={e => {
        if (!isSelected && !editing) {
          (e.currentTarget as HTMLElement).style.outlineColor = 'transparent';
          (e.currentTarget as HTMLElement).style.outlineOffset = '4px';
        }
      }}
    >
      {/* Selection label badge */}
      {isSelected && !editing && (
        <span style={{
          position: 'absolute',
          top: -24, left: 0,
          fontSize: 10, fontWeight: 700,
          color: '#fff', background: `linear-gradient(135deg, ${ACCENT}, #8b5cf6)`,
          padding: '2px 8px', borderRadius: 5,
          pointerEvents: 'none', zIndex: 200,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          whiteSpace: 'nowrap', letterSpacing: '0.04em',
          boxShadow: `0 2px 8px ${GLOW}`,
        }}>
          ✎ {label}
        </span>
      )}

      {/* Inline editor overlay */}
      {editing && canInlineEdit && (
        <>
          {/* Futuristic floating toolbar — rendered in portal */}
          {toolbarPos && mounted && createPortal(
            <div
              style={{
                position: 'fixed',
                top: toolbarPos.top,
                left: toolbarPos.left,
                zIndex: 60000,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                background: 'rgba(6,10,20,0.95)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderRadius: 10,
                padding: '4px 6px',
                boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.25), 0 0 20px ${GLOW}`,
                border: '1px solid rgba(99,102,241,0.2)',
                pointerEvents: 'auto',
                flexWrap: 'nowrap',
                maxWidth: toolbarWidth,
                animation: 'toolbar-appear 0.15s cubic-bezier(0.4,0,0.2,1)',
              }}
              onMouseDown={e => e.preventDefault()}
            >
              <style>{`
                @keyframes toolbar-appear {
                  from { opacity: 0; transform: translateY(4px) scale(0.97); }
                  to   { opacity: 1; transform: translateY(0) scale(1); }
                }
              `}</style>

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
                  style={{
                    width: 26, height: 26, borderRadius: 5, border: 'none',
                    background: 'transparent', color: '#94a3b8', fontSize: 12,
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontFamily: 'system-ui',
                    transition: 'background 0.1s, color 0.1s',
                    ...btn.style,
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(99,102,241,0.2)';
                    (e.currentTarget as HTMLElement).style.color = '#c7d2fe';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                    (e.currentTarget as HTMLElement).style.color = '#94a3b8';
                  }}
                >{btn.icon}</button>
              ))}

              {/* Separator */}
              <div style={{ width: 1, background: 'rgba(255,255,255,0.1)', margin: '3px 4px', alignSelf: 'stretch' }} />

              {/* Colour swatches — smaller dots */}
              {COLOR_SWATCHES.map(swatch => (
                <button
                  key={swatch.value}
                  title={`${swatch.label}`}
                  onMouseDown={e => { e.preventDefault(); applyColor(swatch.value); }}
                  style={{
                    width: 14, height: 14, borderRadius: '50%',
                    border: '1.5px solid rgba(255,255,255,0.15)',
                    background: swatch.value,
                    cursor: 'pointer',
                    padding: 0,
                    flexShrink: 0,
                    transition: 'transform 0.12s, border-color 0.12s, box-shadow 0.12s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1.4)';
                    (e.currentTarget as HTMLElement).style.borderColor = '#fff';
                    (e.currentTarget as HTMLElement).style.boxShadow = `0 0 6px ${swatch.value}`;
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.15)';
                    (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                  }}
                />
              ))}

              {/* Separator */}
              <div style={{ width: 1, background: 'rgba(255,255,255,0.1)', margin: '3px 4px', alignSelf: 'stretch' }} />

              {/* Clear formatting */}
              <button
                title="Clear formatting from selection"
                onMouseDown={e => { e.preventDefault(); clearFormatting(); }}
                style={{
                  width: 26, height: 26, borderRadius: 5, border: 'none',
                  background: 'transparent', color: '#475569', fontSize: 10,
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontFamily: 'system-ui',
                  fontWeight: 700, letterSpacing: '-0.5px',
                  transition: 'background 0.1s, color 0.1s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.15)';
                  (e.currentTarget as HTMLElement).style.color = '#fca5a5';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = '#475569';
                }}
              >Tx</button>

              {/* Confirm/Cancel */}
              <div style={{ width: 1, background: 'rgba(255,255,255,0.1)', margin: '3px 4px', alignSelf: 'stretch' }} />

              <button
                title="Save (Enter)"
                onMouseDown={e => { e.preventDefault(); commit(); }}
                style={{
                  width: 26, height: 26, borderRadius: 5, border: 'none',
                  background: 'rgba(99,102,241,0.2)', color: '#818cf8', fontSize: 14,
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.1s, color 0.1s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(99,102,241,0.4)';
                  (e.currentTarget as HTMLElement).style.color = '#c7d2fe';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(99,102,241,0.2)';
                  (e.currentTarget as HTMLElement).style.color = '#818cf8';
                }}
              >✓</button>

              <button
                title="Cancel (Esc)"
                onMouseDown={e => { e.preventDefault(); cancel(); }}
                style={{
                  width: 26, height: 26, borderRadius: 5, border: 'none',
                  background: 'transparent', color: '#475569', fontSize: 12,
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.1s, color 0.1s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.1)';
                  (e.currentTarget as HTMLElement).style.color = '#fca5a5';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = '#475569';
                }}
              >✕</button>
            </div>,
            document.body
          )}

          {multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={draft}
              rows={Math.max(2, draft.split('\n').length)}
              onChange={handleChange}
              onBlur={commit}
              onKeyDown={e => {
                handleSlashKeyDown(e);
                if (e.key === 'Escape' && !slashOpen) { e.preventDefault(); cancel(); }
                if (e.ctrlKey || e.metaKey) {
                  if (e.key === 'b') { e.preventDefault(); applyFormat('bold'); }
                  if (e.key === 'i') { e.preventDefault(); applyFormat('italic'); }
                  if (e.key === 'Enter') { e.preventDefault(); commit(); }
                }
              }}
              style={{ ...editorBaseStyle, minHeight: 48, overflowY: 'hidden' }}
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
              style={{ ...editorBaseStyle, height: '1.6em' }}
            />
          )}

          {/* Slash command menu — portal, clamped to viewport */}
          {slashOpen && filteredCmds.length > 0 && inputRect && mounted && createPortal(
            <div
              style={{
                position: 'fixed',
                top: Math.min(inputRect.bottom + 6, window.innerHeight - 160),
                left: Math.max(8, Math.min(inputRect.left, window.innerWidth - 220)),
                zIndex: 60001,
                background: 'rgba(6,10,20,0.97)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderRadius: 10,
                boxShadow: `0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.2)`,
                border: '1px solid rgba(99,102,241,0.15)',
                overflow: 'hidden',
                minWidth: 210,
                pointerEvents: 'auto',
                animation: 'toolbar-appear 0.12s cubic-bezier(0.4,0,0.2,1)',
              }}
              onMouseDown={e => e.preventDefault()}
            >
              <div style={{ padding: '4px 8px 2px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: 9, color: '#475569', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'system-ui' }}>
                  Commands
                </span>
              </div>
              {filteredCmds.map((cmd, i) => (
                <button
                  key={cmd.id}
                  onMouseDown={e => { e.preventDefault(); applySlashCommand(cmd.id); }}
                  onMouseEnter={() => setSlashSelected(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    background: i === slashSelected ? 'rgba(99,102,241,0.15)' : 'transparent',
                    border: 'none',
                    color: '#e2e8f0',
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                    fontSize: 12,
                    fontFamily: 'system-ui',
                    transition: 'background 0.1s',
                  }}
                >
                  <span style={{
                    width: 24, height: 24, borderRadius: 6,
                    background: i === slashSelected ? ACCENT : 'rgba(99,102,241,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, flexShrink: 0,
                    color: '#fff', transition: 'background 0.1s',
                  }}>
                    {cmd.icon}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{cmd.label}</div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>{cmd.desc}</div>
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
