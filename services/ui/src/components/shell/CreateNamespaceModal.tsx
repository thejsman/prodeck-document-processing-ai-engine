'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/lib/auth-context';
import { useNamespace } from '@/lib/namespace-context';
import { createNamespace, updateContextField } from '@/lib/api';

interface Props {
  onClose: () => void;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export function CreateNamespaceModal({ onClose }: Props) {
  const { apiKey } = useAuth();
  const { setNamespace, addNamespace } = useNamespace();
  const router = useRouter();

  const [namespaceName, setNamespaceName] = useState('');
  const [clientName, setClientName] = useState('');
  const [namespaceError, setNamespaceError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  async function handleCreate() {
    const trimmedNs = namespaceName.trim();
    if (!trimmedNs) {
      setNamespaceError('Namespace is required');
      return;
    }
    const slug = slugify(trimmedNs);
    if (!slug) {
      setNamespaceError('Namespace must contain at least one letter or number');
      return;
    }
    setCreating(true);
    setNamespaceError('');
    try {
      const trimmedClient = clientName.trim();
      const ns = await createNamespace(apiKey, slug, trimmedClient || trimmedNs);
      if (trimmedClient) {
        await updateContextField(apiKey, ns, 'clientName', trimmedClient);
      }
      addNamespace(ns);
      setNamespace(ns);
      onClose();
      router.push('/chat');
    } catch (err) {
      setNamespaceError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="create-ns-backdrop"
      style={{ position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="create-ns-modal"
        style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.35)', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>
              Create Namespace
            </p>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <Icon icon={X} size="md" />
            </button>
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--border)' }} />

        {/* Body */}
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Namespace field — required */}
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
              Namespace <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>
            </label>
            <input
              autoFocus
              value={namespaceName}
              onChange={(e) => { setNamespaceName(e.target.value); setNamespaceError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="e.g. acme-corp"
              style={{
                width: '100%', padding: '8px 10px',
                border: `1px solid ${namespaceError ? 'var(--danger)' : 'var(--border)'}`,
                borderRadius: 6, background: 'var(--panel-soft)', color: 'var(--text)',
                fontSize: 14, outline: 'none', boxSizing: 'border-box',
              }}
            />
            {namespaceError && <p style={{ fontSize: 12, color: 'var(--danger)', margin: '4px 0 0' }}>{namespaceError}</p>}
            {namespaceName.trim() && !namespaceError && (
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0', opacity: 0.7 }}>
                Slug: {slugify(namespaceName.trim())}
              </p>
            )}
          </div>

          {/* Client name — optional */}
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
              Client name <span style={{ fontSize: 11, opacity: 0.6 }}>(optional)</span>
            </label>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="e.g. Acme Corporation"
              style={{
                width: '100%', padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 6, background: 'var(--panel-soft)', color: 'var(--text)',
                fontSize: 14, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            onClick={handleCreate}
            disabled={creating || !namespaceName.trim()}
            className="btn btn-primary"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
