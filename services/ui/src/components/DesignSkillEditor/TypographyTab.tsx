'use client';

import { useEffect } from 'react';
import type { DesignSkillApi } from '@/lib/api';

const HEADING_FONTS = [
  'Bebas Neue', 'Syne', 'Raleway', 'Montserrat', 'Poppins',
  'DM Serif Display', 'Playfair Display', 'Space Mono',
  'Barlow Condensed', 'Oswald', 'Cormorant Garamond', 'Abril Fatface', 'Bree Serif',
];

const BODY_FONTS = [
  'DM Sans', 'Inter', 'Lato', 'Open Sans', 'Source Sans 3',
  'Nunito', 'Work Sans', 'IBM Plex Sans', 'Karla', 'Jost',
];

const GOOGLE_FONTS_URL = `https://fonts.googleapis.com/css2?${
  [...HEADING_FONTS, ...BODY_FONTS]
    .map((f) => `family=${encodeURIComponent(f)}:wght@400;700`)
    .join('&')
}&display=swap`;

const HEADING_STYLES = ['bold', 'playful', 'editorial', 'minimal', 'strong'] as const;

interface Props {
  draft: Partial<DesignSkillApi>;
  onChange: (updates: Partial<DesignSkillApi>) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function FontPicker({
  fonts,
  value,
  onChange,
  sampleText,
}: {
  fonts: string[];
  value: string;
  onChange: (v: string) => void;
  sampleText: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {fonts.map((f) => (
        <button
          key={f}
          onClick={() => onChange(f)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 12px',
            border: '2px solid',
            borderColor: value === f ? 'var(--primary)' : 'var(--border)',
            borderRadius: 6,
            background: value === f ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : 'transparent',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.1s',
          }}
        >
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text)', minWidth: 160, opacity: 0.6 }}>{f}</span>
          <span style={{ fontSize: 15, color: 'var(--text)', fontFamily: `'${f}', sans-serif` }}>{sampleText}</span>
        </button>
      ))}
    </div>
  );
}

type Typography = { headingFont: string; bodyFont: string; headingStyle: typeof HEADING_STYLES[number] };

export function TypographyTab({ draft, onChange }: Props) {
  const typo: Partial<Typography> = draft.typography ?? {};

  useEffect(() => {
    if (document.querySelector(`link[data-typography-fonts]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = GOOGLE_FONTS_URL;
    link.dataset.typographyFonts = '1';
    document.head.appendChild(link);
  }, []);

  const updateTypo = (key: keyof Typography, value: string) => {
    onChange({
      typography: {
        headingFont: typo.headingFont ?? 'Syne',
        bodyFont: typo.bodyFont ?? 'DM Sans',
        headingStyle: typo.headingStyle ?? 'bold',
        [key]: value,
      },
    });
  };

  return (
    <div>
      <Field label="Heading Font">
        <FontPicker
          fonts={HEADING_FONTS}
          value={typo.headingFont ?? ''}
          onChange={(v) => updateTypo('headingFont', v)}
          sampleText="The Quick Brown Fox"
        />
      </Field>

      <Field label="Body Font">
        <FontPicker
          fonts={BODY_FONTS}
          value={typo.bodyFont ?? ''}
          onChange={(v) => updateTypo('bodyFont', v)}
          sampleText="Paragraph text at a comfortable size."
        />
      </Field>

      <Field label="Heading Style">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {HEADING_STYLES.map((s) => (
            <button
              key={s}
              onClick={() => updateTypo('headingStyle', s)}
              style={{
                padding: '6px 16px',
                border: '2px solid',
                borderColor: typo.headingStyle === s ? 'var(--primary)' : 'var(--border)',
                borderRadius: 20,
                background: typo.headingStyle === s ? 'var(--primary)' : 'transparent',
                color: typo.headingStyle === s ? '#fff' : 'var(--text)',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: typo.headingStyle === s ? 600 : 400,
                textTransform: 'capitalize',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}
