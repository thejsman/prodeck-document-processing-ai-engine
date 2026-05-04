'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import type { PendingExtraction, RequirementKey, RequirementField } from '@/lib/api';
import { FIELD_LABELS } from './BriefField';

interface Props {
  extraction: PendingExtraction;
  apiKey: string;
  namespace: string;
  onConfirm: (
    fields: Partial<Record<RequirementKey, { value: unknown; confidence: number; source: 'user' | 'document' | 'inferred' }>>,
    documentId: string,
  ) => Promise<void>;
  onDismiss: (documentId: string) => void;
}

function stateIcon(field: RequirementField) {
  if ((field.confidence ?? 0) >= 0.8 && !field.pendingConfirmation) {
    return <span style={{ color: 'var(--success, #22c55e)' }}>●</span>;
  }
  return <span style={{ color: 'var(--warning, #f59e0b)' }}>◐</span>;
}

export function ExtractionConfirmationCard({ extraction, onConfirm, onDismiss }: Props) {
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState<Partial<Record<RequirementKey, string>>>({});
  const [confirming, setConfirming] = useState(false);

  const fieldEntries = Object.entries(extraction.fields) as [RequirementKey, RequirementField][];

  // Initialize edit state from extraction fields
  function startEdit() {
    const init: Partial<Record<RequirementKey, string>> = {};
    for (const [k, f] of fieldEntries) {
      init[k] = Array.isArray(f.value) ? (f.value as unknown[]).join(', ') : String(f.value ?? '');
    }
    setEditFields(init);
    setEditing(true);
  }

  async function handleConfirmAll() {
    setConfirming(true);
    try {
      const confirmed: Partial<Record<RequirementKey, { value: unknown; confidence: number; source: 'user' | 'document' | 'inferred' }>> = {};
      for (const [k, f] of fieldEntries) {
        confirmed[k] = {
          value: editing ? editFields[k] ?? f.value : f.value,
          confidence: 1.0,
          source: 'user',
        };
      }
      await onConfirm(confirmed, extraction.documentId);
    } finally {
      setConfirming(false);
    }
  }

  const card: React.CSSProperties = {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
    maxWidth: 480,
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 14px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--panel-soft)',
  };

  return (
    <div style={card}>
      <div style={headerStyle}>
        <Icon icon={FileText} size="sm" style={{ color: 'var(--primary)', flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          I read <strong>{extraction.documentId}</strong> — here's what I extracted:
        </span>
      </div>
      <div style={{ padding: '10px 14px' }}>
        {fieldEntries.map(([key, field]) => (
          <div key={key} style={{ display: 'grid', gridTemplateColumns: '16px 130px 1fr', gap: 6, padding: '4px 0', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
            <span style={{ paddingTop: 2 }}>{stateIcon(field)}</span>
            <span style={{ color: 'var(--muted)' }}>{FIELD_LABELS[key] ?? key}</span>
            {editing ? (
              <input
                type="text"
                value={editFields[key] ?? ''}
                onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: e.target.value }))}
                style={{
                  fontSize: 13, padding: '2px 6px', border: '1px solid var(--primary)',
                  borderRadius: 4, background: 'var(--panel)', color: 'var(--text)',
                }}
              />
            ) : (
              <div>
                <span style={{ color: 'var(--text)' }}>
                  {Array.isArray(field.value) ? (field.value as unknown[]).join(', ') : String(field.value ?? '')}
                </span>
                {field.confidence !== undefined && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>
                    ({(field.confidence * 100).toFixed(0)}%)
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
        <button
          className="btn btn-sm btn-primary"
          onClick={handleConfirmAll}
          disabled={confirming}
          style={{ height: 30, padding: '0 12px', fontSize: 12 }}
        >
          {confirming ? 'Confirming…' : 'Confirm all'}
        </button>
        {!editing && (
          <button
            className="btn btn-sm"
            onClick={startEdit}
            style={{ height: 30, padding: '0 12px', fontSize: 12 }}
          >
            Edit before confirming
          </button>
        )}
        {editing && (
          <button
            className="btn btn-sm"
            onClick={() => setEditing(false)}
            style={{ height: 30, padding: '0 12px', fontSize: 12 }}
          >
            Cancel edit
          </button>
        )}
        <button
          className="btn btn-sm"
          onClick={() => onDismiss(extraction.documentId)}
          style={{ height: 30, padding: '0 12px', fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
