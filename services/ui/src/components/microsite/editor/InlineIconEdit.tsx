'use client';

/**
 * Inline icon editor — drop this anywhere a SectionIcon renders.
 * In editor mode: click the icon to open a mini picker.
 * Outside editor: renders the icon as-is.
 */

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useEditContext } from './EditContext';
import { useSectionId } from './SectionIdContext';
import { SectionIcon } from '../shared/SectionIcon';


interface Props {
  /** dot-path to the iconHint field, e.g. "items.0.iconHint" */
  fieldPath: string;
  hint: string;
  color?: string;
  size?: number;
  /** wrapper style for the icon container */
  containerStyle?: React.CSSProperties;
}

export function InlineIconEdit({ fieldPath, hint, color = 'currentColor', size = 24, containerStyle }: Props) {
  const ctx = useEditContext();
  const sectionId = useSectionId();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'upload' | 'url'>('upload');
  const [urlInput, setUrlInput] = useState('');
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  // Calculate (and keep updated) popup position while open
  useEffect(() => {
    if (!open) return;
    function updatePos() {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const panelWidth = 260;
      const left = Math.min(
        Math.max(4, rect.left + rect.width / 2 - panelWidth / 2),
        window.innerWidth - panelWidth - 4,
      );
      setPopupPos({ top: rect.bottom + 6, left });
    }
    updatePos();
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open]);

  // Close on outside click — check both trigger and popup refs
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      const target = e.target as Node;
      const inTrigger = triggerRef.current?.contains(target);
      const inPopup = popupRef.current?.contains(target);
      if (!inTrigger && !inPopup) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Outside editor — render icon as-is
  if (!ctx || !sectionId) {
    return (
      <div style={containerStyle}>
        <SectionIcon hint={hint} color={color} size={size} />
      </div>
    );
  }

  function apply(value: string) {
    if (!ctx || !sectionId) return;
    ctx.updateField(sectionId, fieldPath, value);
    setOpen(false);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => apply(ev.target?.result as string);
    reader.onerror = () => setOpen(false);
    reader.readAsDataURL(file);
  }

  const isImage = !!hint && (hint.startsWith('data:') || hint.startsWith('http://') || hint.startsWith('https://'));

  return (
    <div ref={triggerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <div
        title="Click to change icon"
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        style={{
          ...containerStyle,
          cursor: 'pointer',
          position: 'relative',
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.opacity = '0.7';
          const hintEl = el.querySelector('[data-icon-hint]') as HTMLElement | null;
          if (hintEl) hintEl.style.opacity = '1';
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.opacity = '1';
          const hintEl = el.querySelector('[data-icon-hint]') as HTMLElement | null;
          if (hintEl) hintEl.style.opacity = '0';
        }}
      >
        <SectionIcon hint={hint} color={color} size={size} />
        {/* Edit hint overlay */}
        <span
          data-icon-hint
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 700,
            color: '#fff',
            background: 'rgba(99,102,241,0.7)',
            borderRadius: 6,
            opacity: 0,
            transition: 'opacity 0.15s',
            pointerEvents: 'none',
            fontFamily: 'system-ui',
          }}
        >
          ✎
        </span>
      </div>

      {/* Portal popup — rendered at body level to escape overflow:hidden */}
      {open && popupPos && mounted && createPortal(
        <div
          ref={popupRef}
          style={{
            position: 'fixed',
            top: popupPos.top,
            left: popupPos.left,
            zIndex: 60000,
            width: 260,
            background: '#fff',
            borderRadius: 10,
            boxShadow: '0 12px 36px rgba(0,0,0,0.2)',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#1e293b' }}>Change Icon</span>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 14, padding: 2 }}>✕</button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0' }}>
            {([['upload', '⬆ Upload File'], ['url', '🔗 Image URL']] as [typeof tab, string][]).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1, padding: '6px 0', border: 'none', fontSize: 10, fontWeight: tab === t ? 700 : 500,
                  background: tab === t ? '#f5f3ff' : '#fff',
                  color: tab === t ? '#6366f1' : '#64748b',
                  cursor: 'pointer',
                  borderBottom: tab === t ? '2px solid #6366f1' : '2px solid transparent',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ padding: 8 }}>
            {tab === 'upload' && (
              <>
                <label style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 5, padding: '14px 8px', border: '2px dashed #c7d2fe', borderRadius: 7,
                  background: '#f5f3ff', cursor: 'pointer', marginBottom: 6,
                }}>
                  <span style={{ fontSize: 20 }}>⬆</span>
                  <span style={{ fontSize: 11, color: '#6366f1', fontWeight: 600 }}>Upload icon file</span>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>PNG · SVG · ICO · WebP</span>
                  <input ref={fileInputRef} type="file" accept="image/*,.svg,.ico" onChange={handleFile} style={{ display: 'none' }} />
                </label>
                {isImage && hint.startsWith('data:') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={hint} alt="" style={{ width: 24, height: 24, objectFit: 'contain' }} />
                    <span style={{ fontSize: 10, color: '#475569' }}>Uploaded image active</span>
                  </div>
                )}
              </>
            )}

            {tab === 'url' && (
              <>
                <input
                  type="text"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="https://example.com/icon.svg"
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 5, border: '1px solid #e2e8f0', fontSize: 11, marginBottom: 6, boxSizing: 'border-box' }}
                />
                {urlInput && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '4px 6px', borderRadius: 5, border: '1px solid #e2e8f0', background: '#f8fafc' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={urlInput} alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <span style={{ fontSize: 10, color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{urlInput}</span>
                  </div>
                )}
                <button
                  onClick={() => urlInput.trim() && apply(urlInput.trim())}
                  style={{ width: '100%', padding: '6px', borderRadius: 5, border: 'none', background: urlInput.trim() ? '#6366f1' : '#e2e8f0', color: urlInput.trim() ? '#fff' : '#94a3b8', fontSize: 11, fontWeight: 600, cursor: urlInput.trim() ? 'pointer' : 'default' }}
                >
                  Apply URL
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
