'use client';

import { useState, useRef, useEffect } from 'react';
import type { RequirementField, RequirementKey } from '@/lib/api';

const MULTILINE_FIELDS: RequirementKey[] = [
  'keyObjectives', 'constraints', 'deliverables', 'technicalStack', 'stakeholders',
];

export const FIELD_LABELS: Record<RequirementKey, string> = {
  clientName: 'Client Name',
  clientIndustry: 'Client Industry',
  projectType: 'Project Type',
  budget: 'Budget',
  timeline: 'Timeline',
  keyObjectives: 'Key Objectives',
  contactName: 'Contact Name',
  technicalStack: 'Technical Stack',
  constraints: 'Constraints',
  deliverables: 'Deliverables',
  teamSize: 'Team Size',
  stakeholders: 'Stakeholders',
};

interface Props {
  fieldKey: RequirementKey;
  field: RequirementField | undefined;
  onEdit: (key: RequirementKey, value: unknown) => Promise<void>;
  onAsk: (question: string) => void;
  onConfirm: (key: RequirementKey, field: RequirementField) => Promise<void>;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

export function BriefField({ fieldKey, field, onEdit, onAsk, onConfirm }: Props) {
  const label = FIELD_LABELS[fieldKey];
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const isEmpty = !field?.value && field?.value !== 0;
  const isHighConfidence = !isEmpty && (field?.confidence ?? 0) >= 0.8 && !field?.pendingConfirmation;
  const isLowOrPending = !isEmpty && ((field?.confidence ?? 1) < 0.8 || field?.pendingConfirmation);

  function startEdit() {
    setEditValue(displayValue(field?.value));
    setEditing(true);
  }

  async function saveEdit() {
    if (saving) return;
    setSaving(true);
    try {
      await onEdit(fieldKey, editValue);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setEditing(false);
    setEditValue('');
  }

  async function handleConfirm() {
    if (!field) return;
    setSaving(true);
    try {
      await onConfirm(fieldKey, field);
    } finally {
      setSaving(false);
    }
  }

  // Indicator icon
  const indicator = isEmpty
    ? <span style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1 }}>○</span>
    : isHighConfidence
    ? <span style={{ color: 'var(--success, #22c55e)', fontSize: 14, lineHeight: 1 }}>●</span>
    : <span style={{ color: 'var(--warning, #f59e0b)', fontSize: 14, lineHeight: 1 }}>◐</span>;

  const row: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '16px 130px 1fr auto',
    alignItems: 'start',
    gap: 8,
    padding: '5px 0',
    fontSize: 13,
    borderBottom: '1px solid var(--border)',
  };

  if (editing) {
    const multiline = MULTILINE_FIELDS.includes(fieldKey);
    return (
      <div style={row}>
        <span>{indicator}</span>
        <span style={{ color: 'var(--muted)', paddingTop: 2 }}>{label}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
              rows={3}
              style={{
                width: '100%', fontSize: 13, padding: '4px 8px',
                border: '1px solid var(--primary)', borderRadius: 6,
                background: 'var(--panel)', color: 'var(--text)', resize: 'vertical',
              }}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit();
                if (e.key === 'Escape') cancelEdit();
              }}
              style={{
                width: '100%', fontSize: 13, padding: '4px 8px',
                border: '1px solid var(--primary)', borderRadius: 6,
                background: 'var(--panel)', color: 'var(--text)',
              }}
            />
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={saveEdit}
              disabled={saving}
              className="btn btn-sm btn-primary"
              style={{ height: 26, padding: '0 10px', fontSize: 12 }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={cancelEdit}
              className="btn btn-sm"
              style={{ height: 26, padding: '0 10px', fontSize: 12 }}
            >
              Cancel
            </button>
          </div>
        </div>
        <span />
      </div>
    );
  }

  return (
    <div style={row}>
      <span style={{ paddingTop: 2 }}>{indicator}</span>
      <span style={{ color: 'var(--muted)', paddingTop: 2 }}>{label}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        {isEmpty ? (
          <span style={{ color: 'var(--muted)' }}>—</span>
        ) : (
          <>
            <span style={{ color: 'var(--text)', wordBreak: 'break-word' }}>
              {displayValue(field?.value)}
            </span>
            {field?.sourceFile && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {field.source === 'user' ? '✏ user' : `📄 ${field.sourceFile}`}
                {isLowOrPending && field?.confidence !== undefined && (
                  <span style={{ marginLeft: 4 }}>({(field.confidence * 100).toFixed(0)}%)</span>
                )}
              </span>
            )}
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0, paddingTop: 1 }}>
        {isEmpty && (
          <button
            onClick={() => onAsk(`What is the ${label.toLowerCase()} for this engagement?`)}
            className="btn btn-sm"
            style={{ height: 24, padding: '0 8px', fontSize: 11, color: 'var(--primary)' }}
          >
            Ask
          </button>
        )}
        {!isEmpty && isLowOrPending && (
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="btn btn-sm btn-primary"
            style={{ height: 24, padding: '0 8px', fontSize: 11 }}
          >
            {saving ? '…' : 'Confirm'}
          </button>
        )}
        {!isEmpty && (
          <button
            onClick={startEdit}
            className="btn btn-sm"
            style={{ height: 24, padding: '0 8px', fontSize: 11 }}
          >
            Edit
          </button>
        )}
      </div>
    </div>
  );
}
