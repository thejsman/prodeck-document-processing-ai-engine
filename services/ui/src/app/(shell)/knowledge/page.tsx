'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useNamespace } from '@/lib/namespace-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type IngestionStatus = 'uploaded' | 'processing' | 'indexed' | 'extracting' | 'extracted' | 'failed';

interface KBFile {
  fileName: string;
  size: number;
  uploadedAt: string;
  status: IngestionStatus;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const STATUS_BADGE: Record<IngestionStatus, string> = {
  indexed:    'badge--running',
  extracting: 'badge--running',
  extracted:  'badge--ok',
  processing: 'badge--running',
  uploaded:   'badge--editing',
  failed:     'badge--error',
};

const STATUS_LABEL: Record<IngestionStatus, string> = {
  indexed:    'Indexed',
  extracting: 'Extracting',
  extracted:  'Extracted',
  processing: 'Processing',
  uploaded:   'Pending',
  failed:     'Failed',
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function KnowledgePage() {
  const { apiKey } = useAuth();
  const { namespace } = useNamespace();
  const ns = namespace || 'default';

  const [files, setFiles] = useState<KBFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [reindexingFile, setReindexingFile] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Data fetching ────────────────────────────────────────────────

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/knowledge/files?namespace=${encodeURIComponent(ns)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { files: KBFile[] };
      setFiles(data.files ?? []);
      setFetchError(null);
    } catch (err) {
      setFetchError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ns, apiKey]);

  // Load on mount and namespace change
  useEffect(() => {
    setLoading(true);
    setFiles([]);
    fetchFiles();
  }, [fetchFiles]);

  // Auto-poll while any file is still being processed
  useEffect(() => {
    const hasPending = files.some(
      (f) => f.status === 'processing' || f.status === 'uploaded',
    );
    if (!hasPending) return;
    const interval = setInterval(fetchFiles, 3_000);
    return () => clearInterval(interval);
  }, [files, fetchFiles]);

  // ── Actions ──────────────────────────────────────────────────────

  async function handleDelete(fileName: string) {
    if (
      !confirm(
        `Delete "${fileName}"?\n\nThis will remove the file and trigger a full reindex of remaining documents.`,
      )
    )
      return;

    setDeletingFile(fileName);
    try {
      const res = await fetch(
        `/api/namespaces/${encodeURIComponent(ns)}/files/${encodeURIComponent(fileName)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await fetchFiles();
    } catch (err) {
      alert(`Delete failed: ${(err as Error).message}`);
    } finally {
      setDeletingFile(null);
    }
  }

  async function handleReindex(fileName: string) {
    setReindexingFile(fileName);
    try {
      const res = await fetch('/api/knowledge/reindex', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ namespace: ns, fileName }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await fetchFiles();
    } catch (err) {
      alert(`Reindex failed: ${(err as Error).message}`);
    } finally {
      setReindexingFile(null);
    }
  }

  // ── Derived counts ───────────────────────────────────────────────

  const indexedCount    = files.filter((f) => f.status === 'indexed').length;
  const pendingCount    = files.filter((f) => f.status === 'processing' || f.status === 'uploaded').length;
  const failedCount     = files.filter((f) => f.status === 'failed').length;

  // ── Render ───────────────────────────────────────────────────────

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Knowledge Base</h1>
          <p className="muted">
            Documents indexed in the <strong>{ns}</strong> namespace.
          </p>
        </div>
        <div className="page-header-action">
          <Link href="/ingest" className="btn btn-primary btn-sm">
            + Upload
          </Link>
          <button className="btn btn-sm" onClick={fetchFiles} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Summary stats */}
      {files.length > 0 && (
        <div className="kb-stats">
          <div className="kb-stat">
            <span className="kb-stat-value">{files.length}</span>
            <span className="kb-stat-label">Total</span>
          </div>
          <div className="kb-stat">
            <span className="kb-stat-value kb-stat-value--ok">{indexedCount}</span>
            <span className="kb-stat-label">Indexed</span>
          </div>
          {pendingCount > 0 && (
            <div className="kb-stat">
              <span className="kb-stat-value kb-stat-value--processing">
                {pendingCount}
              </span>
              <span className="kb-stat-label">Processing</span>
            </div>
          )}
          {failedCount > 0 && (
            <div className="kb-stat">
              <span className="kb-stat-value kb-stat-value--failed">{failedCount}</span>
              <span className="kb-stat-label">Failed</span>
            </div>
          )}
        </div>
      )}

      <div className="card">
        {fetchError && (
          <p className="kb-fetch-error">Failed to load files: {fetchError}</p>
        )}

        {loading && files.length === 0 ? (
          <p className="muted kb-loading-text">Loading…</p>
        ) : files.length === 0 ? (
          <div className="kb-empty">
            <p className="muted">No documents in this namespace yet.</p>
            <Link href="/ingest" className="btn btn-primary btn-sm" style={{ marginTop: 12 }}>
              Upload documents
            </Link>
          </div>
        ) : (
          <table className="kb-table">
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
              {files.map((file) => (
                <tr
                  key={file.fileName}
                  className={file.status === 'failed' ? 'kb-row--failed' : ''}
                >
                  <td className="kb-cell-name" title={file.fileName}>
                    {file.fileName}
                  </td>
                  <td className="kb-cell-meta">{formatBytes(file.size)}</td>
                  <td className="kb-cell-meta">{formatDate(file.uploadedAt)}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[file.status]}`}>
                      {STATUS_LABEL[file.status]}
                      {(file.status === 'processing' || file.status === 'uploaded') && (
                        <span className="kb-spinner" />
                      )}
                    </span>
                    {file.error && (
                      <span className="kb-error-hint" title={file.error}>⚠</span>
                    )}
                  </td>
                  <td className="kb-cell-actions">
                    {file.status === 'failed' && (
                      <button
                        className="btn btn-sm"
                        onClick={() => handleReindex(file.fileName)}
                        disabled={reindexingFile === file.fileName}
                      >
                        {reindexingFile === file.fileName ? 'Retrying…' : 'Retry'}
                      </button>
                    )}
                    <button
                      className="btn btn-sm kb-btn-delete"
                      onClick={() => handleDelete(file.fileName)}
                      disabled={deletingFile === file.fileName}
                    >
                      {deletingFile === file.fileName ? 'Deleting…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
