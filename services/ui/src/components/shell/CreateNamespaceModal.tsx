'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/lib/auth-context';
import { useNamespace } from '@/lib/namespace-context';
import { createNamespace } from '@/lib/api';

interface Props {
  onClose: () => void;
}

export function CreateNamespaceModal({ onClose }: Props) {
  const { apiKey } = useAuth();
  const { setNamespace, addNamespace } = useNamespace();
  const router = useRouter();

  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [nameError, setNameError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  async function handleCreate() {
    if (!name.trim()) {
      setNameError('Name is required');
      return;
    }
    setCreating(true);
    setNameError('');
    try {
      const ns = await createNamespace(apiKey, name.trim(), clientName.trim() || undefined);
      addNamespace(ns);
      setNamespace(ns);
      onClose();
      router.push('/chat');
    } catch (err) {
      setNameError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

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
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
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
            <p
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--text)',
                margin: 0,
                lineHeight: 1.5,
                letterSpacing: '0em',
              }}
            >
              Create Client
            </p>
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
        <div style={{ padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>Namespace</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
              placeholder="e.g. acme-corp"
              style={{
                width: '100%',
                padding: '8px 10px',
                border: `1px solid ${nameError ? 'var(--danger)' : 'var(--border)'}`,
                borderRadius: 6,
                background: 'var(--panel-soft)',
                color: 'var(--text)',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {nameError && <p style={{ fontSize: 12, color: 'var(--danger)', margin: '4px 0 0' }}>{nameError}</p>}
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
              Client name <span style={{ opacity: 0.5 }}>(optional)</span>
            </label>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
              placeholder="e.g. Acme Corporation"
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--panel-soft)',
                color: 'var(--text)',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <button onClick={handleCreate} disabled={creating || !name.trim()} className="btn btn-primary">
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
