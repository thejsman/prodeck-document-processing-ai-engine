'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle, AlertTriangle } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { fetchMicrositeContent } from '@/lib/api';
import { Microsite } from '@/components/microsite/Microsite';
import type { LayoutAST } from '@/types/presentation';

export default function MicrositeViewPage() {
  const { namespace, proposalId } = useParams<{ namespace: string; proposalId: string }>();
  const { apiKey } = useAuth();
  const [ast, setAst] = useState<LayoutAST | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!apiKey || !namespace || !proposalId) return;
    setLoading(true);
    fetchMicrositeContent(apiKey, namespace, proposalId)
      .then(({ ast: data }) => {
        setAst(data as LayoutAST | null);
        setLoading(false);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [apiKey, namespace, proposalId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <Icon icon={LoaderCircle} size="xl" style={{ marginBottom: 12, animation: 'spin 1s linear infinite', display: 'inline-block' }} />
          <p style={{ fontSize: 14, color: '#888' }}>Loading microsite…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <Icon icon={AlertTriangle} size="xl" style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Failed to load microsite</p>
          <p style={{ fontSize: 13, color: '#888' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!ast) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 48, marginBottom: 12 }}>📄</p>
          <p style={{ fontSize: 16, fontWeight: 600 }}>No microsite generated yet</p>
          <p style={{ fontSize: 13, color: '#888', marginTop: 8 }}>Generate a microsite first from the presentation builder.</p>
        </div>
      </div>
    );
  }

  return <Microsite ast={ast} mode="fullscreen" />;
}
