'use client';

import type { DesignSkillApi } from '@/lib/api';

interface Props {
  draft: Partial<DesignSkillApi>;
  onChange: (updates: Partial<DesignSkillApi>) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 13,
  boxSizing: 'border-box',
};

export function OverviewTab({ draft, onChange }: Props) {
  return (
    <div>
      <Field label="Display Name">
        <input
          style={inputStyle}
          value={draft.displayName ?? ''}
          onChange={(e) => onChange({ displayName: e.target.value })}
          placeholder="e.g. Dark Futuristic"
        />
      </Field>

      <Field label="Slug">
        <input
          style={{ ...inputStyle, fontFamily: 'monospace', color: 'var(--text2)' }}
          value={draft.slug ?? ''}
          onChange={(e) => onChange({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
          placeholder="e.g. dark-futuristic"
        />
      </Field>

      <Field label="Description">
        <textarea
          style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }}
          value={draft.description ?? ''}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Brief description of this design style…"
        />
      </Field>

      <Field label="Theme Class">
        <div style={{ display: 'flex', gap: 8 }}>
          {(['dark', 'light', 'colorful'] as const).map((tc) => (
            <button
              key={tc}
              onClick={() => onChange({ themeClass: tc })}
              style={{
                padding: '6px 16px',
                border: '2px solid',
                borderColor: draft.themeClass === tc ? 'var(--primary)' : 'var(--border)',
                borderRadius: 6,
                background: tc === 'dark' ? '#111' : tc === 'colorful' ? 'linear-gradient(90deg,#f59e0b,#ec4899)' : '#f8f8f8',
                color: tc === 'dark' ? '#fff' : '#111',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: draft.themeClass === tc ? 700 : 400,
                textTransform: 'capitalize',
              }}
            >
              {tc}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}
