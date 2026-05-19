'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { fetchMicrositeContent, saveMicrositeAst } from '@/lib/api';
import { MicrositeEditor } from '@/components/microsite/editor/MicrositeEditor';
import type { LayoutAST } from '@/types/presentation';

export default function MicrositeEditorClassicPage() {
  const { namespace, proposalId } = useParams<{ namespace: string; proposalId: string }>();
  const searchParams = useSearchParams();
  const entryId      = searchParams.get('entryId') ?? undefined;
  const { apiKey }   = useAuth();
  const router       = useRouter();

  const [ast, setAst]        = useState<LayoutAST | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]    = useState('');

  useEffect(() => {
    if (!apiKey || !namespace || !proposalId) return;
    setLoading(true);
    fetchMicrositeContent(apiKey, namespace, proposalId, 'classic', entryId)
      .then(({ ast: data }) => {
        if (!data) { setError('No microsite found — generate one first.'); setLoading(false); return; }
        setAst(data as LayoutAST);
        setLoading(false);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [apiKey, namespace, proposalId, entryId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg, #0d1117)', color: 'var(--text, #e6edf3)' }}>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ fontSize: 14, color: 'var(--muted, #8b949e)', margin: 0 }}>Loading editor…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (error || !ast) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg, #0d1117)', color: 'var(--text, #e6edf3)' }}>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <AlertTriangle size={32} style={{ marginBottom: 12, color: '#f85149' }} />
          <p style={{ fontSize: 15, margin: '0 0 8px' }}>{error || 'Microsite not found'}</p>
          <button
            onClick={() => router.back()}
            style={{ marginTop: 12, padding: '8px 16px', borderRadius: 7, border: '1px solid var(--border, #30363d)', background: 'transparent', color: 'var(--muted, #8b949e)', cursor: 'pointer', fontSize: 13 }}
          >
            ← Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <MicrositeEditor
      ast={ast}
      namespace={namespace}
      proposalId={proposalId}
      onClose={() => router.back()}
      onExport={async (editedAst) => {
        await saveMicrositeAst(apiKey!, namespace, proposalId, editedAst, entryId).catch(() => {});
        router.back();
      }}
    />
  );
}
