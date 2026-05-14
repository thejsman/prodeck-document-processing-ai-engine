'use client';

import type { DesignSkillApi, AestheticToneApi } from '@/lib/api';

const TONES: { tone: AestheticToneApi; emoji: string; desc: string }[] = [
  { tone: 'brutally minimal', emoji: '◻', desc: 'Extreme whitespace, one accent, no decoration' },
  { tone: 'editorial/magazine', emoji: '📰', desc: 'Typography-first, editorial rhythm, high contrast' },
  { tone: 'luxury/refined', emoji: '✦', desc: 'Gold accents, refined spacing, premium feel' },
  { tone: 'retro-futuristic', emoji: '⚡', desc: 'Neon glows, dark tech, sci-fi grid lines' },
  { tone: 'art deco/geometric', emoji: '◆', desc: 'Angular patterns, jewel tones, symmetry' },
  { tone: 'organic/natural', emoji: '🌿', desc: 'Earth tones, rounded edges, nature-inspired' },
  { tone: 'soft/pastel', emoji: '🌸', desc: 'Muted pastels, gentle shadows, airy layouts' },
  { tone: 'playful/toy-like', emoji: '🎨', desc: 'Bold primaries, chunky type, expressive shapes' },
  { tone: 'brutalist/raw', emoji: '🧱', desc: 'Exposed structure, stark contrast, raw edges' },
  { tone: 'maximalist chaos', emoji: '🌀', desc: 'Dense layers, bold textures, no restraint' },
  { tone: 'industrial/utilitarian', emoji: '🔩', desc: 'Monochrome, grid-heavy, function over form' },
];

const ANIMATIONS = ['none', 'minimal', 'smooth', 'playful', 'bounce'] as const;

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

export function StyleTab({ draft, onChange }: Props) {
  return (
    <div>
      <Field label="Aesthetic Tone">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {TONES.map(({ tone, emoji, desc }) => (
            <button
              key={tone}
              onClick={() => onChange({ aestheticTone: tone })}
              style={{
                padding: '10px 12px',
                border: '2px solid',
                borderColor: draft.aestheticTone === tone ? 'var(--primary)' : 'var(--border)',
                borderRadius: 8,
                background: draft.aestheticTone === tone ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'var(--surface)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.12s',
              }}
            >
              <div style={{ fontSize: 18, marginBottom: 4 }}>{emoji}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2, textTransform: 'capitalize' }}>{tone}</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.4 }}>{desc}</div>
            </button>
          ))}
        </div>
      </Field>

      <Field label="Animations">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {ANIMATIONS.map((a) => (
            <button
              key={a}
              onClick={() => onChange({ animations: a })}
              style={{
                padding: '6px 16px',
                border: '2px solid',
                borderColor: draft.animations === a ? 'var(--primary)' : 'var(--border)',
                borderRadius: 20,
                background: draft.animations === a ? 'var(--primary)' : 'transparent',
                color: draft.animations === a ? '#fff' : 'var(--text)',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: draft.animations === a ? 600 : 400,
                textTransform: 'capitalize',
                transition: 'all 0.12s',
              }}
            >
              {a}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}
