'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowUp, ArrowDown, Pencil } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useEditContext } from './EditContext';
import type { LayoutAST, SectionType } from '../../../types/presentation';

// ── Icon picker inline ──────────────────────────────────────────────────────

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
  { hint: 'default',   emoji: '⊞'  }, { hint: 'flag',     emoji: '🚩' },
];

type IconTab = 'emoji' | 'upload' | 'url';

function IconPickerField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<IconTab>('emoji');
  const [urlInput, setUrlInput] = useState('');
  const [uploadPreview, setUploadPreview] = useState<string | null>(
    value.startsWith('data:') ? value : null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const isImage = value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://');
  const found = !isImage ? ICON_OPTIONS.find(o => o.hint === value) : null;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      setUploadPreview(dataUrl);
      onChange(dataUrl);
      setOpen(false);
    };
    reader.onerror = () => setOpen(false);
    reader.readAsDataURL(file);
  }

  function applyUrl() {
    const url = urlInput.trim();
    if (!url) return;
    onChange(url);
    setOpen(false);
  }

  // Trigger value display
  let displayEmoji = found?.emoji ?? '⊞';
  let displayLabel = value || 'default';
  if (isImage) {
    displayEmoji = '';
    displayLabel = 'Custom image';
  }

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%',
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid var(--color-border, #e2e8f0)',
          background: 'var(--color-surface, #fff)',
          fontSize: 12,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textAlign: 'left',
          color: 'var(--color-text, #111)',
        }}
      >
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" style={{ width: 18, height: 18, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
        ) : (
          <span style={{ fontSize: 16, flexShrink: 0 }}>{displayEmoji}</span>
        )}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayLabel}</span>
        <span style={{ color: 'var(--subtle)', fontSize: 10, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 9999,
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
          marginTop: 4,
          overflow: 'hidden',
        }}>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
            {([['emoji', '⊞ Icons'], ['upload', '⬆ Upload'], ['url', '🔗 URL']] as [IconTab, string][]).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1, padding: '7px 0', border: 'none', fontSize: 11, fontWeight: tab === t ? 700 : 500,
                  background: tab === t ? 'var(--primary-tint)' : 'var(--panel)',
                  color: tab === t ? 'var(--primary)' : 'var(--muted)',
                  cursor: 'pointer',
                  borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ padding: 8 }}>
            {tab === 'emoji' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, marginBottom: 8 }}>
                  {ICON_OPTIONS.map(({ hint, emoji }) => (
                    <button
                      key={hint}
                      title={hint}
                      onClick={() => { onChange(hint); setOpen(false); }}
                      style={{
                        width: '100%', aspectRatio: '1', borderRadius: 5,
                        border: value === hint ? '2px solid var(--primary)' : '1px solid var(--border)',
                        background: value === hint ? 'var(--primary-tint)' : 'var(--bg)',
                        fontSize: 16, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Custom hint (e.g. check, star)…"
                  defaultValue={!isImage ? value : ''}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { onChange((e.target as HTMLInputElement).value); setOpen(false); }
                  }}
                  style={{ width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid var(--border)', fontSize: 12, boxSizing: 'border-box' }}
                />
              </>
            )}

            {tab === 'upload' && (
              <div>
                <label
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 6, padding: '16px 8px',
                    border: '2px dashed #c7d2fe', borderRadius: 7,
                    background: 'var(--primary-tint)', cursor: 'pointer', marginBottom: 8,
                  }}
                >
                  <span style={{ fontSize: 22 }}>⬆</span>
                  <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>Click to upload icon</span>
                  <span style={{ fontSize: 10, color: 'var(--subtle)' }}>PNG · JPG · SVG · WebP · ICO</span>
                  <input ref={fileInputRef} type="file" accept="image/*,.svg,.ico" onChange={handleFile} style={{ display: 'none' }} />
                </label>
                {uploadPreview && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={uploadPreview} alt="" style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 4 }} />
                    <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>Uploaded image</span>
                    <button
                      onClick={() => { onChange(uploadPreview); setOpen(false); }}
                      style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                    >
                      Use
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === 'url' && (
              <div>
                <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--muted)' }}>
                  Paste an icon URL (PNG, SVG, ICO…)
                </p>
                <input
                  type="text"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="https://example.com/icon.svg"
                  style={{ width: '100%', padding: '6px 9px', borderRadius: 5, border: '1px solid var(--border)', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }}
                />
                {urlInput && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: 6, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={urlInput} alt="" style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 4 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <span style={{ fontSize: 11, color: 'var(--subtle)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{urlInput}</span>
                  </div>
                )}
                <button
                  onClick={applyUrl}
                  disabled={!urlInput.trim()}
                  style={{
                    width: '100%', padding: '6px', borderRadius: 5, border: 'none',
                    background: urlInput.trim() ? 'var(--primary)' : 'var(--border)',
                    color: urlInput.trim() ? '#fff' : 'var(--subtle)',
                    fontSize: 12, fontWeight: 600, cursor: urlInput.trim() ? 'pointer' : 'default',
                  }}
                >
                  Apply URL
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Type label map ─────────────────────────────────────────────────────────

const SECTION_LABELS: Partial<Record<SectionType, string>> = {
  hero: 'Hero',
  overview: 'Overview',
  challenge: 'Challenge',
  problem: 'Problem',
  approach: 'Approach',
  deliverables: 'Deliverables',
  timeline: 'Timeline',
  pricing: 'Pricing',
  whyus: 'Why Us',
  nextsteps: 'Next Steps',
  testimonials: 'Testimonials',
  showcase: 'Showcase',
  benefits: 'Benefits',
  stats: 'Stats',
  metrics: 'Metrics',
  security: 'Security',
  techstack: 'Tech Stack',
  testing: 'Testing',
  faq: 'FAQ',
  team: 'Team',
  comparison: 'Comparison',
  casestudy: 'Case Study',
  generic: 'Generic',
};

// ── Field definitions per section type ───────────────────────────────────

interface FieldDef {
  path: string;
  label: string;
  type: 'text' | 'textarea' | 'button';
}

const TEXT = (path: string, label: string): FieldDef => ({ path, label, type: 'textarea' });
const SHORT = (path: string, label: string): FieldDef => ({ path, label, type: 'text' });
const BTN = (path: string, label: string): FieldDef => ({ path, label, type: 'button' });

const SECTION_FIELDS: Partial<Record<SectionType, FieldDef[]>> = {
  hero: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
    TEXT('body', 'Body'),
    BTN('ctaPrimary', 'Primary CTA'),
    BTN('ctaSecondary', 'Secondary CTA'),
  ],
  overview: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
    TEXT('body', 'Body'),
  ],
  challenge: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('body', 'Body'),
    TEXT('pullquote', 'Pull Quote'),
  ],
  problem: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('body', 'Body'),
  ],
  approach: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
  ],
  deliverables: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
  ],
  timeline: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
  ],
  pricing: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
    SHORT('cta', 'CTA Text'),
    TEXT('footnote', 'Footnote'),
  ],
  whyus: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('body', 'Body'),
    TEXT('subheadline', 'Subheadline'),
  ],
  nextsteps: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('body', 'Body'),
    BTN('ctaPrimary', 'Primary CTA'),
    BTN('ctaSecondary', 'Secondary CTA'),
    SHORT('urgencyNote', 'Urgency Note'),
  ],
  testimonials: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
  ],
  showcase: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
    TEXT('body', 'Body'),
  ],
  benefits: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
  ],
  stats: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
  ],
  metrics: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
  ],
  security: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
  ],
  techstack: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
  ],
  testing: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
  ],
  faq: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
  ],
  team: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
  ],
  comparison: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
    SHORT('usLabel', 'Our Label'),
    SHORT('themLabel', 'Their Label'),
  ],
  casestudy: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('challenge', 'Challenge'),
    TEXT('solution', 'Solution'),
    TEXT('outcome', 'Outcome'),
  ],
  generic: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('body', 'Body'),
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────────

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null) return '';
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : '';
}

// ── Input components ───────────────────────────────────────────────────────

interface FieldProps {
  def: FieldDef;
  value: string;
  onChange: (value: string) => void;
  isSelected: boolean;
}

function FieldInput({ def, value, onChange, isSelected }: FieldProps) {
  const borderColor = isSelected ? 'var(--primary)' : 'var(--color-border, #e2e8f0)';
  const bg = isSelected ? 'var(--primary-tint)' : 'var(--color-surface, #fff)';

  const baseStyle: React.CSSProperties = {
    width: '100%',
    padding: '7px 10px',
    borderRadius: 6,
    border: `1px solid ${borderColor}`,
    background: bg,
    color: 'var(--color-text, #111)',
    fontSize: 12,
    outline: 'none',
    transition: 'border-color 0.12s, background 0.12s',
    boxSizing: 'border-box',
    resize: 'vertical' as const,
  };

  if (def.type === 'textarea') {
    return (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        style={{ ...baseStyle, lineHeight: 1.5 }}
      />
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={baseStyle}
    />
  );
}

// ── Section fields panel ───────────────────────────────────────────────────

interface SectionPanelProps {
  sectionId: string;
  sectionType: SectionType;
  content: Record<string, unknown>;
  selection: { fieldPath: string } | null;
}

function SectionFieldsPanel({ sectionId, sectionType, content, selection }: SectionPanelProps) {
  const ctx = useEditContext()!;
  const fields = SECTION_FIELDS[sectionType] ?? SECTION_FIELDS.generic ?? [];

  if (fields.length === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--color-text-muted, #888)', padding: '8px 0' }}>
        No editable fields for this section type.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {fields.map(def => {
        const value = getNestedValue(content, def.path);
        const isSelected = selection?.fieldPath === def.path;
        return (
          <div key={def.path}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 400,
              color: isSelected ? 'var(--primary)' : 'var(--color-text-muted, #666)',
              marginBottom: 4,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              lineHeight: 1.4,
                      }}>
              {isSelected && (
                <span style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--primary)',
                  flexShrink: 0,
                }} />
              )}
              {def.label}
              {def.type === 'button' && (
                <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--color-text-muted, #999)', marginLeft: 'auto', textTransform: 'none' }}>
                  button
                </span>
              )}
            </label>
            <FieldInput
              def={def}
              value={value}
              onChange={val => ctx.updateField(sectionId, def.path, val)}
              isSelected={isSelected}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Generic array panel ────────────────────────────────────────────────────

interface ArrayItemField { key: string; label: string; multiline?: boolean; }

interface ArrayPanelProps {
  sectionId: string;
  arrayPath: string;
  title: string;
  items: Record<string, unknown>[];
  fields: ArrayItemField[];
  itemTemplate: Record<string, unknown>;
  addLabel?: string;
}

function ArrayItemPanel({ sectionId, arrayPath, title, items, fields, itemTemplate, addLabel = 'Add item' }: ArrayPanelProps) {
  const ctx = useEditContext()!;
  const canAdd = 'addArrayItem' in ctx;
  const canRemove = 'removeArrayItem' in ctx;
  const canMove = 'moveArrayItem' in ctx;

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1.4, color: 'var(--color-text-muted)', margin: 0 }}>
          {title}
        </p>
        {canAdd && (
          <button
            onClick={() => ctx.addArrayItem(sectionId, arrayPath, { ...itemTemplate })}
            style={{ padding: '5px 12px', borderRadius: 5, border: '1px solid var(--primary)', background: 'var(--primary-soft)', color: 'var(--primary)', fontSize: 14, fontWeight: 400, cursor: 'pointer', lineHeight: 1.5, letterSpacing: '0em' }}
          >
            + {addLabel}
          </button>
        )}
      </div>
      {items.map((item, i) => (
        <div key={i} style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-muted)' }}>
              #{i + 1}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {canMove && i > 0 && (
                <button
                  onClick={() => ctx.moveArrayItem(sectionId, arrayPath, i, i - 1)}
                  style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 14, cursor: 'pointer', color: 'var(--color-text-muted)' }}
                  title="Move up"
                ><Icon icon={ArrowUp} size="sm" /></button>
              )}
              {canMove && i < items.length - 1 && (
                <button
                  onClick={() => ctx.moveArrayItem(sectionId, arrayPath, i, i + 1)}
                  style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 14, cursor: 'pointer', color: 'var(--color-text-muted)' }}
                  title="Move down"
                ><Icon icon={ArrowDown} size="sm" /></button>
              )}
              {canRemove && (
                <button
                  onClick={() => ctx.removeArrayItem(sectionId, arrayPath, i)}
                  style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #fecaca', background: '#fef2f2', fontSize: 14, cursor: 'pointer', color: '#dc2626' }}
                  title="Remove"
                >×</button>
              )}
            </div>
          </div>
          {fields.map(f => {
            const val = typeof item[f.key] === 'string' ? (item[f.key] as string) : '';
            const handleChange = (v: string) => ctx.updateField(sectionId, `${arrayPath}.${i}.${f.key}`, v);
            const isIconField = f.key === 'iconHint';
            return (
              <div key={f.key} style={{ marginBottom: 6 }}>
                <label style={{ fontSize: 10, fontWeight: 400, color: 'var(--color-text-muted)', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1.4 }}>
                  {f.label}
                </label>
                {isIconField ? (
                  <IconPickerField value={val} onChange={handleChange} />
                ) : f.multiline ? (
                  <textarea
                    value={val}
                    onChange={e => handleChange(e.target.value)}
                    rows={2}
                    style={{ width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid var(--color-border)', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }}
                  />
                ) : (
                  <input
                    type="text"
                    value={val}
                    onChange={e => handleChange(e.target.value)}
                    style={{ width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid var(--color-border)', fontSize: 12, boxSizing: 'border-box' }}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
      {items.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: '12px 0' }}>
          No items yet. Click "+ {addLabel}" to add one.
        </p>
      )}
    </div>
  );
}

// ── Array config per section type ─────────────────────────────────────────

interface ArrayConfig {
  arrayPath: string;
  title: string;
  fields: ArrayItemField[];
  template: Record<string, unknown>;
  addLabel?: string;
}

const ARRAY_CONFIGS: Partial<Record<SectionType, ArrayConfig>> = {
  approach: {
    arrayPath: 'pillars',
    title: 'Pillars',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description', multiline: true },
      { key: 'iconHint', label: 'Icon' },
    ],
    template: { iconHint: 'star', name: 'New pillar', description: '' },
    addLabel: 'Add pillar',
  },
  deliverables: {
    arrayPath: 'items',
    title: 'Deliverables',
    fields: [
      { key: 'iconHint', label: 'Icon' },
      { key: 'name', label: 'Name' },
      { key: 'detail', label: 'Detail', multiline: true },
    ],
    template: { iconHint: 'document', name: 'New deliverable', detail: '' },
    addLabel: 'Add deliverable',
  },
  benefits: {
    arrayPath: 'items',
    title: 'Benefits',
    fields: [
      { key: 'iconHint', label: 'Icon' },
      { key: 'title', label: 'Title' },
      { key: 'description', label: 'Description', multiline: true },
    ],
    template: { iconHint: 'check', title: 'New benefit', description: '' },
    addLabel: 'Add benefit',
  },
  testimonials: {
    arrayPath: 'items',
    title: 'Testimonials',
    fields: [
      { key: 'quote', label: 'Quote', multiline: true },
      { key: 'author', label: 'Author' },
      { key: 'role', label: 'Role / Company' },
    ],
    template: { quote: '', author: '', role: '' },
    addLabel: 'Add testimonial',
  },
  stats: {
    arrayPath: 'stats',
    title: 'Stats',
    fields: [
      { key: 'value', label: 'Value' },
      { key: 'label', label: 'Label' },
      { key: 'description', label: 'Description', multiline: true },
    ],
    template: { value: '0', label: 'New stat', description: '' },
    addLabel: 'Add stat',
  },
  metrics: {
    arrayPath: 'metrics',
    title: 'Metrics',
    fields: [
      { key: 'value', label: 'Value' },
      { key: 'label', label: 'Label' },
      { key: 'description', label: 'Description', multiline: true },
    ],
    template: { value: '0%', label: 'New metric', description: '' },
    addLabel: 'Add metric',
  },
  timeline: {
    arrayPath: 'phases',
    title: 'Phases',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'duration', label: 'Duration' },
      { key: 'description', label: 'Description', multiline: true },
    ],
    template: { name: 'New phase', duration: '2 weeks', description: '' },
    addLabel: 'Add phase',
  },
  faq: {
    arrayPath: 'items',
    title: 'Questions',
    fields: [
      { key: 'question', label: 'Question' },
      { key: 'answer', label: 'Answer', multiline: true },
    ],
    template: { question: 'New question?', answer: 'Answer goes here…' },
    addLabel: 'Add question',
  },
  team: {
    arrayPath: 'members',
    title: 'Team Members',
    fields: [
      { key: 'iconHint', label: 'Icon' },
      { key: 'name', label: 'Name' },
      { key: 'role', label: 'Role' },
      { key: 'bio', label: 'Bio', multiline: true },
    ],
    template: { iconHint: 'identity', name: 'Team Member', role: 'Role Title', bio: '' },
    addLabel: 'Add member',
  },
  comparison: {
    arrayPath: 'rows',
    title: 'Comparison Rows',
    fields: [
      { key: 'feature', label: 'Feature' },
      { key: 'us', label: 'Our Value' },
      { key: 'them', label: 'Their Value' },
    ],
    template: { feature: 'Feature', us: '✓', them: '✗' },
    addLabel: 'Add row',
  },
  casestudy: {
    arrayPath: 'metrics',
    title: 'Result Metrics',
    fields: [
      { key: 'value', label: 'Value' },
      { key: 'label', label: 'Label' },
    ],
    template: { value: '0%', label: 'Result' },
    addLabel: 'Add metric',
  },
  overview: {
    arrayPath: 'highlights',
    title: 'Key Highlights',
    fields: [
      { key: 'value', label: 'Value' },
      { key: 'label', label: 'Label' },
    ],
    template: { value: '—', label: 'Key fact' },
    addLabel: 'Add highlight',
  },
  whyus: {
    arrayPath: 'stats',
    title: 'Stats',
    fields: [
      { key: 'value', label: 'Value' },
      { key: 'label', label: 'Label' },
      { key: 'description', label: 'Description', multiline: true },
    ],
    template: { value: '0', label: 'New stat', description: '' },
    addLabel: 'Add stat',
  },
  security: {
    arrayPath: 'items',
    title: 'Security Points',
    fields: [
      { key: 'iconHint', label: 'Icon' },
      { key: 'title', label: 'Title' },
      { key: 'description', label: 'Description', multiline: true },
    ],
    template: { iconHint: 'lock', title: 'Security feature', description: '' },
    addLabel: 'Add point',
  },
  techstack: {
    arrayPath: 'items',
    title: 'Technologies',
    fields: [
      { key: 'iconHint', label: 'Icon' },
      { key: 'name', label: 'Name' },
      { key: 'category', label: 'Category' },
      { key: 'description', label: 'Description', multiline: true },
    ],
    template: { iconHint: 'tool', name: 'Technology', category: 'Category', description: '' },
    addLabel: 'Add technology',
  },
  testing: {
    arrayPath: 'layers',
    title: 'Testing Layers',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'coverage', label: 'Coverage' },
      { key: 'description', label: 'Description', multiline: true },
    ],
    template: { level: 1, name: 'New layer', coverage: '80%', description: '' },
    addLabel: 'Add layer',
  },
};

// ── Main EditPanel ─────────────────────────────────────────────────────────

export function EditPanel({ ast }: { ast: LayoutAST }) {
  const ctx = useEditContext();
  if (!ctx) return null;

  const { activeSectionId, selection } = ctx;
  const section = activeSectionId ? ast.sections.find(s => s.id === activeSectionId) : null;
  const content = section ? (section.content as unknown as Record<string, unknown>) : null;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-bg, #fff)',
      }}>
      {/* Panel header */}
      <div style={{
        padding: '14px 16px 12px',
        borderBottom: '1px solid var(--color-border, #e2e8f0)',
        flexShrink: 0,
      }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--primary)' }}>
          Content Editor
        </p>
        {selection && (
          <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--color-text-muted)' }}>
            Editing: <strong style={{ color: 'var(--color-text)' }}>{selection.label}</strong>
          </p>
        )}
      </div>

      {/* Section selector */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border, #e2e8f0)', flexShrink: 0 }}>
        <label style={{ fontSize: 11, fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1.4, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>
          Section
        </label>
        <select
          value={activeSectionId ?? ''}
          onChange={e => ctx.selectSection(e.target.value)}
          style={{
            width: '100%',
            padding: '7px 10px',
            borderRadius: 6,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <option value="">— Select a section —</option>
          {ast.sections.map(s => (
            <option key={s.id} value={s.id}>
              {SECTION_LABELS[s.sectionType] ?? s.sectionType} — {s.heading}
            </option>
          ))}
        </select>
      </div>

      {/* Field editors */}
      <div style={{ padding: '14px 16px', flex: 1, overflowY: 'auto' }}>
        {!section && (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--color-text-muted)' }}>
            <span style={{ display: 'block', marginBottom: 8 }}><Icon icon={Pencil} size="xl" /></span>
            <p style={{ fontSize: 13, fontWeight: 400, margin: 0 }}>Select a section to edit</p>
            <p style={{ fontSize: 12, margin: '6px 0 0', lineHeight: 1.5 }}>
              Use the dropdown above, or click any highlighted element on the canvas
            </p>
          </div>
        )}

        {section && content && (
          <>
            {/* Section nav title */}
            <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--color-border, #e2e8f0)' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6366f1', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1.4 }}>
                Section Title (nav label)
              </label>
              <input
                type="text"
                value={section.heading}
                onChange={e => ctx.updateField(section.id, '__heading', e.target.value)}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--primary-alpha)', fontSize: 12, boxSizing: 'border-box', background: 'var(--primary-tint)' }}
              />
            </div>

            {/* Hero hint */}
            {section.sectionType === 'hero' && (
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
                Click any element in the hero section to jump to that field.
              </p>
            )}

            <SectionFieldsPanel
              sectionId={section.id}
              sectionType={section.sectionType}
              content={content}
              selection={selection}
            />

            {/* Array item editing for sections that have lists */}
            {(() => {
              const arrCfg = ARRAY_CONFIGS[section.sectionType];
              if (!arrCfg) return null;
              const items = (content[arrCfg.arrayPath] as Record<string, unknown>[] | undefined) ?? [];
              return (
                <ArrayItemPanel
                  sectionId={section.id}
                  arrayPath={arrCfg.arrayPath}
                  title={arrCfg.title}
                  items={items}
                  fields={arrCfg.fields}
                  itemTemplate={arrCfg.template}
                  addLabel={arrCfg.addLabel}
                />
              );
            })()}

            {/* Image controls — shown for all sections that have an image */}
            {section.image && (
              <div style={{ marginTop: 20, padding: '12px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1.4, color: 'var(--color-text-muted)', marginBottom: 10, margin: '0 0 10px' }}>
                  Section Image
                </p>
                <label style={{ fontSize: 10, fontWeight: 400, color: 'var(--color-text-muted)', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1.4 }}>
                  Search query
                </label>
                <input
                  type="text"
                  placeholder="e.g. modern office collaboration"
                  value={typeof section.image.query === 'string' ? section.image.query : ''}
                  onChange={e => ctx.updateField(section.id, '__imageQuery', e.target.value)}
                  style={{ width: '100%', padding: '6px 9px', borderRadius: 5, border: '1px solid var(--color-border)', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }}
                />
                <label style={{ fontSize: 10, fontWeight: 400, color: 'var(--color-text-muted)', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1.4 }}>
                  Image URL (override)
                </label>
                <input
                  type="text"
                  placeholder="https://images.unsplash.com/..."
                  value={typeof section.image.url === 'string' ? section.image.url : ''}
                  onChange={e => ctx.updateField(section.id, '__imageUrl', e.target.value)}
                  style={{ width: '100%', padding: '6px 9px', borderRadius: 5, border: '1px solid var(--color-border)', fontSize: 12, boxSizing: 'border-box' }}
                />
                {section.image.url && (
                  <div style={{ marginTop: 8, borderRadius: 4, overflow: 'hidden', height: 60 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={section.image.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer note */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--color-border)', flexShrink: 0, background: 'var(--color-surface)' }}>
        <p style={{ fontSize: 10, color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
          Changes apply live in the preview. Export when satisfied.
        </p>
      </div>
    </div>
  );
}
