'use client';

import type { DesignSkillApi } from '@/lib/api';

interface Props {
  draft: Partial<DesignSkillApi>;
  onChange: (updates: Partial<DesignSkillApi>) => void;
}

export function InstructionsTab({ draft, onChange }: Props) {
  return (
    <div>
      <label style={{
        display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)',
        marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        Custom Design Instructions
      </label>
      <p style={{ fontSize: 12, color: 'var(--text2)', margin: '0 0 10px', lineHeight: 1.5 }}>
        Free-form instructions injected directly into the CSS token generation prompt.
        Use this to describe specific layout preferences, brand rules, forbidden patterns, or anything
        not captured by the tone/color/typography settings above.
      </p>
      <textarea
        value={draft.customInstructions ?? ''}
        onChange={(e) => onChange({ customInstructions: e.target.value })}
        placeholder={`Examples:\n- Use bold uppercase headings with extreme letter-spacing\n- Hero section must have a dark overlay over the background image\n- No rounded corners anywhere — all cards must have sharp edges\n- Prioritise whitespace over density`}
        style={{
          width: '100%',
          minHeight: 240,
          padding: '10px 12px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--surface)',
          color: 'var(--text)',
          fontSize: 13,
          lineHeight: 1.6,
          resize: 'vertical',
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
      <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6 }}>
        These instructions supplement (not replace) the aesthetic tone and settings above.
      </p>
    </div>
  );
}
