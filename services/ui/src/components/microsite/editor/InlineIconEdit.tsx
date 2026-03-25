'use client';

/**
 * Inline icon editor — drop this anywhere a SectionIcon renders.
 * In editor mode: click the icon to open a mini picker.
 * Outside editor: renders the icon as-is.
 */

import { useState, useRef, useEffect } from 'react';
import { useEditContext } from './EditContext';
import { useSectionId } from './SectionIdContext';
import { SectionIcon } from '../shared/SectionIcon';

const ICON_OPTIONS = [
  { hint: 'identity',  emoji: '👤' }, { hint: 'digital',  emoji: '💻' },
  { hint: 'content',   emoji: '📄' }, { hint: 'strategy', emoji: '⭐' },
  { hint: 'research',  emoji: '🔍' }, { hint: 'launch',   emoji: '🚀' },
  { hint: 'document',  emoji: '📁' }, { hint: 'website',  emoji: '🌐' },
  { hint: 'photo',     emoji: '🖼'  }, { hint: 'campaign', emoji: '📢' },
  { hint: 'check',     emoji: '✓'  }, { hint: 'star',     emoji: '✦'  },
  { hint: 'lock',      emoji: '🔒' }, { hint: 'bolt',     emoji: '⚡' },
  { hint: 'target',    emoji: '🎯' }, { hint: 'chart',    emoji: '📊' },
  { hint: 'tool',      emoji: '🔧' }, { hint: 'gem',      emoji: '💎' },
  { hint: 'trophy',    emoji: '🏆' }, { hint: 'shield',   emoji: '🛡'  },
  { hint: 'fire',      emoji: '🔥' }, { hint: 'leaf',     emoji: '🌿' },
  { hint: 'flag',      emoji: '🚩' }, { hint: 'default',  emoji: '⊞'  },
];

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
  const [tab, setTab] = useState<'grid' | 'upload' | 'url'>('grid');
  const [urlInput, setUrlInput] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
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
    ctx!.updateField(sectionId!, fieldPath, value);
    setOpen(false);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => apply(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  const isImage = hint.startsWith('data:') || hint.startsWith('http://') || hint.startsWith('https://');

  return (
    <div ref={panelRef} style={{ position: 'relative', display: 'inline-block' }}>
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
          // show edit hint
          const hint = el.querySelector('[data-icon-hint]') as HTMLElement | null;
          if (hint) hint.style.opacity = '1';
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.opacity = '1';
          const hint = el.querySelector('[data-icon-hint]') as HTMLElement | null;
          if (hint) hint.style.opacity = '0';
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

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30000,
            marginTop: 6,
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
            {([['grid', '⊞ Icons'], ['upload', '⬆ File'], ['url', '🔗 URL']] as [typeof tab, string][]).map(([t, label]) => (
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
            {tab === 'grid' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, marginBottom: 6 }}>
                  {ICON_OPTIONS.map(({ hint: h, emoji }) => (
                    <button
                      key={h}
                      title={h}
                      onClick={() => apply(h)}
                      style={{
                        width: '100%', aspectRatio: '1', borderRadius: 5,
                        border: hint === h ? '2px solid #6366f1' : '1px solid #e2e8f0',
                        background: hint === h ? '#f5f3ff' : '#f8fafc',
                        fontSize: 15, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                {/* Show current custom image if any */}
                {isImage && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px', borderRadius: 6, border: '2px solid #6366f1', background: '#f5f3ff', marginBottom: 6 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={hint} alt="" style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 4 }} />
                    <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 600 }}>Current: custom image ✓</span>
                  </div>
                )}
              </>
            )}

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
        </div>
      )}
    </div>
  );
}
