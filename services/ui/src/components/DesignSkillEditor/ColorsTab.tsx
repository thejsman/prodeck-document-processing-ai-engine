'use client';

import type { DesignSkillApi } from '@/lib/api';

interface Props {
  draft: Partial<DesignSkillApi>;
  onChange: (updates: Partial<DesignSkillApi>) => void;
}

function ColorField({
  label,
  value,
  onChange,
  description,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  description: string;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </label>
      <p style={{ fontSize: 12, color: 'var(--text2)', margin: '0 0 8px' }}>{description}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: value || 'transparent',
          flexShrink: 0,
          overflow: 'hidden',
          position: 'relative',
        }}>
          <input
            type="color"
            value={value || '#3b82f6'}
            onChange={(e) => onChange(e.target.value)}
            style={{
              position: 'absolute', inset: '-4px',
              width: 'calc(100% + 8px)', height: 'calc(100% + 8px)',
              border: 'none', padding: 0, cursor: 'pointer', opacity: 0,
            }}
          />
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#3b82f6"
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: 13,
            fontFamily: 'monospace',
          }}
        />
      </div>
    </div>
  );
}

export function ColorsTab({ draft, onChange }: Props) {
  const palette: { primary?: string; secondary?: string; background?: string } = draft.colorPalette ?? {};

  const updatePalette = (key: 'primary' | 'secondary' | 'background', value: string) => {
    onChange({ colorPalette: { primary: palette.primary ?? '', ...palette, [key]: value || undefined } });
  };

  return (
    <div>
      <ColorField
        label="Primary Color"
        value={palette.primary ?? ''}
        onChange={(v) => updatePalette('primary', v)}
        description="Main accent color — used for CTAs, links, and highlights."
      />
      <ColorField
        label="Secondary Color"
        value={palette.secondary ?? ''}
        onChange={(v) => updatePalette('secondary', v)}
        description="Optional complementary accent. Leave empty to auto-derive."
      />
      <ColorField
        label="Background Color"
        value={palette.background ?? ''}
        onChange={(v) => updatePalette('background', v)}
        description="Optional page background override. Leave empty to let the tone decide."
      />

      {/* Live preview strip */}
      {(palette.primary || palette.secondary || palette.background) && (
        <div style={{ marginTop: 8 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Preview
          </label>
          <div style={{
            height: 48,
            borderRadius: 8,
            overflow: 'hidden',
            display: 'flex',
            border: '1px solid var(--border)',
          }}>
            {([palette.background, palette.primary, palette.secondary].filter((c): c is string => Boolean(c))).map((c, i) => (
              <div key={i} style={{ flex: 1, background: c, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 10, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.6)', fontFamily: 'monospace' }}>{c}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
