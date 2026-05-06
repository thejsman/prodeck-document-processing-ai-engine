'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { ClassificationPicker } from './ClassificationPicker';
import type { DocumentClassification } from '@/lib/api';

interface Props {
  fileName: string;
  currentClassification: DocumentClassification;
  onConfirm: (newClassification: DocumentClassification) => Promise<void>;
  onCancel: () => void;
}

export function ReclassificationPicker({ fileName, currentClassification, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState<DocumentClassification>(currentClassification);
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm() {
    if (selected === currentClassification) {
      onCancel();
      return;
    }
    setConfirming(true);
    try {
      await onConfirm(selected);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div style={{
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden',
      maxWidth: 460,
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
        Reclassify <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{fileName}</strong>
      </div>

      {/* Picker */}
      <div style={{ padding: '12px 14px' }}>
        <ClassificationPicker value={selected} onChange={setSelected} />
      </div>

      {/* Warning */}
      {selected !== currentClassification && (
        <div style={{
          margin: '0 14px 10px',
          padding: '8px 10px',
          background: 'var(--warning-dim, #fef9c3)',
          borderRadius: 6,
          fontSize: 12,
          color: 'var(--warning-text, #92400e)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
        }}>
          <Icon icon={AlertTriangle} size="xs" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Changing classification will discard extracted fields and re-run extraction with the new rules.
          </span>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
        <button
          className="btn btn-sm btn-primary"
          style={{ height: 28, padding: '0 12px', fontSize: 12 }}
          onClick={handleConfirm}
          disabled={confirming}
        >
          {confirming ? 'Reclassifying…' : 'Confirm reclassification'}
        </button>
        <button
          className="btn btn-sm"
          style={{ height: 28, padding: '0 12px', fontSize: 12 }}
          onClick={onCancel}
          disabled={confirming}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
