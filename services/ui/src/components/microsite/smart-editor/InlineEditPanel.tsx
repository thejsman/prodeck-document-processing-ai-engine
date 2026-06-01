'use client';

import { useState, useEffect, useRef } from 'react';
import type { BridgeMessage } from '@/lib/microsite-bridge';

interface Props {
  selected: BridgeMessage;
  micrositeEditing: boolean;
  onStylePatch: (prop: string, value: string) => Promise<void>;
  onTextPatch: (newText: string) => Promise<void>;
  onImageReplace: (url: string) => Promise<void>;
  onClose: () => void;
}

// ── Element type helpers ────────────────────────────────────────────────────
const TEXT_TAGS = new Set(['h1','h2','h3','h4','h5','h6','p','span','a','li','button','label','td','th','caption','figcaption','dt','dd','blockquote']);
const isTextEl = (tag: string) => TEXT_TAGS.has(tag.toLowerCase());
const isImgEl  = (tag: string) => tag.toLowerCase() === 'img';
const isLeafEl = (outerHtml: string) => !/<(div|section|article|ul|ol|table|p|h[1-6]|header|footer|nav|main|aside)\b/i.test(
  outerHtml.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, ''),
);

// ── Style parsers (inline style="" only — fallback to computed if unavailable) ──
function parseStyleProp(outerHtml: string, prop: string): string {
  const s = outerHtml.match(/\bstyle="([^"]*)"/i)?.[1] ?? '';
  return new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`, 'i').exec(s)?.[1]?.trim() ?? '';
}
const parseInlineBgColor = (h: string) => parseStyleProp(h, 'background-color');
const parseInlineColor   = (h: string) => parseStyleProp(h, 'color');
const parseImgSrc        = (h: string) => h.match(/\bsrc="([^"]+)"/i)?.[1] ?? '';
const isBoldEl           = (h: string) => /font-weight\s*:\s*(bold|[6-9]\d{2})/i.test(h);
const isItalicEl         = (h: string) => /font-style\s*:\s*italic/i.test(h);

function parseFontSize(outerHtml: string): number {
  const raw = parseStyleProp(outerHtml, 'font-size');
  if (!raw) return 16;
  const n = parseFloat(raw);
  if (raw.includes('rem') || raw.includes('em')) return Math.round(n * 16);
  return Math.round(n) || 16;
}
function parseFontFamily(outerHtml: string): string {
  return parseStyleProp(outerHtml, 'font-family').replace(/['"]/g, '').split(',')[0].trim();
}

// Convert rgb(r,g,b) / rgba(r,g,b,a) → #rrggbb hex for input[type=color]
function rgbToHex(color: string): string {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '';
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(+m[1])}${hex(+m[2])}${hex(+m[3])}`;
}

// Best color to display: prefer inline style, fall back to computed, fall back to default
function bestHexColor(inline: string, computed: string, fallback: string): string {
  if (/^#[0-9a-f]{3,8}$/i.test(inline)) return inline;
  if (inline.startsWith('rgb'))   return rgbToHex(inline) || fallback;
  if (computed.startsWith('rgb')) return rgbToHex(computed) || fallback;
  if (/^#[0-9a-f]{3,8}$/i.test(computed)) return computed;
  return fallback;
}

// ── Font options ─────────────────────────────────────────────────────────────
const FONT_OPTIONS: Array<{ label: string; stack: string }> = [
  { label: 'Default',          stack: '' },
  { label: 'Inter',            stack: 'Inter, system-ui, sans-serif' },
  { label: 'Roboto',           stack: 'Roboto, Arial, sans-serif' },
  { label: 'Open Sans',        stack: '"Open Sans", Arial, sans-serif' },
  { label: 'Lato',             stack: 'Lato, Arial, sans-serif' },
  { label: 'Montserrat',       stack: 'Montserrat, Arial, sans-serif' },
  { label: 'Poppins',          stack: 'Poppins, Arial, sans-serif' },
  { label: 'Raleway',          stack: 'Raleway, Arial, sans-serif' },
  { label: 'Nunito',           stack: 'Nunito, Arial, sans-serif' },
  { label: 'DM Sans',          stack: '"DM Sans", Arial, sans-serif' },
  { label: 'Space Grotesk',    stack: '"Space Grotesk", Arial, sans-serif' },
  { label: 'Playfair Display', stack: '"Playfair Display", Georgia, serif' },
  { label: 'Merriweather',     stack: 'Merriweather, Georgia, serif' },
  { label: 'Georgia',          stack: 'Georgia, serif' },
  { label: 'Arial',            stack: 'Arial, Helvetica, sans-serif' },
  { label: 'System UI',        stack: 'system-ui, -apple-system, sans-serif' },
];

// ── Color swatch — fires via debounced onChange + immediate onBlur ────────────
// This is more reliable than onBlur-only because hidden input[type=color] blur
// may not fire in all browsers when the OS native picker closes.
function ColorSwatch({ initial, title, disabled, onCommit }: {
  initial: string; title: string; disabled: boolean; onCommit: (hex: string) => void;
}) {
  const [local, setLocal]  = useState(initial);
  const inputRef           = useRef<HTMLInputElement>(null);
  const timerRef           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedRef       = useRef(initial); // last committed value

  // Re-seed when element changes
  useEffect(() => {
    setLocal(initial);
    committedRef.current = initial;
  }, [initial]);

  const pickerVal = /^#[0-9a-f]{3,8}$/i.test(local) ? local : '#ffffff';

  function doCommit(hex: string) {
    if (hex === committedRef.current) return;
    committedRef.current = hex;
    onCommit(hex);
  }

  function handleChange(hex: string) {
    setLocal(hex);
    // Debounced commit: fires 500ms after user stops dragging in picker
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      doCommit(hex);
    }, 500);
  }

  function handleBlur() {
    // Immediate commit when picker closes — cancel any pending debounce
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    doCommit(local);
  }

  return (
    <div title={title} style={{ position: 'relative', width: 20, height: 20, flexShrink: 0 }}>
      <div
        onClick={() => !disabled && inputRef.current?.click()}
        style={{
          width: 20, height: 20, borderRadius: '50%',
          background: local,
          border: '2px solid rgba(255,255,255,0.3)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
        }}
      />
      <input
        ref={inputRef}
        type="color"
        value={pickerVal}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        disabled={disabled}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, top: 0, left: 0 }}
      />
    </div>
  );
}

// ── Small icon button ────────────────────────────────────────────────────────
function IconBtn({ active, disabled, onClick, children, title }: {
  active?: boolean; disabled?: boolean; onClick: () => void;
  children: React.ReactNode; title?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      background: active ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)',
      border: `1px solid ${active ? 'rgba(99,102,241,0.6)' : 'rgba(255,255,255,0.12)'}`,
      borderRadius: 4, width: 26, height: 26,
      color: active ? '#a5b4fc' : 'rgba(255,255,255,0.75)',
      fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: disabled ? 0.4 : 1, flexShrink: 0,
    }}>
      {children}
    </button>
  );
}

const Sep = () => <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />;

// ── Main component ─────────────────────────────────────────────────────────
export function InlineEditPanel({ selected, micrositeEditing, onStylePatch, onTextPatch, onImageReplace, onClose }: Props) {
  const tag    = selected.tag?.toLowerCase() ?? '';
  const isText = isTextEl(tag);
  const isImg  = isImgEl(tag);
  const isLeaf = isText && isLeafEl(selected.outerHtml);

  const [localFontSize, setLocalFontSize] = useState(16);
  const [localImgUrl,   setLocalImgUrl]   = useState('');
  const [localText,     setLocalText]     = useState('');

  useEffect(() => {
    setLocalFontSize(parseFontSize(selected.outerHtml));
    setLocalImgUrl(parseImgSrc(selected.outerHtml));
    setLocalText(selected.text ?? '');
  }, [selected.path, selected.outerHtml, selected.text]);

  const dis = micrositeEditing;

  // ── Floating position ────────────────────────────────────────────────────
  const PANEL_H = 48;
  const GAP     = 10;
  const { top: elTop, left: elLeft, height: elHeight } = selected.rect;
  const showAbove = elTop + elHeight + PANEL_H + GAP > 480;
  const topPos    = showAbove
    ? Math.max(4, elTop - PANEL_H - GAP)
    : elTop + elHeight + GAP;
  const leftPos   = Math.max(8, elLeft);

  const label = [selected.tag, selected.sectionType].filter(Boolean).join(' · ');
  const bold   = isBoldEl(selected.outerHtml);
  const italic = isItalicEl(selected.outerHtml);

  // Use computed colors (from getComputedStyle in bridge) as ground truth;
  // fall back to inline style parse, then safe defaults.
  const bgColorHex = bestHexColor(
    parseInlineBgColor(selected.outerHtml),
    selected.computedBgColor ?? '',
    '#ffffff',
  );
  const textColorHex = bestHexColor(
    parseInlineColor(selected.outerHtml),
    selected.computedColor ?? '',
    '#000000',
  );

  function stepFontSize(delta: number) {
    const next = Math.max(8, Math.min(200, localFontSize + delta));
    setLocalFontSize(next);
    void onStylePatch('font-size', `${next}px`);
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: topPos,
        left: leftPos,
        zIndex: 30,
        maxWidth: 'calc(100% - 16px)',
        background: 'rgba(14,14,14,0.93)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3)',
        padding: '0 12px',
        height: PANEL_H,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        overflowX: 'auto',
        overflowY: 'hidden',
        pointerEvents: 'auto',
        userSelect: 'none',
      }}
    >
      {/* Element label */}
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.4)',
        whiteSpace: 'nowrap', maxWidth: 90, overflow: 'hidden',
        textOverflow: 'ellipsis', flexShrink: 0,
      }}>
        {label}
      </span>

      <Sep />

      {/* Background color */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>BG</span>
        <ColorSwatch
          initial={bgColorHex}
          title="Background color"
          disabled={dis}
          onCommit={(hex) => void onStylePatch('background-color', hex)}
        />
      </div>

      {/* Text color — text elements only */}
      {isText && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>A</span>
            <ColorSwatch
              initial={textColorHex}
              title="Text color"
              disabled={dis}
              onCommit={(hex) => void onStylePatch('color', hex)}
            />
          </div>

          <Sep />

          {/* Font family */}
          <select
            value={parseFontFamily(selected.outerHtml)}
            disabled={dis}
            onChange={(e) => {
              const opt = FONT_OPTIONS.find(o => o.stack.startsWith(e.target.value) || o.label === e.target.value);
              const stack = opt?.stack || e.target.value;
              if (stack) void onStylePatch('font-family', stack);
            }}
            style={{
              fontSize: 11, height: 26, padding: '0 6px', borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)',
              cursor: dis ? 'not-allowed' : 'pointer', outline: 'none',
              maxWidth: 110, flexShrink: 0, opacity: dis ? 0.4 : 1,
            }}
          >
            {FONT_OPTIONS.map(o => (
              <option key={o.label} value={o.stack || o.label} style={{ background: '#111' }}>
                {o.label}
              </option>
            ))}
          </select>

          {/* Font size stepper */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <IconBtn disabled={dis} onClick={() => stepFontSize(-2)} title="Decrease size">−</IconBtn>
            <input
              type="number" min={8} max={200}
              value={localFontSize}
              disabled={dis}
              onChange={(e) => setLocalFontSize(Number(e.target.value))}
              onBlur={(e) => void onStylePatch('font-size', `${Math.max(8, Math.min(200, Number(e.target.value)))}px`)}
              onKeyDown={(e) => { if (e.key === 'Enter') void onStylePatch('font-size', `${localFontSize}px`); }}
              style={{
                width: 34, height: 26, textAlign: 'center', fontSize: 11,
                borderRadius: 4, border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)',
                outline: 'none', opacity: dis ? 0.4 : 1,
              }}
            />
            <IconBtn disabled={dis} onClick={() => stepFontSize(2)} title="Increase size">+</IconBtn>
          </div>

          {/* Bold / Italic */}
          <IconBtn active={bold}   disabled={dis} onClick={() => void onStylePatch('font-weight', bold   ? 'normal' : '700')} title="Bold"><b>B</b></IconBtn>
          <IconBtn active={italic} disabled={dis} onClick={() => void onStylePatch('font-style',  italic ? 'normal' : 'italic')} title="Italic"><i>I</i></IconBtn>
        </>
      )}

      {/* Image URL — img elements only */}
      {isImg && (
        <>
          <Sep />
          <input
            type="url" placeholder="Image URL…"
            value={localImgUrl} disabled={dis}
            onChange={(e) => setLocalImgUrl(e.target.value)}
            onBlur={(e) => { if (e.target.value.startsWith('http')) void onImageReplace(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && localImgUrl.startsWith('http')) void onImageReplace(localImgUrl); }}
            style={{
              height: 26, padding: '0 8px', fontSize: 11, borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)',
              outline: 'none', width: 190, flexShrink: 0, opacity: dis ? 0.4 : 1,
            }}
          />
        </>
      )}

      {/* Text content — leaf text elements */}
      {isLeaf && !isImg && (
        <>
          <Sep />
          <input
            type="text" placeholder="Edit text…"
            value={localText} disabled={dis}
            onChange={(e) => setLocalText(e.target.value)}
            onBlur={(e) => { if (e.target.value !== selected.text) void onTextPatch(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void onTextPatch(localText); }}
            style={{
              height: 26, padding: '0 8px', fontSize: 11, borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)',
              outline: 'none', width: 200, flexShrink: 0, opacity: dis ? 0.4 : 1,
            }}
          />
        </>
      )}

      <div style={{ flexShrink: 0, width: 4 }} />

      {/* Close */}
      <button onClick={onClose} title="Deselect" style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'rgba(255,255,255,0.35)', fontSize: 13, lineHeight: 1,
        display: 'flex', alignItems: 'center', padding: 3, borderRadius: 4, flexShrink: 0,
      }}>
        ✕
      </button>
    </div>
  );
}
