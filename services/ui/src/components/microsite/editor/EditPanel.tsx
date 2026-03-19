'use client';

import { useEditContext } from './EditContext';
import type { LayoutAST, SectionType } from '../../../types/presentation';

// ── Type label map ─────────────────────────────────────────────────────────

const SECTION_LABELS: Partial<Record<SectionType, string>> = {
  hero: 'Hero',
  challenge: 'Challenge',
  approach: 'Approach',
  deliverables: 'Deliverables',
  timeline: 'Timeline',
  pricing: 'Pricing',
  whyus: 'Why Us',
  nextsteps: 'Next Steps',
  testimonials: 'Testimonials',
  showcase: 'Showcase',
  benefits: 'Benefits',
  problem: 'Problem',
  stats: 'Stats',
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
  challenge: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('body', 'Body'),
    TEXT('pullquote', 'Pull Quote'),
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
  whyus: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('body', 'Body'),
  ],
  nextsteps: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('body', 'Body'),
    BTN('ctaPrimary', 'Primary CTA'),
    BTN('ctaSecondary', 'Secondary CTA'),
    SHORT('urgencyNote', 'Urgency Note'),
  ],
  timeline: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
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
  ],
  problem: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('body', 'Body'),
  ],
  stats: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
  ],
  testimonials: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
  ],
  pricing: [
    SHORT('eyebrow', 'Eyebrow'),
    TEXT('headline', 'Headline'),
    TEXT('subheadline', 'Subheadline'),
    SHORT('cta', 'CTA Text'),
    TEXT('footnote', 'Footnote'),
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
  const borderColor = isSelected ? '#6366f1' : 'var(--color-border, #e2e8f0)';
  const bg = isSelected ? '#f5f3ff' : 'var(--color-surface, #fff)';

  const baseStyle: React.CSSProperties = {
    width: '100%',
    padding: '7px 10px',
    borderRadius: 6,
    border: `1px solid ${borderColor}`,
    background: bg,
    color: 'var(--color-text, #111)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
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
              fontWeight: 600,
              color: isSelected ? '#6366f1' : 'var(--color-text-muted, #666)',
              marginBottom: 4,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}>
              {isSelected && (
                <span style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#6366f1',
                  flexShrink: 0,
                }} />
              )}
              {def.label}
              {def.type === 'button' && (
                <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--color-text-muted, #999)', marginLeft: 'auto', textTransform: 'none' }}>
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

// ── Approach pillars panel ─────────────────────────────────────────────────

interface Pillar { iconHint: string; name: string; description: string; }

function ApproachPillarsPanel({ sectionId, pillars }: { sectionId: string; pillars: Pillar[] }) {
  const ctx = useEditContext()!;
  if (!pillars?.length) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 10, fontFamily: 'system-ui' }}>
        Pillars
      </p>
      {pillars.map((p, i) => (
        <div key={i} style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          <p style={{ fontSize: 11, fontWeight: 600, margin: '0 0 6px', color: 'var(--color-text-muted)', fontFamily: 'system-ui' }}>
            Pillar {i + 1}
          </p>
          <input
            type="text"
            placeholder="Name"
            value={p.name}
            onChange={e => ctx.updateField(sectionId, `pillars.${i}.name`, e.target.value)}
            style={{ width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid var(--color-border)', fontSize: 12, marginBottom: 6, boxSizing: 'border-box' }}
          />
          <textarea
            placeholder="Description"
            value={p.description}
            onChange={e => ctx.updateField(sectionId, `pillars.${i}.description`, e.target.value)}
            rows={2}
            style={{ width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid var(--color-border)', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>
      ))}
    </div>
  );
}

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
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Panel header */}
      <div style={{
        padding: '14px 16px 12px',
        borderBottom: '1px solid var(--color-border, #e2e8f0)',
        flexShrink: 0,
      }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6366f1' }}>
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
        <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>
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
            <p style={{ fontSize: 28, margin: '0 0 8px' }}>✏️</p>
            <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Select a section to edit</p>
            <p style={{ fontSize: 12, margin: '6px 0 0', lineHeight: 1.5 }}>
              Use the dropdown above, or click any highlighted element on the canvas
            </p>
          </div>
        )}

        {section && content && (
          <>
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

            {/* Approach pillars */}
            {section.sectionType === 'approach' && Array.isArray(content.pillars) && (
              <ApproachPillarsPanel
                sectionId={section.id}
                pillars={content.pillars as Pillar[]}
              />
            )}

            {/* Image URL for hero */}
            {section.sectionType === 'hero' && (
              <div style={{ marginTop: 20 }}>
                <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>
                  Hero Background Image URL
                </label>
                <input
                  type="text"
                  placeholder="https://images.unsplash.com/..."
                  value={typeof section.image.url === 'string' ? section.image.url : ''}
                  onChange={e => {
                    // Update image url — this is on the section not content, so handled differently
                    ctx.updateField(section.id, '__imageUrl', e.target.value);
                  }}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 12, boxSizing: 'border-box' }}
                />
                <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Paste any image URL to use as the hero background
                </p>
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
