'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Loader2, Upload, X } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/lib/auth-context';
import { uploadKnowledgeFiles, type DocumentClassification, type KnowledgeUploadResult } from '@/lib/api';
import { ClassificationPicker } from '@/components/chat/ClassificationPicker';

const ACCEPTED_EXTENSIONS = ['.pdf', '.txt', '.md'];
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 MB

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAcceptedFile(file: File): boolean {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  return ACCEPTED_EXTENSIONS.includes(ext);
}

interface Props {
  namespace: string;
  onClose: () => void;
  onUploaded?: (queued: KnowledgeUploadResult['queued']) => void;
  onUploadStart?: (files: File[]) => void;
  onProgress?: (progress: number) => void;
  onUploadError?: () => void;
}

type UploadState = 'idle' | 'classifying' | 'uploading' | 'queued' | 'error';

export function ChatUploadDrawer({ namespace, onClose, onUploaded, onUploadStart, onProgress, onUploadError }: Props) {
  const { apiKey } = useAuth();

  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [classification, setClassification] = useState<DocumentClassification | null>(null);

  useEffect(() => {
    if (state === 'queued') onClose();
  }, [state, onClose]);

  const removeFile = (name: string) => {
    setFiles((prev) => {
      const next = prev.filter((f) => f.name !== name);
      if (next.length === 0) setState('idle');
      return next;
    });
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragActive(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragActive(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragActive(false);
    if (e.dataTransfer.files.length) handleFilesSelected(e.dataTransfer.files);
  };

  const handleFilesSelected = useCallback((incoming: FileList | File[]) => {
    const valid: File[] = [];
    const rejected: string[] = [];
    for (const f of Array.from(incoming)) {
      if (!isAcceptedFile(f)) rejected.push(f.name);
      else if (f.size > MAX_FILE_SIZE) rejected.push(`${f.name} (exceeds 200 MB)`);
      else valid.push(f);
    }
    if (rejected.length) setError(`Rejected: ${rejected.join(', ')}`);
    else setError('');
    if (valid.length) {
      setFiles((prev) => {
        const names = new Set(prev.map((f) => f.name));
        return [...prev, ...valid.filter((f) => !names.has(f.name))];
      });
      setState('classifying');
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!apiKey || !files.length || !classification) return;
    onUploadStart?.(files);
    setState('uploading');
    setProgress(0);
    setError('');
    try {
      const res = await uploadKnowledgeFiles(apiKey, namespace || 'default', files, (p) => {
        setProgress(p);
        onProgress?.(p);
      }, classification);
      onUploaded?.(res.queued);
      setState('queued');
      setFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
      onUploadError?.();
    }
  }, [apiKey, namespace, files, classification, onUploadStart, onProgress, onUploaded, onUploadError]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const modal = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        width: 'min(480px, 92vw)',
        maxHeight: 'min(680px, 90vh)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '18px 20px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'var(--primary-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon icon={Upload} size="sm" style={{ color: 'var(--primary)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>Ingest Files</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>
              Namespace: <span style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", color: 'var(--text)', opacity: 0.8 }}>{namespace || 'default'}</span>
            </div>
          </div>
          <button
            onClick={onClose} aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--primary-dim)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <Icon icon={X} size="md" />
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, overflowY: 'auto' }}>

          {/* Drop zone */}
          {state !== 'uploading' && (
            <div
              onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              style={{
                border: `2px dashed ${dragActive ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: 12, padding: '32px 20px', textAlign: 'center', cursor: 'pointer',
                transition: 'border-color 0.15s, background 0.15s',
                background: dragActive ? 'var(--primary-dim)' : 'transparent',
              }}
            >
              <input ref={inputRef} type="file" multiple accept=".pdf,.txt,.md" style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files) handleFilesSelected(e.target.files); e.target.value = ''; }}
              />
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--primary-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <Icon icon={Upload} size="md" style={{ color: 'var(--primary)' }} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>
                Drop files here or <span style={{ color: 'var(--primary)' }}>browse</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>.pdf, .txt, .md — up to 200 MB each</div>
            </div>
          )}

          {/* File list */}
          {files.length > 0 && (state === 'idle' || state === 'classifying' || state === 'error') && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              {files.map((f, i) => (
                <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: i === 0 ? 'none' : '1px solid var(--border)', background: 'var(--panel)' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--primary-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon icon={FileText} size="sm" style={{ color: 'var(--primary)' }} />
                  </div>
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{f.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{formatSize(f.size)}</span>
                  <button onClick={() => removeFile(f.name)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2, borderRadius: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--danger)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                    aria-label={`Remove ${f.name}`}
                  >
                    <Icon icon={X} size="sm" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Classification step */}
          {state === 'classifying' && (
            <ClassificationPicker value={classification} onChange={setClassification} />
          )}

          {/* Upload progress */}
          {state === 'uploading' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted)' }}>
                <Icon icon={Loader2} size="sm" style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} />
                Uploading…
                <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{progress}%</span>
              </div>
              <div style={{ height: 4, borderRadius: 99, background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: 'var(--primary)', borderRadius: 99, transition: 'width 0.2s ease' }} />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ fontSize: 13, color: 'var(--danger)', padding: '10px 12px', borderRadius: 8, background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)' }}>
              {error}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{ padding: '16px 20px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6, flexShrink: 0 }}>
          {(state === 'idle' || state === 'classifying' || state === 'error') && (
            <>
              <button className="btn btn-sm" onClick={onClose} style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
              {state === 'classifying' && (
                <button className="btn btn-sm" onClick={() => { setState('idle'); setClassification(null); }} style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Back</button>
              )}
              <button
                className="btn btn-sm btn-primary"
                onClick={state === 'classifying' ? handleUpload : () => setState('classifying')}
                disabled={files.length === 0 || (state === 'classifying' && !classification)}
                style={{ height: 36, padding: '0 16px', fontSize: 13, opacity: (files.length === 0 || (state === 'classifying' && !classification)) ? 0.45 : 1, cursor: (files.length === 0 || (state === 'classifying' && !classification)) ? 'not-allowed' : 'pointer' }}
              >
                {state === 'error' ? 'Retry' : state === 'classifying' ? `Upload (${files.length})` : `Next${files.length > 0 ? ` (${files.length})` : ''}`}
              </button>
            </>
          )}
          {state === 'uploading' && (
            <button className="btn btn-sm" disabled style={{ height: 36, padding: '0 16px', fontSize: 13, opacity: 0.5 }}>Uploading…</button>
          )}
        </div>

      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
