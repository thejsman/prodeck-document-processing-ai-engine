'use client';

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { BridgeMessage } from '@/lib/microsite-bridge';
import {
  Home, Search, Menu, ChevronRight, ChevronLeft, ChevronUp, ChevronDown,
  ArrowRight, ArrowLeft, ArrowUp, ArrowDown, ExternalLink,
  User, Users, Lock, Unlock, Shield, Eye, EyeOff, Key, UserCheck,
  Mail, Phone, MessageCircle, MessageSquare, Send, Bell, AtSign,
  FileText, Folder, Download, Upload, Share2, Paperclip,
  Video, Camera, Play, Pause, Music, Headphones, Mic, Volume2,
  Building, Briefcase, Calendar, Clock, MapPin, Tag, Package,
  CreditCard, DollarSign, ShoppingCart, Globe, Truck,
  BarChart2, TrendingUp, TrendingDown, Database, Activity,
  Pencil, Trash2, Plus, Minus, Check, Copy, RefreshCw, Settings, Sliders, Filter,
  Star, Heart, Bookmark, Award, Target, Zap, CheckCircle, XCircle,
  AlertCircle, AlertTriangle, Info, HelpCircle, ThumbsUp,
  Code, Terminal, Cpu, Smartphone, Monitor, Wifi, Cloud, Server,
  Sun, Moon, Compass, Rocket, Layers, Grid, Coffee, Flag, Gift,
  type LucideProps,
} from 'lucide-react';

// ── Curated Lucide icon list ────────────────────────────────────────────────
type LucideComp = React.ComponentType<LucideProps>;
const ICON_LIST: Array<{ name: string; C: LucideComp }> = [
  // Navigation
  { name: 'Home',         C: Home },        { name: 'Search',     C: Search },
  { name: 'Menu',         C: Menu },        { name: 'ChevronRight', C: ChevronRight },
  { name: 'ChevronLeft',  C: ChevronLeft }, { name: 'ChevronUp',  C: ChevronUp },
  { name: 'ChevronDown',  C: ChevronDown }, { name: 'ArrowRight', C: ArrowRight },
  { name: 'ArrowLeft',    C: ArrowLeft },   { name: 'ArrowUp',    C: ArrowUp },
  { name: 'ArrowDown',    C: ArrowDown },   { name: 'ExternalLink', C: ExternalLink },
  // User / Auth
  { name: 'User',         C: User },        { name: 'Users',      C: Users },
  { name: 'UserCheck',    C: UserCheck },   { name: 'Lock',       C: Lock },
  { name: 'Unlock',       C: Unlock },      { name: 'Shield',     C: Shield },
  { name: 'Eye',          C: Eye },         { name: 'EyeOff',     C: EyeOff },
  { name: 'Key',          C: Key },
  // Communication
  { name: 'Mail',         C: Mail },        { name: 'Phone',      C: Phone },
  { name: 'MessageCircle', C: MessageCircle }, { name: 'MessageSquare', C: MessageSquare },
  { name: 'Send',         C: Send },        { name: 'Bell',       C: Bell },
  { name: 'AtSign',       C: AtSign },
  // Files
  { name: 'FileText',     C: FileText },    { name: 'Folder',     C: Folder },
  { name: 'Download',     C: Download },    { name: 'Upload',     C: Upload },
  { name: 'Share',        C: Share2 },      { name: 'Paperclip',  C: Paperclip },
  // Media
  { name: 'Video',        C: Video },       { name: 'Camera',     C: Camera },
  { name: 'Play',         C: Play },        { name: 'Pause',      C: Pause },
  { name: 'Music',        C: Music },       { name: 'Headphones', C: Headphones },
  { name: 'Mic',          C: Mic },         { name: 'Volume',     C: Volume2 },
  // Business
  { name: 'Building',     C: Building },    { name: 'Briefcase',  C: Briefcase },
  { name: 'Calendar',     C: Calendar },    { name: 'Clock',      C: Clock },
  { name: 'MapPin',       C: MapPin },      { name: 'Tag',        C: Tag },
  { name: 'Package',      C: Package },     { name: 'CreditCard', C: CreditCard },
  { name: 'Dollar',       C: DollarSign },  { name: 'Cart',       C: ShoppingCart },
  { name: 'Globe',        C: Globe },       { name: 'Truck',      C: Truck },
  // Charts / Data
  { name: 'BarChart',     C: BarChart2 },   { name: 'TrendingUp', C: TrendingUp },
  { name: 'TrendingDown', C: TrendingDown },{ name: 'Database',   C: Database },
  { name: 'Activity',     C: Activity },
  // Actions
  { name: 'Pencil',       C: Pencil },      { name: 'Trash',      C: Trash2 },
  { name: 'Plus',         C: Plus },        { name: 'Minus',      C: Minus },
  { name: 'Check',        C: Check },       { name: 'Copy',       C: Copy },
  { name: 'Refresh',      C: RefreshCw },   { name: 'Settings',   C: Settings },
  { name: 'Sliders',      C: Sliders },     { name: 'Filter',     C: Filter },
  // Status / Feedback
  { name: 'Star',         C: Star },        { name: 'Heart',      C: Heart },
  { name: 'Bookmark',     C: Bookmark },    { name: 'Award',      C: Award },
  { name: 'Target',       C: Target },      { name: 'Zap',        C: Zap },
  { name: 'CheckCircle',  C: CheckCircle }, { name: 'XCircle',    C: XCircle },
  { name: 'AlertCircle',  C: AlertCircle }, { name: 'AlertTriangle', C: AlertTriangle },
  { name: 'Info',         C: Info },        { name: 'Help',       C: HelpCircle },
  { name: 'ThumbsUp',     C: ThumbsUp },
  // Tech
  { name: 'Code',         C: Code },        { name: 'Terminal',   C: Terminal },
  { name: 'Cpu',          C: Cpu },         { name: 'Smartphone', C: Smartphone },
  { name: 'Monitor',      C: Monitor },     { name: 'Wifi',       C: Wifi },
  { name: 'Cloud',        C: Cloud },       { name: 'Server',     C: Server },
  // Misc
  { name: 'Sun',          C: Sun },         { name: 'Moon',       C: Moon },
  { name: 'Compass',      C: Compass },     { name: 'Rocket',     C: Rocket },
  { name: 'Layers',       C: Layers },      { name: 'Grid',       C: Grid },
  { name: 'Coffee',       C: Coffee },      { name: 'Flag',       C: Flag },
  { name: 'Gift',         C: Gift },
];

// ── Lucide icon picker popup ────────────────────────────────────────────────
function LucideIconPicker({ disabled, onSelect, onClose }: {
  disabled: boolean;
  onSelect: (svgHtml: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const filtered = q.trim()
    ? ICON_LIST.filter(i => i.name.toLowerCase().includes(q.trim().toLowerCase()))
    : ICON_LIST;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 10px)',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 336,
        maxWidth: 'calc(100vw - 32px)',
        background: 'rgba(12,12,12,0.97)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: 12,
        boxShadow: '0 -12px 40px rgba(0,0,0,0.65)',
        padding: '10px 10px 8px',
        zIndex: 50,
      }}
    >
      {/* Search */}
      <input
        type="search"
        placeholder="Search icons…"
        value={q}
        autoFocus
        onChange={e => setQ(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box',
          height: 28, padding: '0 10px', fontSize: 12, borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.07)', color: '#fff',
          outline: 'none', marginBottom: 8,
        }}
      />
      {/* Icon grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 3,
          maxHeight: 210,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {filtered.map(({ name, C }) => (
          <button
            key={name}
            title={name}
            disabled={disabled}
            onClick={(e) => {
              const svg = (e.currentTarget as HTMLButtonElement).querySelector('svg');
              if (svg) onSelect(svg.outerHTML);
            }}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 3,
              padding: '6px 2px 5px',
              borderRadius: 6,
              background: 'transparent',
              border: '1px solid transparent',
              cursor: disabled ? 'not-allowed' : 'pointer',
              color: 'rgba(255,255,255,0.75)',
              opacity: disabled ? 0.4 : 1,
              transition: 'background 0.12s, border-color 0.12s, color 0.12s',
            }}
            onMouseEnter={e => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.background = 'rgba(99,102,241,0.2)';
              b.style.borderColor = 'rgba(99,102,241,0.45)';
              b.style.color = '#a5b4fc';
            }}
            onMouseLeave={e => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.background = 'transparent';
              b.style.borderColor = 'transparent';
              b.style.color = 'rgba(255,255,255,0.75)';
            }}
          >
            <C size={17} strokeWidth={1.75} />
            <span style={{
              fontSize: 7.5, color: 'rgba(255,255,255,0.3)',
              whiteSpace: 'nowrap', overflow: 'hidden',
              textOverflow: 'ellipsis', maxWidth: 40, lineHeight: 1,
            }}>
              {name}
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '20px 0', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
            No icons found
          </div>
        )}
      </div>
      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 7, paddingTop: 7, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>
          {filtered.length} of {ICON_LIST.length} · Lucide
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.4)', fontSize: 11,
            padding: '2px 6px', borderRadius: 4,
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

interface Props {
  selected: BridgeMessage;
  micrositeEditing: boolean;
  /** Height of the iframe container — used to flip panel above the element when near the bottom */
  containerH?: number;
  /** Width of the iframe container — used to clamp panel so it never overflows the right edge */
  containerW?: number;
  onStylePatch: (prop: string, value: string) => Promise<void>;
  onTextPatch: (newText: string) => Promise<void>;
  onImageReplace: (url: string) => Promise<void>;
  onBgImagePatch: (url: string) => Promise<void>;
  onIconReplace: (url: string) => Promise<void>;
  onSvgReplace: (svgMarkup: string) => Promise<void>;
  onLogoReplace: (url: string) => Promise<void>;
  onRemoveSection: () => Promise<void>;
  onRemoveSectionContainer: () => Promise<void>;
  onClose: () => void;
}

// ── Element type helpers ────────────────────────────────────────────────────
const TEXT_TAGS = new Set(['h1','h2','h3','h4','h5','h6','p','span','a','li','button','label','td','th','caption','figcaption','dt','dd','blockquote']);
const isTextEl = (tag: string) => TEXT_TAGS.has(tag.toLowerCase());
const isImgEl  = (tag: string) => tag.toLowerCase() === 'img';
const isSvgEl  = (tag: string) => tag.toLowerCase() === 'svg';
const isIconEl = (tag: string, outerHtml: string) => {
  if (isSvgEl(tag)) return true;
  const cls = (outerHtml.match(/\bclass="([^"]+)"/i)?.[1] ?? '').toLowerCase();
  return /\b(?:icon|ico|fa-|bi-|ri-|ti-|si-|ph-|material-icon|feather|heroicon|lucide)\b/.test(cls);
};
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
  const n = parseFloat(raw); // NaN for values like clamp(1.5rem, 3vw, 3rem)
  if (raw.includes('rem') || raw.includes('em')) return Math.round(n * 16) || 16;
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

// ── Compress an image File to a base64 data URL ──────────────────────────────
// Uses JPEG at 800px max width — ~10x smaller than PNG for photos.
// PNG was creating 1-2MB data URIs that bloated the HTML file.
function compressToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 800;
        const scale = img.naturalWidth > MAX ? MAX / img.naturalWidth : 1;
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(e.target!.result as string); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = e.target!.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// ── URL + upload combo input ──────────────────────────────────────────────────
function ImageInput({ placeholder, value, disabled, onCommit, accept = 'image/*' }: {
  placeholder: string; value: string; disabled: boolean;
  onCommit: (url: string) => void; accept?: string;
}) {
  const [local, setLocal] = useState(value);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setLocal(value); }, [value]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const dataUrl = await compressToDataUrl(f);
    setLocal(dataUrl);
    onCommit(dataUrl);
    e.target.value = '';
  }

  const canCommit = local.startsWith('http') || local.startsWith('data:');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
      <input
        type="url" placeholder={placeholder}
        value={local.startsWith('data:') ? '(local file)' : local}
        disabled={disabled}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && canCommit) onCommit(local); }}
        style={{
          height: 26, padding: '0 8px', fontSize: 11, borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)',
          outline: 'none', width: 130, opacity: disabled ? 0.4 : 1,
        }}
      />
      {/* Done — apply the typed/pasted URL */}
      <button
        title="Apply"
        disabled={disabled || !canCommit}
        onClick={() => { if (canCommit) onCommit(local); }}
        style={{
          height: 26, padding: '0 8px', fontSize: 11, borderRadius: 4, flexShrink: 0,
          border: '1px solid rgba(99,102,241,0.5)',
          background: canCommit && !disabled ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)',
          color: canCommit && !disabled ? '#a5b4fc' : 'rgba(255,255,255,0.3)',
          cursor: disabled || !canCommit ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          whiteSpace: 'nowrap', fontWeight: 600,
        }}
      >
        ✓
      </button>
      {/* Local file upload */}
      <button
        title="Upload from device"
        disabled={disabled}
        onClick={() => fileRef.current?.click()}
        style={{
          height: 26, padding: '0 7px', fontSize: 10, borderRadius: 4, flexShrink: 0,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)',
          cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        ↑ Local
      </button>
      <input ref={fileRef} type="file" accept={accept} style={{ display: 'none' }} onChange={handleFile} />
    </div>
  );
}

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
// Nav-logo SVG: an SVG element that is the initials badge inside a nav/header.
// Clicking it should show LOGO controls (image upload) not ICON controls.
const LOGO_CLASS_SET = new Set(['nav-logo','logo-link','brand-logo','site-logo','header-logo','logo-img','logo-text','navbar-brand']);
function isNavLogoEl(path: string, tag: string, outerHtml: string): boolean {
  const cls = (outerHtml.match(/\bclass="([^"]+)"/i)?.[1] ?? '').toLowerCase();
  if (cls.split(/\s+/).some(c => LOGO_CLASS_SET.has(c))) return true;
  if (!/\bnav\b/i.test(path)) return false;
  if (/(links|mob|burger|footer)/i.test(path)) return false;
  return tag === 'img' || tag === 'span' || tag === 'svg';
}

export function InlineEditPanel({ selected, micrositeEditing, containerH = 0, containerW = 0, onStylePatch, onTextPatch, onImageReplace, onBgImagePatch, onIconReplace, onSvgReplace, onLogoReplace, onRemoveSection, onRemoveSectionContainer, onClose }: Props) {
  const tag      = selected.tag?.toLowerCase() ?? '';
  const isImg    = isImgEl(tag);
  // A container (div/section) elevated from an <img> click via elevateToContainer:
  // it is NOT an <img> itself, but it wraps a fill-image. Treat it like an img
  // for editing purposes so Local/URL replacement routes to __IMAGE_INJECT_SCOPED__
  // (which finds the <img src> inside) rather than __BG_IMAGE_PATCH__ (CSS bg-image
  // which is invisible because the real <img> element sits on top of it).
  const wrappedImgSrc = !isImg ? parseImgSrc(selected.outerHtml) : '';
  const hasWrappedImg = wrappedImgSrc !== '';
  const isImgLike     = isImg || hasWrappedImg; // controls routing for all image ops
  const isIcon   = isIconEl(tag, selected.outerHtml);
  const isNavLogo = isNavLogoEl(selected.path ?? '', tag, selected.outerHtml ?? '');

  // Detect background containers: divs/sections whose purpose is to hold a background image.
  // These have a background-image inline style, or an id/class name that signals bg role.
  // They must NOT be classified as text elements even when they have no child HTML.
  const isBgContainer = !isImg && !isIcon && (
    /background(?:-image)?\s*:\s*url\(/i.test(selected.outerHtml) ||
    /\bid="[^"]*(?:bg|Bg|BG|background|Background|backdrop|Backdrop|cover|Cover|hero)[^"]*"/i.test(selected.outerHtml) ||
    /\bclass="[^"]*(?:\bbg\b|\bbg-|-bg\b|background|backdrop|\bcover\b|parallax|hero-bg|banner-bg)[^"]*"/i.test(selected.outerHtml)
  );

  // Treat element as "text" if it's a known text tag OR a leaf element with only text content.
  // Background containers are always excluded from the text classification.
  const hasChildElements = /<\w/.test(
    selected.outerHtml.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, ''),
  );
  const isText = (isTextEl(tag) || (!isImg && !isIcon && !hasChildElements)) && !isBgContainer;
  const isLeaf = isText && isLeafEl(selected.outerHtml);

  const [localFontSize,   setLocalFontSize]   = useState(16);
  const [localFontFamily, setLocalFontFamily] = useState('');
  const [localImgUrl,     setLocalImgUrl]     = useState('');
  const [localText,       setLocalText]       = useState('');
  const [localBgImgUrl,   setLocalBgImgUrl]   = useState('');
  const [localIconUrl,    setLocalIconUrl]    = useState('');

  useEffect(() => {
    setLocalFontSize(parseFontSize(selected.outerHtml));
    // Resolve applied font back to its option stack so the select value matches exactly
    const applied = parseFontFamily(selected.outerHtml).toLowerCase();
    const match = FONT_OPTIONS.find(o => {
      if (!o.stack) return false;
      return o.stack.replace(/['"]/g, '').split(',')[0].trim().toLowerCase() === applied;
    });
    setLocalFontFamily(match?.stack ?? '');
    setLocalImgUrl(parseImgSrc(selected.outerHtml));
    setLocalText(selected.text ?? '');
    setLocalBgImgUrl('');
    setLocalIconUrl('');
  }, [selected.path, selected.outerHtml, selected.text]);

  const [showIconPicker, setShowIconPicker] = useState(false);

  // Self-measure panel width AND container width via offsetParent.
  // useLayoutEffect is synchronous before paint, so there is never a visible flicker
  // and no dependency on the parent's ResizeObserver timing (containerW prop may be 0).
  const panelOuterRef = useRef<HTMLDivElement>(null);
  const [measuredHalfW, setMeasuredHalfW] = useState(420);
  const [measuredContainerW, setMeasuredContainerW] = useState(0);
  useLayoutEffect(() => {
    const el = panelOuterRef.current;
    if (!el) return;
    const half = Math.ceil(el.offsetWidth / 2) + 4;
    if (half !== measuredHalfW) setMeasuredHalfW(half);
    const parent = el.offsetParent as HTMLElement | null;
    if (parent) {
      const cw = parent.clientWidth;
      if (Math.abs(cw - measuredContainerW) > 1) setMeasuredContainerW(cw);
    }
  });

  const dis = micrositeEditing;

  const PANEL_H = 48;
  const GAP = 8;
  const rect = selected.rect;
  const below = rect.top + rect.height + GAP;
  const above = rect.top - PANEL_H - GAP;
  // Flip above when: element center is past 55% of container, OR panel would be within 40px of bottom.
  // Fall back to rect.top > 300 when containerH hasn't been measured yet (still 0).
  const elementCenter = rect.top + rect.height / 2;
  const showAbove = containerH > 0
    ? (elementCenter > containerH * 0.55 || below + PANEL_H + 40 > containerH)
    : elementCenter > 300;
  const unclamped = showAbove ? above : below;
  // Clamp at the bottom so the panel doesn't get buried below the container.
  // No top clamp: when the user scrolls up, the toolbar should scroll off the
  // top edge naturally (following the element) rather than sticking at y=0.
  const floatTop = containerH > 0
    ? Math.min(unclamped, containerH - PANEL_H - GAP)
    : unclamped;
  // Horizontal: clamp panel center so it never clips left or right.
  // Use self-measured container width (from offsetParent) which is always accurate.
  // Fall back to the containerW prop only if self-measurement hasn't fired yet.
  const effectiveCW = measuredContainerW > 0 ? measuredContainerW : containerW;
  const rawLeft = rect.left + rect.width / 2;
  const floatLeft = effectiveCW > 0
    ? Math.max(measuredHalfW + 8, Math.min(rawLeft, effectiveCW - measuredHalfW - 8))
    : rawLeft;

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
    // Outer wrapper: absolutely positioned near the selected element.
    // Icon picker uses position:absolute bottom:100% to float above this.
    <div
      ref={panelOuterRef}
      style={{
        position: 'absolute',
        top: floatTop,
        left: floatLeft,
        transform: 'translateX(-50%)',
        zIndex: 30,
        maxWidth: 'calc(100% - 16px)',
        width: 'max-content',
        pointerEvents: 'auto',
        userSelect: 'none',
      }}
    >
      {/* Lucide icon picker — floats above toolbar when toggled */}
      {isIcon && showIconPicker && (
        <LucideIconPicker
          disabled={dis}
          onSelect={(svgHtml) => {
            setShowIconPicker(false);
            void onSvgReplace(svgHtml);
          }}
          onClose={() => setShowIconPicker(false)}
        />
      )}

    {/* Toolbar */}
    <div
      style={{
        background: 'rgba(14,14,14,0.93)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3)',
        height: PANEL_H,
        display: 'flex',
        alignItems: 'stretch',
        overflow: 'hidden',
      }}
    >
    {/* Scrollable editing controls */}
    <div style={{
      flex: 1,
      minWidth: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '0 12px',
      overflowX: 'auto',
      overflowY: 'hidden',
    }}>
      {/* Element label */}
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.4)',
        whiteSpace: 'nowrap', maxWidth: 90, overflow: 'hidden',
        textOverflow: 'ellipsis', flexShrink: 0,
      }}>
        {label}
      </span>

      <Sep />

      {/* Background color — not applicable to bare <img> or icon/SVG elements */}
      {!isImg && !isIcon && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>BG</span>
          <ColorSwatch
            initial={bgColorHex}
            title="Background color"
            disabled={dis}
            onCommit={(hex) => void onStylePatch('background-color', hex)}
          />
        </div>
      )}

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
            value={localFontFamily}
            disabled={dis}
            onChange={(e) => {
              const stack = e.target.value;
              setLocalFontFamily(stack);
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

      {/* Image URL + local upload — img elements and containers wrapping a fill-image.
          Hidden for bg-containers: they use the BG IMG control below instead. */}
      {isImgLike && !isBgContainer && (
        <>
          <Sep />
          <ImageInput
            placeholder="Image URL…"
            value={localImgUrl}
            disabled={dis}
            onCommit={(url) => { setLocalImgUrl(url); void onImageReplace(url); }}
          />
        </>
      )}

      {/* Text content — leaf text elements */}
      {isLeaf && !isImgLike && (
        <>
          <Sep />
          <input
            type="text" placeholder="Edit text…"
            value={localText} disabled={dis}
            onChange={(e) => setLocalText(e.target.value)}
            onBlur={(e) => { if (e.target.value !== selected.text) void onTextPatch(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void onTextPatch(localText); } }}
            style={{
              height: 26, padding: '0 8px', fontSize: 11, borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)',
              outline: 'none', flex: '1 1 100px', minWidth: 80, maxWidth: 200, opacity: dis ? 0.4 : 1,
            }}
          />
          <button
            disabled={dis}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void onTextPatch(localText)}
            title="Apply text (Enter)"
            style={{
              height: 26, width: 26, borderRadius: 4, border: 'none', flexShrink: 0,
              background: dis ? 'rgba(255,255,255,0.04)' : 'rgba(99,102,241,0.75)',
              color: '#fff', cursor: dis ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, opacity: dis ? 0.4 : 1,
            }}
          >
            ✓
          </button>
        </>
      )}

      {/* Background image URL + local upload — bg-containers + generic containers.
          Nav-logo elements use LOGO controls instead. */}
      {(isBgContainer || (!isImgLike && !isText && !isIcon && !isNavLogo)) && (
        <>
          <Sep />
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>BG IMG</span>
          <ImageInput
            placeholder="Image URL…"
            value={localBgImgUrl}
            disabled={dis}
            onCommit={(url) => { setLocalBgImgUrl(url); void onBgImagePatch(url); }}
          />
        </>
      )}

      {/* Logo replacement — nav logo SVG / img / span: shows image upload instead of icon picker */}
      {isNavLogo && (
        <>
          <Sep />
          <span style={{ fontSize: 9, color: 'rgba(99,102,241,0.8)', flexShrink: 0, fontWeight: 600, letterSpacing: '0.06em' }}>LOGO</span>
          <ImageInput
            placeholder={isImg ? 'Replace logo URL…' : 'Upload or paste logo URL…'}
            value={isImg ? localImgUrl : ''}
            disabled={dis}
            onCommit={(url) => { setLocalImgUrl(url); void onLogoReplace(url); }}
          />
        </>
      )}

      {/* Icon replacement — SVG/icon elements only when NOT a nav logo */}
      {isIcon && !isNavLogo && (
        <>
          <Sep />
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>ICON</span>
          {/* Lucide icon chooser toggle */}
          <button
            title={showIconPicker ? 'Close icon picker' : 'Browse Lucide icons'}
            disabled={dis}
            onClick={() => setShowIconPicker(p => !p)}
            style={{
              height: 26, padding: '0 8px', fontSize: 10, fontWeight: 600,
              borderRadius: 4, flexShrink: 0,
              border: `1px solid ${showIconPicker ? 'rgba(99,102,241,0.6)' : 'rgba(255,255,255,0.18)'}`,
              background: showIconPicker ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.07)',
              color: showIconPicker ? '#a5b4fc' : 'rgba(255,255,255,0.7)',
              cursor: dis ? 'not-allowed' : 'pointer',
              opacity: dis ? 0.4 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            ⊞ Browse
          </button>
          {/* URL / upload fallback */}
          <ImageInput
            placeholder="Icon URL…"
            value={localIconUrl}
            disabled={dis}
            onCommit={(url) => { setLocalIconUrl(url); void onIconReplace(url); }}
          />
        </>
      )}

      <div style={{ flexShrink: 0, width: 4 }} />
    </div>{/* end scrollable section */}

    {/* Fixed right section — always visible, never scrolls away */}
    <div style={{
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '0 8px',
      borderLeft: '1px solid rgba(255,255,255,0.10)',
    }}>
      {/* Remove — deletes only the selected element. */}
      {selected.path && (
        <button
          onClick={() => void onRemoveSection()}
          disabled={dis}
          title="Remove this element"
          style={{
            height: 26, padding: '0 8px', fontSize: 10, fontWeight: 600, borderRadius: 4,
            border: '1px solid rgba(239,68,68,0.45)',
            background: dis ? 'rgba(255,255,255,0.04)' : 'rgba(239,68,68,0.12)',
            color: dis ? 'rgba(255,255,255,0.25)' : 'rgba(239,68,68,0.9)',
            cursor: dis ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
            opacity: dis ? 0.4 : 1, whiteSpace: 'nowrap',
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
          Remove
        </button>
      )}

      {/* Close */}
      <button onClick={onClose} title="Deselect" style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'rgba(255,255,255,0.35)', fontSize: 13, lineHeight: 1,
        display: 'flex', alignItems: 'center', padding: 3, borderRadius: 4, flexShrink: 0,
      }}>
        ✕
      </button>
    </div>
    </div>
    </div>
  );
}
