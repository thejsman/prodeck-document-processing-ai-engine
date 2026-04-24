'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useNamespace } from '@/lib/namespace-context';
import { useExecutionStore } from '@/core/execution/execution-store';
import {
  uploadKnowledgeFiles,
  fetchKnowledgeFiles,
  deleteNamespaceFile,
  reindexKnowledgeFile,
  type KnowledgeUploadResult,
  type IngestionFile,
  type IngestionStatus,
} from '@/lib/api';

const ACCEPTED_EXTENSIONS = ['.pdf', '.txt', '.md'];
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 MB
const POLL_INTERVAL_MS = 5000;

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
  return files.some((f) => f.status === 'uploaded' || f.status === 'processing' || f.status === 'extracting');
}

function StatusBadge({ status }: { status: IngestionStatus }) {
  if (status === 'processing') {
    return (
      <span className="ingestion-badge ingestion-badge--processing">
        <span className="spinner" style={{ width: 10, height: 10 }} /> Processing
      </span>
    );
  }
  if (status === 'extracting') {
    return (
      <span className="ingestion-badge ingestion-badge--processing">
        <span className="spinner" style={{ width: 10, height: 10 }} /> Extracting
      </span>
    );
  }
  if (status === 'extracted') {
    return <span className="ingestion-badge ingestion-badge--indexed">Extracted</span>;
  }
  if (status === 'indexed') {
    return <span className="ingestion-badge ingestion-badge--indexed">Indexed</span>;
  }
  if (status === 'failed') {
    return <span className="ingestion-badge ingestion-badge--failed">Failed</span>;
  }
  return <span className="ingestion-badge ingestion-badge--uploaded">Uploaded</span>;
}

type UploadState = 'idle' | 'uploading' | 'queued' | 'error';

export function FileUploader() {
  const { apiKey } = useAuth();
  const { namespace, namespaces, setNamespace, isLoading: nsLoading } = useNamespace();
  const addExecution = useExecutionStore((s) => s.addExecution);
  const updateExecution = useExecutionStore((s) => s.updateExecution);

  const inputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<KnowledgeUploadResult | null>(null);
  const [error, setError] = useState('');

  const [existingFiles, setExistingFiles] = useState<IngestionFile[]>([]);
  const [existingLoading, setExistingLoading] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [reindexingFile, setReindexingFile] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Load files ──────────────────────────────────────────────────

  const loadExistingFiles = useCallback(async () => {
    if (!apiKey || !namespace) return;
    setExistingLoading(true);
    try {
      const fetched = await fetchKnowledgeFiles(apiKey, namespace);
      setExistingFiles(fetched);
    } catch {
      setExistingFiles([]);
    } finally {
      setExistingLoading(false);
    }
  }, [apiKey, namespace]);

  useEffect(() => {
    loadExistingFiles();
  }, [loadExistingFiles]);

  // ── Auto-poll while jobs are active ─────────────────────────────

  useEffect(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    if (hasActiveJobs(existingFiles)) {
      pollTimerRef.current = setInterval(async () => {
        if (!apiKey || !namespace) return;
        try {
          const fetched = await fetchKnowledgeFiles(apiKey, namespace);
          setExistingFiles(fetched);
          if (!hasActiveJobs(fetched) && pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        } catch {
          // ignore poll errors
        }
      }, POLL_INTERVAL_MS);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [existingFiles, apiKey, namespace]);

  // ── Delete ───────────────────────────────────────────────────────

  const handleDeleteFile = useCallback(async (fileName: string) => {
    if (!apiKey || !namespace) return;
    if (!window.confirm(`Delete "${fileName}" from namespace "${namespace}"? This will trigger a reindex.`)) return;

    setDeletingFile(fileName);
    setDeleteMessage(null);
    try {
      await deleteNamespaceFile(apiKey, namespace, fileName);
      setDeleteMessage({ type: 'success', text: `Deleted "${fileName}" successfully.` });
      await loadExistingFiles();
    } catch (err) {
      setDeleteMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to delete file' });
    } finally {
      setDeletingFile(null);
    }
  }, [apiKey, namespace, loadExistingFiles]);

  // ── Reindex ──────────────────────────────────────────────────────

  const handleReindex = useCallback(async (fileName: string) => {
    if (!apiKey || !namespace) return;
    setReindexingFile(fileName);
    try {
      await reindexKnowledgeFile(apiKey, namespace, fileName);
      await loadExistingFiles();
    } catch {
      // silently ignore — status will reflect on next poll
    } finally {
      setReindexingFile(null);
    }
  }, [apiKey, namespace, loadExistingFiles]);

  // ── File selection ───────────────────────────────────────────────

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const valid: File[] = [];
    const rejected: string[] = [];

    for (const file of Array.from(incoming)) {
      if (!isAcceptedFile(file)) {
        rejected.push(`${file.name} (unsupported type)`);
      } else if (file.size > MAX_FILE_SIZE) {
        rejected.push(`${file.name} (exceeds 200 MB)`);
      } else {
        valid.push(file);
      }
    }

    if (rejected.length > 0) {
      setError(`Rejected: ${rejected.join(', ')}`);
    } else {
      setError('');
    }

    if (valid.length > 0) {
      setFiles((prev) => {
        const names = new Set(prev.map((f) => f.name));
        const deduped = valid.filter((f) => !names.has(f.name));
        return [...prev, ...deduped];
      });
      if (state === 'queued' || state === 'error') {
        setState('idle');
        setResult(null);
      }
    }
  }, [state]);

  const removeFile = useCallback((name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  // ── Drag and drop ────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  // ── Upload ────────────────────────────────────────────────────────

  const handleUpload = useCallback(async () => {
    if (!apiKey || files.length === 0) return;

    setState('uploading');
    setProgress(0);
    setError('');
    setResult(null);

    try {
      const res = await uploadKnowledgeFiles(apiKey, namespace, files, setProgress);

      // Register each queued job in the execution store immediately so they
      // appear in the task tray without waiting for an SSE event.
      for (const { fileName, jobId } of res.queued) {
        addExecution({ id: jobId, type: 'ingestion', status: 'queued', title: fileName });
      }

      setResult(res);
      setState('queued');
      setFiles([]);
      await loadExistingFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }, [apiKey, namespace, files, loadExistingFiles, addExecution]);

  const handleReset = useCallback(() => {
    setFiles([]);
    setState('idle');
    setProgress(0);
    setResult(null);
    setError('');
  }, []);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="file-uploader">
      {/* Namespace selector */}
      <div className="card">
        <div className="form-group">
          <label>Project</label>
          <select
            className="select"
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            disabled={nsLoading || state === 'uploading'}
          >
            {namespaces.map((ns) => (
              <option key={ns} value={ns}>{ns}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Drop zone */}
      <div
        className={`upload-zone${dragActive ? ' upload-zone-active' : ''}`}
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
        <div className="upload-zone-content">
          <span className="upload-zone-icon">&#x21EA;</span>
          <p>Drag and drop files here, or click to browse</p>
          <p className="muted">Accepted: .pdf, .txt, .md &mdash; Max 200 MB per file</p>
        </div>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="card">
          <h3 className="upload-file-list-title">
            Selected files <span className="badge">{files.length}</span>
          </h3>
          <ul className="upload-file-list">
            {files.map((file) => (
              <li key={file.name} className="upload-file-item">
                <span className="upload-file-name">{file.name}</span>
                <span className="muted">{formatSize(file.size)}</span>
                <button
                  className="upload-file-remove"
                  onClick={() => removeFile(file.name)}
                  disabled={state === 'uploading'}
                  title="Remove file"
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>

          {state !== 'uploading' && (
            <button
              className="btn btn-primary"
              onClick={handleUpload}
              disabled={files.length === 0}
              style={{ marginTop: 12 }}
            >
              Upload &amp; Index
            </button>
          )}
        </div>
      )}

      {/* Upload progress */}
      {state === 'uploading' && (
        <div className="card">
          <p><span className="spinner" /> Uploading&hellip;</p>
          <div className="upload-progress-track">
            <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <p className="muted" style={{ marginTop: 4 }}>{progress}%</p>
        </div>
      )}

      {/* Queued confirmation */}
      {state === 'queued' && result && (
        <div className="card upload-result">
          <h3>Files Queued for Indexing</h3>
          <div className="upload-result-stats">
            <div className="upload-result-stat">
              <span className="upload-result-value">{result.files}</span>
              <span className="muted">files uploaded</span>
            </div>
            <div className="upload-result-stat">
              <span className="upload-result-value">{result.queued.length}</span>
              <span className="muted">queued for indexing</span>
            </div>
          </div>
          {result.rejected && result.rejected.length > 0 && (
            <p className="muted" style={{ marginTop: 8 }}>
              Skipped: {result.rejected.join(', ')}
            </p>
          )}
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Indexing runs in the background. Status updates automatically.
          </p>
          <button className="btn" onClick={handleReset} style={{ marginTop: 12 }}>
            Upload More
          </button>
        </div>
      )}

      {/* Error */}
      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}

      {/* Existing Files */}
      <div className="card" style={{ marginTop: 8 }}>
        <div className="existing-files-header">
          <h3 className="upload-file-list-title">
            Existing Files {!existingLoading && <span className="badge">{existingFiles.length}</span>}
            {hasActiveJobs(existingFiles) && (
              <span className="ingestion-badge ingestion-badge--processing" style={{ marginLeft: 8 }}>
                <span className="spinner" style={{ width: 10, height: 10 }} /> Indexing
              </span>
            )}
          </h3>
          <button
            className="btn btn-sm"
            onClick={loadExistingFiles}
            disabled={existingLoading}
          >
            Refresh
          </button>
        </div>

        {deleteMessage && (
          <p className={deleteMessage.type === 'success' ? 'existing-files-success' : 'error'} style={{ marginBottom: 8 }}>
            {deleteMessage.text}
          </p>
        )}

        {existingLoading && <p className="loading">Loading files&hellip;</p>}

        {!existingLoading && existingFiles.length === 0 && (
          <p className="muted">No files in this namespace.</p>
        )}

        {!existingLoading && existingFiles.length > 0 && (
          <table className="existing-files-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {existingFiles.map((f) => (
                <tr key={f.fileName}>
                  <td className="existing-files-name">{f.fileName}</td>
                  <td className="muted">{formatSize(f.size)}</td>
                  <td className="muted">{new Date(f.uploadedAt).toLocaleDateString()}</td>
                  <td><StatusBadge status={f.status} /></td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    {f.status === 'failed' && (
                      <button
                        className="btn btn-sm"
                        onClick={() => handleReindex(f.fileName)}
                        disabled={reindexingFile !== null}
                        title="Retry indexing"
                      >
                        {reindexingFile === f.fileName ? <span className="spinner" /> : 'Retry'}
                      </button>
                    )}
                    <button
                      className="btn btn-sm existing-files-delete"
                      onClick={() => handleDeleteFile(f.fileName)}
                      disabled={deletingFile !== null || reindexingFile !== null}
                    >
                      {deletingFile === f.fileName ? <span className="spinner" /> : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
