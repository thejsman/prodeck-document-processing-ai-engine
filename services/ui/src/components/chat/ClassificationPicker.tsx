'use client';

import type { DocumentClassification } from '@/lib/api';

interface Option {
  value: DocumentClassification;
  label: string;
  description: string;
}

const OPTIONS: Option[] = [
  {
    value: 'client_source',
    label: 'Client Source',
    description: 'RFP, brief, requirements — facts about the client and this engagement',
  },
  {
    value: 'conversation',
    label: 'Conversation',
    description: 'Meeting transcript, call notes, email',
  },
  {
    value: 'provider_asset',
    label: 'Provider Asset',
    description: 'Our case studies, bios, pricing sheets — never contaminates client context',
  },
  {
    value: 'reference_example',
    label: 'Reference Example',
    description: 'A proposal we liked — style only, no facts extracted',
  },
  {
    value: 'background',
    label: 'Background',
    description: 'Industry reports, ambient context — low weight facts only',
  },
];

interface Props {
  value: DocumentClassification | null;
  onChange: (value: DocumentClassification) => void;
}

export function ClassificationPicker({ value, onChange }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>
        What role does this document play?
      </div>
      {OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <label
            key={opt.value}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
              background: selected ? 'var(--primary-dim)' : 'var(--panel)',
              cursor: 'pointer',
              transition: 'border-color 0.12s, background 0.12s',
            }}
          >
            <input
              type="radio"
              name="classification"
              value={opt.value}
              checked={selected}
              onChange={() => onChange(opt.value)}
              style={{ marginTop: 2, flexShrink: 0, accentColor: 'var(--primary)' }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', lineHeight: 1.3 }}>
                {opt.label}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.4 }}>
                {opt.description}
              </div>
            </div>
          </label>
        );
      })}
    </div>
  );
}
