'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Sparkles } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/lib/auth-context';
import { createSuperClient } from '@/lib/api';

interface Props {
  onClose: () => void;
  onCreated: (name: string) => void;
}

export function CreateSuperClientModal({ onClose, onCreated }: Props) {
  const { apiKey } = useAuth();
  const router = useRouter();

  const [displayName, setDisplayName] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  async function handleCreate() {
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setError('Client name is required');
      return;
    }

    setCreating(true);
    setError('');

    const hasUrlOrNotes = url.trim() || notes.trim();
    if (hasUrlOrNotes) setAnalyzing(true);

    try {
      const result = await createSuperClient(
        apiKey,
        trimmedName,
        url.trim() || undefined,
        notes.trim() || undefined,
      );
      onCreated(result.name);
      onClose();
      router.push(`/super-client/${result.name}`);
    } catch (err) {
      setError((err as Error).message);
      setAnalyzing(false);
    } finally {
      setCreating(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--panel-soft)',
    color: 'var(--text)',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div
      className="create-ns-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="create-ns-modal"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          width: '100%',
          maxWidth: 480,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon icon={Sparkles} size="sm" style={{ color: 'var(--accent)' }} />
              <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>
                Super Client
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--muted)',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <Icon icon={X} size="md" />
            </button>
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--border)' }} />

        {/* Body */}
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Client name */}
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
              Client name <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>
            </label>
            <input
              autoFocus
              value={displayName}
              onChange={(e) => { setDisplayName(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="e.g. Acme Corporation"
              style={{ ...inputStyle, borderColor: error ? 'var(--danger)' : 'var(--border)' }}
            />
            {error && (
              <p style={{ fontSize: 12, color: 'var(--danger)', margin: '4px 0 0' }}>{error}</p>
            )}
          </div>

          {/* Website URL */}
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
              Website URL <span style={{ fontSize: 11, opacity: 0.6 }}>(optional)</span>
            </label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="https://acme.com"
              type="url"
              style={inputStyle}
            />
          </div>

          {/* More info */}
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
              More info <span style={{ fontSize: 11, opacity: 0.6 }}>(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Industry, target audience, brand tone, anything useful…"
              rows={3}
              style={{
                ...inputStyle,
                resize: 'vertical',
                fontFamily: 'inherit',
                lineHeight: 1.5,
              }}
            />
          </div>

          {(url.trim() || notes.trim()) && (
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '-8px 0 0', opacity: 0.7 }}>
              We will analyze this info to build client intelligence.
            </p>
          )}

          <button
            onClick={handleCreate}
            disabled={creating || !displayName.trim()}
            className="btn btn-primary"
          >
            {analyzing ? 'Analyzing client…' : creating ? 'Creating…' : 'Create Super Client'}
          </button>
        </div>
      </div>
    </div>
  );
}
