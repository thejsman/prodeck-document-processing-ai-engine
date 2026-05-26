'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', busy = false, onConfirm, onCancel }: Props) {
  const [loading, setLoading] = useState(false);
  const running = busy || loading;

  const handle = async () => {
    setLoading(true);
    try { await onConfirm(); } finally { setLoading(false); }
  };

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onMouseDown={e => { if (e.target === e.currentTarget && !running) onCancel(); }}
    >
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 380, boxShadow: '0 20px 60px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 20px 16px' }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{title}</p>
        </div>
        <div style={{ height: 1, background: 'var(--border)' }} />
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.5 }}>{message}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={onCancel}
              disabled={running}
              style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontSize: 13, cursor: running ? 'not-allowed' : 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={handle}
              disabled={running}
              style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: 'var(--danger, #ef4444)', color: '#fff', fontSize: 13, cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.7 : 1 }}
            >
              {running ? 'Deleting…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
