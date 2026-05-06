'use client';

import { useState } from 'react';
import type { ConflictRecord, RequirementKey } from '@/lib/api';
import { FIELD_LABELS } from './BriefField';

interface Props {
  conflicts: ConflictRecord[];
  onResolved: (resolutions: Record<RequirementKey, string>) => void;
  onCancel: () => void;
}

type Resolution = { type: 'incoming' | 'existing' | 'custom'; customValue?: string };

export function ConflictResolver({ conflicts, onResolved, onCancel }: Props) {
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>(() =>
    Object.fromEntries(conflicts.map((c) => [c.key, { type: 'incoming' }])),
  );

  const allResolved = conflicts.every((c) => {
    const r = resolutions[c.key];
    return r && (r.type !== 'custom' || (r.customValue ?? '').trim().length > 0);
  });

  function setResolution(key: string, resolution: Resolution) {
    setResolutions((prev) => ({ ...prev, [key]: resolution }));
  }

  function handleConfirm() {
    const result: Record<string, string> = {};
    for (const conflict of conflicts) {
      const r = resolutions[conflict.key];
      if (r.type === 'incoming') {
        result[conflict.key] = String(conflict.incomingValue ?? '');
      } else if (r.type === 'existing') {
        result[conflict.key] = String(conflict.existingValue ?? '');
      } else {
        result[conflict.key] = r.customValue ?? '';
      }
    }
    onResolved(result as Record<RequirementKey, string>);
  }

  return (
    <div style={{
      background: 'var(--panel)',
      border: '1px solid var(--danger, #ef4444)',
      borderRadius: 10,
      overflow: 'hidden',
      maxWidth: 520,
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--panel-soft)',
        fontSize: 13,
        fontWeight: 500,
        color: 'var(--text)',
      }}>
        Resolve {conflicts.length} conflict{conflicts.length !== 1 ? 's' : ''}
      </div>

      {/* Conflict items */}
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {conflicts.map((conflict) => {
          const label = FIELD_LABELS[conflict.key] ?? conflict.key;
          const r = resolutions[conflict.key] ?? { type: 'incoming' };
          return (
            <div key={conflict.key} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 6 }}>
                {label}
              </div>
              <RadioOption
                label={`Use new value: "${String(conflict.incomingValue ?? '')}"`}
                sublabel={`from ${conflict.incomingSourceFile}`}
                checked={r.type === 'incoming'}
                onChange={() => setResolution(conflict.key, { type: 'incoming' })}
              />
              <RadioOption
                label={`Keep existing: "${String(conflict.existingValue ?? '')}"`}
                sublabel={conflict.existingSourceFile ? `from ${conflict.existingSourceFile}` : 'previously confirmed'}
                checked={r.type === 'existing'}
                onChange={() => setResolution(conflict.key, { type: 'existing' })}
              />
              <RadioOption
                label="Enter custom value"
                checked={r.type === 'custom'}
                onChange={() => setResolution(conflict.key, { type: 'custom', customValue: '' })}
              />
              {r.type === 'custom' && (
                <input
                  type="text"
                  placeholder="Type a value…"
                  value={r.customValue ?? ''}
                  onChange={(e) => setResolution(conflict.key, { type: 'custom', customValue: e.target.value })}
                  style={{
                    marginTop: 4,
                    marginLeft: 20,
                    width: 'calc(100% - 20px)',
                    fontSize: 13,
                    padding: '4px 8px',
                    border: '1px solid var(--primary)',
                    borderRadius: 4,
                    background: 'var(--panel)',
                    color: 'var(--text)',
                    boxSizing: 'border-box',
                  }}
                  autoFocus
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
        <button
          className="btn btn-sm btn-primary"
          style={{ height: 28, padding: '0 12px', fontSize: 12 }}
          onClick={handleConfirm}
          disabled={!allResolved}
        >
          Apply resolutions
        </button>
        <button
          className="btn btn-sm"
          style={{ height: 28, padding: '0 12px', fontSize: 12 }}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function RadioOption({
  label,
  sublabel,
  checked,
  onChange,
}: {
  label: string;
  sublabel?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, cursor: 'pointer', padding: '3px 0' }}>
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        style={{ marginTop: 2, flexShrink: 0 }}
      />
      <span style={{ fontSize: 12, color: 'var(--text)' }}>
        {label}
        {sublabel && (
          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
            {sublabel}
          </span>
        )}
      </span>
    </label>
  );
}
