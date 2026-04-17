'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  uploadKnowledgeFiles,
  fetchKnowledgeFiles,
  type KnowledgeUploadResult,
  type IngestionFile,
} from '@/lib/api';

const ACCEPTED_EXTENSIONS = ['.pdf', '.txt', '.md'];
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 MB
const POLL_INTERVAL_MS = 3000;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAcceptedFile(file: File): boolean {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  return ACCEPTED_EXTENSIONS.includes(ext);
}

function hasActiveJobs(files: IngestionFile[]): boolean {
  return files.some((f) => f.status === 'uploaded' || f.status === 'processing');
}

interface Props {
  namespace: string;
  onClose: () => void;
}

type UploadState = 'idle' | 'uploading' | 'queued' | 'error';

export function ChatUploadDrawer({ namespace, onClose }: Props) {
  const { apiKey } = useAuth();

  const inputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<KnowledgeUploadResult | null>(null);
  const [error, setError] = useState('');
  const [indexingFiles, setIndexingFiles] = useState<IngestionFile[]>([]);

  // Poll while indexing jobs are active
  useEffect(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    if (state === 'queued' && hasActiveJobs(indexingFiles)) {
      pollTimerRef.current = setInterval(async () => {
        if (!apiKey || !namespace) return;
        try {
          const fetched = await fetchKnowledgeFiles(apiKey, namespace);
          setIndexingFiles(fetched);
          if (!hasActiveJobs(fetched) && pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        } catch { /* ignore */ }
      }, POLL_INTERVAL_MS);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [state, indexingFiles, apiKey, namespace]);

  // File selection
  const addFiles = useCallback((incoming: FileList | File[]) => {
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
    }
  }, []);

  const removeFile = (name: string) =>
    setFiles((prev) => prev.filter((f) => f.name !== name));

  // Drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); setDragActive(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); setDragActive(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragActive(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  // Upload
  const handleUpload = useCallback(async () => {
    if (!apiKey || !files.length) return;
    setState('uploading');
    setProgress(0);
    setError('');
    setResult(null);
    try {
      const res = await uploadKnowledgeFiles(apiKey, namespace || 'default', files, setProgress);
      setResult(res);
      setState('queued');
      setFiles([]);
      // Fetch initial indexing state
      const fetched = await fetchKnowledgeFiles(apiKey, namespace || 'default');
      setIndexingFiles(fetched);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }, [apiKey, namespace, files]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const activeCount = indexingFiles.filter(
    (f) => f.status === 'uploaded' || f.status === 'processing',
  ).length;
  const indexedCount = indexingFiles.filter((f) => f.status === 'indexed').length;

  return (
    <div className="chat-upload-drawer">
      {/* Header */}
      <div className="chat-upload-header">
        <div>
          <span className="chat-upload-title">Upload to namespace</span>
          <code className="chat-upload-ns">{namespace || 'default'}</code>
        </div>
        <button className="chat-upload-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {/* Drop zone */}
      {state !== 'queued' && (
        <div
          className={`chat-upload-zone${dragActive ? ' chat-upload-zone--active' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.txt,.md"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <span className="chat-upload-icon">&#x21EA;</span>
          <p>Drop files here or <span className="chat-upload-link">browse</span></p>
          <p className="muted" style={{ fontSize: 11 }}>.pdf .txt .md — max 200 MB</p>
        </div>
      )}

      {/* File list */}
      {files.length > 0 && state !== 'uploading' && (
        <ul className="chat-upload-file-list">
          {files.map((f) => (
            <li key={f.name} className="chat-upload-file-item">
              <span className="chat-upload-file-name">{f.name}</span>
              <span className="muted" style={{ fontSize: 11 }}>{formatSize(f.size)}</span>
              <button
                className="chat-upload-remove"
                onClick={() => removeFile(f.name)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Upload progress */}
      {state === 'uploading' && (
        <div className="chat-upload-progress">
          <p className="muted"><span className="spinner" style={{ width: 12, height: 12 }} /> Uploading…</p>
          <div className="upload-progress-track" style={{ marginTop: 6 }}>
            <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>{progress}%</p>
        </div>
      )}

      {/* Queued state */}
      {state === 'queued' && result && (
        <div className="chat-upload-success">
          <p>
            <strong>{result.queued.length}</strong> file{result.queued.length !== 1 ? 's' : ''} queued for indexing.
          </p>
          {activeCount > 0 && (
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              <span className="spinner" style={{ width: 10, height: 10 }} /> {activeCount} indexing…
            </p>
          )}
          {activeCount === 0 && indexedCount > 0 && (
            <p style={{ fontSize: 12, marginTop: 4, color: 'var(--color-success)' }}>
              All files indexed.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-sm" onClick={() => { setState('idle'); setResult(null); }}>
              Upload more
            </button>
            <button className="btn btn-sm btn-primary" onClick={onClose} style={{ width: 'auto' }}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && <p className="error" style={{ marginTop: 6, fontSize: 12 }}>{error}</p>}

      {/* Upload button */}
      {files.length > 0 && state === 'idle' && (
        <button
          className="btn btn-primary"
          onClick={handleUpload}
          style={{ marginTop: 8, width: '100%' }}
        >
          Upload &amp; Index ({files.length} file{files.length !== 1 ? 's' : ''})
        </button>
      )}
      {files.length > 0 && state === 'error' && (
        <button
          className="btn btn-primary"
          onClick={handleUpload}
          style={{ marginTop: 8, width: '100%' }}
        >
          Retry Upload
        </button>
      )}
    </div>
  );
}
