'use client';

import { useState } from 'react';

interface AIAssistBlockProps {
  placeholder: string;
  onApply: (instruction: string) => Promise<void>;
  loading?: boolean;
}

export function AIAssistBlock({ placeholder, onApply, loading }: AIAssistBlockProps) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApply = async () => {
    if (!instruction.trim() || busy || loading) return;
    setBusy(true);
    setError(null);
    try {
      await onApply(instruction.trim());
      setInstruction('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: 16,
      background: 'var(--panel-soft, var(--panel))',
      marginTop: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>AI Assist</span>
      </div>
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={placeholder}
        disabled={busy || loading}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleApply();
        }}
        style={{
          width: '100%',
          background: 'var(--input-bg, var(--bg))',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '8px 10px',
          color: 'var(--text)',
          fontSize: 13,
          resize: 'vertical',
          boxSizing: 'border-box',
          fontFamily: 'inherit',
          lineHeight: 1.5,
          outline: 'none',
        }}
      />
      {error && (
        <p style={{ color: 'var(--danger, #e53e3e)', fontSize: 12, marginTop: 4 }}>{error}</p>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button
          onClick={handleApply}
          disabled={busy || loading || !instruction.trim()}
          style={{
            background: 'var(--primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 500,
            cursor: busy || loading || !instruction.trim() ? 'not-allowed' : 'pointer',
            opacity: busy || loading || !instruction.trim() ? 0.6 : 1,
          }}
        >
          {busy ? 'Applying…' : 'Apply ▶'}
        </button>
      </div>
    </div>
  );
}
