'use client';

import { useState } from 'react';
import { X, ArrowDown, Check } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '../../../lib/auth-context';
import { publishMicrosite } from '../../../lib/api';
import type { LayoutAST } from '../../../types/presentation';

interface Props {
  ast: LayoutAST;
  namespace: string;
  proposalId: string;
  onClose: () => void;
}

export function PublishModal({ ast, namespace, proposalId, onClose }: Props) {
  const { apiKey } = useAuth();
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const previewUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/microsite-view/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}`;

  async function handleDownload() {
    setStatus('loading');
    setError('');
    try {
      const result = await publishMicrosite(apiKey, namespace, proposalId, ast);
      setDownloadUrl(result.downloadUrl);
      setFileSize(result.size);
      setStatus('done');
      // Trigger browser download immediately
      const a = document.createElement('a');
      a.href = `/api${result.downloadUrl}`;
      a.download = `${proposalId}.html`;
      a.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(previewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select input
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--panel)',
          borderRadius: 12,
          width: '100%',
          maxWidth: 440,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0, lineHeight: 1.5, letterSpacing: '0em' }}>Publish Microsite</p>
            <p style={{ fontSize: 12, color: 'var(--subtle)', margin: '2px 0 0', lineHeight: 1.4, letterSpacing: '0.01em' }}>Export as a self-contained HTML file</p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--subtle)', padding: 4 }}
          ><Icon icon={X} size="md" /></button>
        </div>

        {/* Body */}
        <div style={{ padding: 24 }}>
          {/* Download HTML */}
          <div
            style={{
              padding: '16px 18px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div>
              <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', margin: 0, lineHeight: 1.5, letterSpacing: '0.01em' }}>Download HTML</p>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0', lineHeight: 1.4, letterSpacing: '0.01em' }}>
                {status === 'done'
                  ? `Ready — ${formatBytes(fileSize)}`
                  : 'Single file, no external dependencies'}
              </p>
            </div>
            <button
              onClick={handleDownload}
              disabled={status === 'loading'}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: 'none',
                background: status === 'loading' ? 'var(--border)' : 'var(--primary)',
                color: status === 'loading' ? 'var(--subtle)' : '#fff',
                fontSize: 12,
                fontWeight: 600,
                cursor: status === 'loading' ? 'not-allowed' : 'pointer',
                flexShrink: 0,
                whiteSpace: 'nowrap',
                lineHeight: 1.4,
                letterSpacing: '0.01em',
              }}
            >
              {status === 'loading' ? 'Exporting…' : <><Icon icon={ArrowDown} size="sm" /> {status === 'done' ? 'Download again' : 'Download'}</>}
            </button>
          </div>

          {/* Copy preview URL */}
          <div
            style={{
              padding: '16px 18px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', margin: 0, lineHeight: 1.5, letterSpacing: '0.01em' }}>Preview URL</p>
                <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0', lineHeight: 1.4, letterSpacing: '0.01em' }}>Share with your team (requires local server)</p>
              </div>
              <button
                onClick={handleCopyUrl}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: copied ? 'var(--success-soft)' : 'var(--panel)',
                  color: copied ? 'var(--success)' : 'var(--muted)',
                  fontSize: 12,
                  fontWeight: 400,
                  cursor: 'pointer',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                  lineHeight: 1.4,
                  letterSpacing: '0.01em',
                }}
              >
                {copied ? <><Icon icon={Check} size="sm" /> Copied</> : 'Copy URL'}
              </button>
            </div>
            <input
              readOnly
              value={previewUrl}
              onFocus={e => e.target.select()}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                fontSize: 11,
                color: 'var(--muted)',
                fontFamily: 'monospace',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Error */}
          {status === 'error' && (
            <div style={{ padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
          <p style={{ fontSize: 11, color: 'var(--subtle)', margin: 0, lineHeight: 1.4, letterSpacing: '0.01em' }}>
            The HTML export includes all fonts and styles inline. It works offline and can be hosted anywhere.
          </p>
        </div>
      </div>
    </div>
  );
}
