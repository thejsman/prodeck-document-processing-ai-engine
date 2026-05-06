'use client';

import type { RequirementKey, ConflictRecord } from '@/lib/api';
import { FIELD_LABELS } from './BriefField';

interface Props {
  fieldKey: RequirementKey;
  value: unknown;
  confidence: number;
  conflict?: ConflictRecord;
  isEditing?: boolean;
  editValue?: string;
  onEditChange?: (key: RequirementKey, value: string) => void;
  onFill?: (key: RequirementKey) => void;
  onResolve?: (key: RequirementKey) => void;
}

function Indicator({ confidence, hasConflict, notFound }: { confidence: number; hasConflict?: boolean; notFound?: boolean }) {
  if (hasConflict) return <span style={{ color: 'var(--danger, #ef4444)', fontSize: 13 }}>⚠</span>;
  if (notFound) return <span style={{ color: 'var(--muted)', fontSize: 13 }}>○</span>;
  if (confidence >= 0.8) return <span style={{ color: 'var(--success, #22c55e)', fontSize: 13 }}>●</span>;
  if (confidence >= 0.5) return <span style={{ color: 'var(--warning, #f59e0b)', fontSize: 13 }}>◐</span>;
  return <span style={{ color: 'var(--danger, #ef4444)', fontSize: 13 }}>◌</span>;
}

export function ExtractionFieldRow({
  fieldKey,
  value,
  confidence,
  conflict,
  isEditing,
  editValue,
  onEditChange,
  onFill,
  onResolve,
}: Props) {
  const notFound = value === null || value === undefined;
  const valueStr = notFound ? '' : (Array.isArray(value) ? (value as unknown[]).join(', ') : String(value));
  const label = FIELD_LABELS[fieldKey] ?? fieldKey;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '16px 130px 1fr auto',
        gap: 6,
        padding: '5px 0',
        fontSize: 13,
        borderBottom: '1px solid var(--border)',
        alignItems: 'start',
      }}
    >
      {/* Indicator */}
      <span style={{ paddingTop: 1 }}>
        <Indicator confidence={confidence} hasConflict={!!conflict} notFound={notFound} />
      </span>

      {/* Label */}
      <span style={{ color: 'var(--muted)' }}>{label}</span>

      {/* Value or input */}
      {isEditing && onEditChange ? (
        <input
          type="text"
          value={editValue ?? ''}
          onChange={(e) => onEditChange(fieldKey, e.target.value)}
          style={{
            fontSize: 13,
            padding: '2px 6px',
            border: '1px solid var(--primary)',
            borderRadius: 4,
            background: 'var(--panel)',
            color: 'var(--text)',
          }}
        />
      ) : notFound ? (
        <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>not found</span>
      ) : conflict ? (
        <div>
          <span style={{ color: 'var(--warning, #f59e0b)' }}>{valueStr}</span>
          <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>
            ← was {String(conflict.existingValue ?? '')}
            {conflict.existingSourceFile ? ` (from ${conflict.existingSourceFile})` : ''}
          </span>
        </div>
      ) : (
        <div>
          <span style={{ color: 'var(--text)' }}>{valueStr}</span>
          {confidence < 1 && (
            <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>
              {(confidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
      )}

      {/* Action button */}
      <span>
        {notFound && onFill && !isEditing && (
          <button
            className="btn btn-sm"
            style={{ height: 22, padding: '0 8px', fontSize: 11 }}
            onClick={() => onFill(fieldKey)}
          >
            Fill
          </button>
        )}
        {conflict && onResolve && !isEditing && (
          <button
            className="btn btn-sm"
            style={{ height: 22, padding: '0 8px', fontSize: 11, color: 'var(--danger, #ef4444)', borderColor: 'var(--danger, #ef4444)' }}
            onClick={() => onResolve(fieldKey)}
          >
            Resolve
          </button>
        )}
      </span>
    </div>
  );
}
