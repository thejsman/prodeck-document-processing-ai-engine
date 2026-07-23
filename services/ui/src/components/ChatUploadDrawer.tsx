'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Plus, Upload, X } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/lib/auth-context';
import { uploadKnowledgeFiles, type DocumentClassification, type KnowledgeUploadResult } from '@/lib/api';
import { ClassificationPicker } from '@/components/chat/ClassificationPicker';

const ACCEPTED_EXTENSIONS = ['.pdf', '.txt', '.md'];
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 MB

const FILE_TYPE_COLORS: Record<string, string> = {
  '.pdf': '#ef4444',
  '.txt': '#6366f1',
  '.md':  '#8b5cf6',
};

function getExt(name: string): string {
  return name.slice(name.lastIndexOf('.')).toLowerCase();
}

function fileColor(name: string): string {
  return FILE_TYPE_COLORS[getExt(name)] ?? 'var(--color-primary)';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAcceptedFile(file: File): boolean {
  return ACCEPTED_EXTENSIONS.includes(getExt(file.name));
}

interface Props {
  namespace: string;
  onClose: () => void;
  onUploaded?: (queued: KnowledgeUploadResult['queued']) => void;
  onUploadStart?: (files: File[]) => void;
  onProgress?: (progress: number) => void;
  onUploadError?: (message?: string) => void;
}

type UploadState = 'idle' | 'classifying' | 'error';

export function ChatUploadDrawer({ namespace, onClose, onUploaded, onUploadStart, onProgress, onUploadError }: Props) {
  const { apiKey } = useAuth();

  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [state, setState] = useState<UploadState>('idle');
  const [error, setError] = useState('');
  const [classification, setClassification] = useState<DocumentClassification | null>('client_source');

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

  const handleUpload = useCallback(() => {
    if (!apiKey || !files.length || !classification) return;
    // Notify parent to add inline upload message, then close immediately.
    // The XHR continues in the background; parent callbacks handle all progress/done/error.
    onUploadStart?.(files);
    onClose();
    uploadKnowledgeFiles(apiKey, namespace || 'default', files, (p) => {
      onProgress?.(p);
    }, classification).then(
      (res) => onUploaded?.(res.queued),
      (err: unknown) => onUploadError?.(err instanceof Error ? err.message : 'Upload failed'),
    );
  }, [apiKey, namespace, files, classification, onUploadStart, onProgress, onUploaded, onUploadError, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const hasFiles = files.length > 0;
  const isActive = state === 'idle' || state === 'classifying' || state === 'error';
  const canUpload = hasFiles && isActive;

  const modal = (
    <div
      className="generate-proposal-overlay"
      style={{ zIndex: 20000 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="generate-proposal-modal" onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="generate-proposal-header">
          <div>
            <h3>Add documents</h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '2px 0 0', lineHeight: 1.4 }}>
              {namespace || 'default'}
            </p>
          </div>
          <button className="chat-v2-panel-toggle" onClick={onClose} aria-label="Close">
            <Icon icon={X} size="sm" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="generate-proposal-body">

          {/* Drop zone — full when empty, compact strip when files selected */}
          {(
            !hasFiles ? (
              <div
                onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  borderRadius: 8, padding: '32px 20px', textAlign: 'center', cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                  background: dragActive ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)' : 'transparent',
                }}
              >
                <input ref={inputRef} type="file" multiple accept=".pdf,.txt,.md" style={{ display: 'none' }}
                  onChange={(e) => { if (e.target.files) handleFilesSelected(e.target.files); e.target.value = ''; }}
                />
                <div style={{ width: 40, height: 40, borderRadius: 8, background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                  <Icon icon={Upload} size="md" style={{ color: 'var(--color-primary)' }} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)', marginBottom: 4 }}>
                  Drop files here or <span style={{ color: 'var(--color-primary)' }}>browse</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>.pdf, .txt, .md — up to 200 MB each</div>
              </div>
            ) : (
              <div
                onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  border: `1.5px dashed ${dragActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  borderRadius: 8, padding: '9px 14px', cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                  background: dragActive ? 'color-mix(in srgb, var(--color-primary) 6%, transparent)' : 'transparent',
                }}
              >
                <input ref={inputRef} type="file" multiple accept=".pdf,.txt,.md" style={{ display: 'none' }}
                  onChange={(e) => { if (e.target.files) handleFilesSelected(e.target.files); e.target.value = ''; }}
                />
                <Icon icon={Plus} size="sm" style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Add more files</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-text-muted)' }}>.pdf · .txt · .md</span>
              </div>
            )
          )}

          {/* File list */}
          {hasFiles && isActive && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {files.map((f) => {
                const color = fileColor(f.name);
                const ext = getExt(f.name).slice(1).toUpperCase();
                return (
                  <div
                    key={f.name}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                    }}
                  >
                    {/* File type icon */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                      background: `color-mix(in srgb, ${color} 12%, transparent)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon icon={FileText} size="sm" style={{ color }} />
                    </div>

                    {/* Name + size */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 500, color: 'var(--color-text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        lineHeight: 1.4,
                      }}>
                        {f.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.4, marginTop: 1 }}>
                        {formatSize(f.size)}
                      </div>
                    </div>

                    {/* Extension badge */}
                    <span style={{
                      fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                      padding: '2px 6px', borderRadius: 4,
                      background: `color-mix(in srgb, ${color} 12%, transparent)`,
                      color, flexShrink: 0,
                    }}>
                      {ext}
                    </span>

                    {/* Remove */}
                    <button
                      onClick={() => removeFile(f.name)}
                      aria-label={`Remove ${f.name}`}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--color-text-muted)', padding: 2, borderRadius: 4,
                        display: 'flex', alignItems: 'center', flexShrink: 0,
                        transition: 'color 0.12s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-error)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                    >
                      <Icon icon={X} size="sm" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Classification step */}
          {state === 'classifying' && (
            <ClassificationPicker value={classification} onChange={setClassification} />
          )}

          {/* Error */}
          {error && (
            <div style={{ fontSize: 13, color: 'var(--color-error)', padding: '10px 12px', borderRadius: 8, background: 'color-mix(in srgb, var(--color-error) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-error) 25%, transparent)' }}>
              {error}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="generate-proposal-footer">
          <button
            className="btn btn-sm btn-primary"
            onClick={state === 'classifying' ? handleUpload : () => setState('classifying')}
            disabled={!canUpload || (state === 'classifying' && !classification)}
            style={{ width: 'auto', opacity: (!canUpload || (state === 'classifying' && !classification)) ? 0.45 : 1, cursor: (!canUpload || (state === 'classifying' && !classification)) ? 'not-allowed' : 'pointer' }}
          >
            {state === 'error' ? 'Retry' : state === 'classifying' ? `Upload (${files.length})` : `Next${files.length > 0 ? ` (${files.length})` : ''}`}
          </button>
        </div>

      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
