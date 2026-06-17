'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  fetchAuthorVoice,
  fetchVoiceDocuments,
  uploadVoiceDocument,
  deleteVoiceDocument,
  recomputeAuthorVoice,
  fetchOrgContextSettings,
  saveOrgContextSettings,
  type AuthorVoice,
  type VoiceDocEntry,
} from '@/lib/api';

const ACCEPTED = '.pdf,.txt,.md';

function StatusBadge({ status }: { status: VoiceDocEntry['status'] }) {
  const color =
    status === 'extracted' ? 'var(--success, #16a34a)'
    : status === 'failed' ? 'var(--danger, #dc2626)'
    : 'var(--warning, #d97706)';
  const label = status === 'extracted' ? 'Learned' : status === 'failed' ? 'Failed' : 'Processing…';
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: '2px 10px',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="muted">—</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((it, i) => (
        <span
          key={`${it}-${i}`}
          style={{
            fontSize: 13,
            background: 'var(--panel-soft)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '3px 8px',
          }}
        >
          {it}
        </span>
      ))}
    </div>
  );
}

function VoiceField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        {label}
      </div>
      {children}
    </div>
  );
}

export default function InspirationContextPage() {
  const { apiKey } = useAuth();
  const [voice, setVoice] = useState<AuthorVoice | null>(null);
  const [docs, setDocs] = useState<VoiceDocEntry[]>([]);
  const [applyAuthorVoice, setApplyAuthorVoice] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!apiKey) return;
    try {
      const [v, d] = await Promise.all([fetchAuthorVoice(apiKey), fetchVoiceDocuments(apiKey)]);
      setVoice(v);
      setDocs(d);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [apiKey]);

  useEffect(() => {
    if (!apiKey) return;
    void refresh();
    fetchOrgContextSettings(apiKey)
      .then((s) => setApplyAuthorVoice(s.applyAuthorVoice))
      .catch(() => {});
  }, [apiKey, refresh]);

  // Poll while any document is still being processed.
  useEffect(() => {
    if (!docs.some((d) => d.status === 'processing')) return;
    const t = setTimeout(() => void refresh(), 3000);
    return () => clearTimeout(t);
  }, [docs, refresh]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!apiKey) return;
      const list = Array.from(files);
      if (list.length === 0) return;
      setUploading(true);
      setError(null);
      try {
        for (const file of list) {
          await uploadVoiceDocument(apiKey, file, setProgress);
        }
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    [apiKey, refresh],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files) void handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const onDelete = useCallback(
    async (id: string) => {
      if (!apiKey) return;
      try {
        const v = await deleteVoiceDocument(apiKey, id);
        setVoice(v);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [apiKey, refresh],
  );

  const onToggle = useCallback(
    async (next: boolean) => {
      if (!apiKey) return;
      setApplyAuthorVoice(next);
      try {
        await saveOrgContextSettings(apiKey, { applyAuthorVoice: next });
      } catch (err) {
        setError((err as Error).message);
        setApplyAuthorVoice(!next);
      }
    },
    [apiKey],
  );

  const onRecompute = useCallback(async () => {
    if (!apiKey) return;
    try {
      setVoice(await recomputeAuthorVoice(apiKey));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [apiKey]);

  return (
    <>
      <div className="page-header">
        <h1>Inspiration &amp; Global Context</h1>
        <p className="muted">
          Teach the system your team&apos;s style from past work. This shapes how new proposals are written —
          style only, never client facts.
        </p>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* ── Author Voice ───────────────────────────────────────────── */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h2 style={{ margin: 0 }}>Author Voice</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Upload past proposals (.pdf, .txt, .md). We learn tone, structure, phrasing and persuasion —
              and inject that voice when generating new proposals.
            </p>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={applyAuthorVoice} onChange={(e) => void onToggle(e.target.checked)} />
            <span style={{ fontSize: 14 }}>Use this voice when generating</span>
          </label>
        </div>

        {/* Drop zone */}
        <div
          className={`upload-zone${dragActive ? ' upload-zone-active' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED}
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="upload-zone-content">
            <span className="upload-zone-icon">&#x21EA;</span>
            <p>{uploading ? `Uploading… ${progress}%` : 'Drag and drop past proposals here, or click to browse'}</p>
            <p className="muted">Accepted: .pdf, .txt, .md</p>
          </div>
        </div>

        {/* Document list */}
        {docs.length > 0 && (
          <ul className="upload-file-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {docs.map((d) => (
              <li
                key={d.id}
                className="upload-file-item"
                style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}
              >
                <span className="upload-file-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.sourceDocument}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <StatusBadge status={d.status} />
                  <button className="btn btn-sm" onClick={() => void onDelete(d.id)} title="Remove">
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Learned voice ──────────────────────────────────────────── */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Learned Voice</h2>
          {voice && voice.docCount > 0 && (
            <button className="btn btn-sm" onClick={() => void onRecompute()}>Recompute</button>
          )}
        </div>

        {!voice || voice.docCount === 0 ? (
          <p className="muted">
            No voice learned yet. Upload a few past proposals above and the learned voice will appear here.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <VoiceField label={`Tone — ${voice.formality}`}>
              <Chips items={voice.tone} />
            </VoiceField>
            <VoiceField label="Typical structure">
              <Chips items={voice.sectionPatterns} />
            </VoiceField>
            {(voice.openingStyle || voice.closingStyle) && (
              <VoiceField label="Opening & closing">
                <div style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {voice.openingStyle && <span><strong>Opens:</strong> {voice.openingStyle}</span>}
                  {voice.closingStyle && <span><strong>Closes:</strong> {voice.closingStyle}</span>}
                </div>
              </VoiceField>
            )}
            <VoiceField label="Persuasion emphasis">
              <Chips items={voice.persuasionPatterns.map((p) => p.value)} />
            </VoiceField>
            <VoiceField label="Recurring phrases">
              <Chips items={voice.recurringPhrases.map((p) => p.value)} />
            </VoiceField>
            <VoiceField label="Characteristic vocabulary">
              <Chips items={voice.vocabulary.map((p) => p.value)} />
            </VoiceField>
            <VoiceField label="Formatting habits">
              <Chips items={voice.formatting} />
            </VoiceField>
            <p className="muted" style={{ fontSize: 12 }}>
              Merged from {voice.docCount} document{voice.docCount === 1 ? '' : 's'} · recent uploads weighted higher.
            </p>
          </div>
        )}
      </div>

      {/* ── Design Kit (Phase 2 placeholder) ───────────────────────── */}
      <div className="card" style={{ opacity: 0.7 }}>
        <h2 style={{ margin: 0 }}>Design Kit</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Coming soon — upload logos, palettes, and design inspiration to build a reusable kit that styles your microsites.
        </p>
      </div>
    </>
  );
}
