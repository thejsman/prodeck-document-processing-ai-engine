'use client';

import { useState } from 'react';
import type { DesignSkillApi } from '@/lib/api';
import { OverviewTab } from './OverviewTab';
import { StyleTab } from './StyleTab';
import { ColorsTab } from './ColorsTab';
import { TypographyTab } from './TypographyTab';
import { InstructionsTab } from './InstructionsTab';

type DSTabKey = 'overview' | 'style' | 'colors' | 'typography' | 'instructions';

const TABS: { key: DSTabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'style', label: 'Style' },
  { key: 'colors', label: 'Colors' },
  { key: 'typography', label: 'Typography' },
  { key: 'instructions', label: 'Instructions' },
];

interface Props {
  draft: Partial<DesignSkillApi>;
  onChange: (updates: Partial<DesignSkillApi>) => void;
  onSave: () => void;
  onDelete?: () => void;
  saving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  isNew: boolean;
}

export function DesignSkillEditor({ draft, onChange, onSave, onDelete, saving, saveError, saveSuccess, isNew }: Props) {
  const [activeTab, setActiveTab] = useState<DSTabKey>('overview');

  return (
    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div style={{
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 2,
        flexShrink: 0,
        minHeight: 44,
      }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '8px 14px',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: activeTab === t.key ? 600 : 400,
              background: activeTab === t.key ? 'var(--primary)' : 'transparent',
              color: activeTab === t.key ? '#fff' : 'var(--text2)',
              transition: 'all 0.1s',
            }}
          >
            {t.label}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {saveError && (
          <span style={{ fontSize: 12, color: 'var(--error, #ef4444)', marginRight: 8 }}>{saveError}</span>
        )}
        {saveSuccess && (
          <span style={{ fontSize: 12, color: '#22c55e', marginRight: 8 }}>Saved</span>
        )}
        {onDelete && !isNew && (
          <button
            onClick={onDelete}
            style={{
              padding: '6px 12px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--text2)',
              fontSize: 12,
              cursor: 'pointer',
              marginRight: 6,
            }}
          >
            Delete
          </button>
        )}
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            padding: '6px 16px',
            border: 'none',
            borderRadius: 6,
            background: 'var(--primary)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 500,
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {activeTab === 'overview' && (
          <OverviewTab draft={draft} onChange={onChange} />
        )}
        {activeTab === 'style' && (
          <StyleTab draft={draft} onChange={onChange} />
        )}
        {activeTab === 'colors' && (
          <ColorsTab draft={draft} onChange={onChange} />
        )}
        {activeTab === 'typography' && (
          <TypographyTab draft={draft} onChange={onChange} />
        )}
        {activeTab === 'instructions' && (
          <InstructionsTab draft={draft} onChange={onChange} />
        )}
      </div>
    </div>
  );
}
