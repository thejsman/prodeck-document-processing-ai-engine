'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Layers, Loader, Menu, MoreHorizontal, Plus, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ThemeToggle } from '@/components/system/ThemeToggle';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  fetchAuthorVoice,
  fetchVoiceDocuments,
  uploadVoiceDocument,
  deleteVoiceDocument,
  recomputeAuthorVoice,
  fetchOrgContextSettings,
  saveOrgContextSettings,
  fetchDesignAssets,
  uploadDesignAsset,
  deleteDesignAsset,
  setAssetPrimary,
  fetchDesignKit,
  recomputeDesignKit,
  type AuthorVoice,
  type VoiceDocEntry,
  type AssetMetadata,
  type DesignKit,
} from '@/lib/api';

const ACCEPTED_VOICE = '.pdf,.txt,.md,.docx,.png,.jpg,.jpeg,.webp';
const ACCEPTED_ASSETS = '.png,.jpg,.jpeg,.webp,.gif,.svg';

type Tab = 'voice' | 'assets';

// ── Shared small components ───────────────────────────────────────────────────

function Chip({ label, color }: { label: string; color?: string }) {
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 13,
      padding: '4px 12px',
      borderRadius: 20,
      background: color ?? 'var(--panel-soft)',
      color: 'var(--text)',
      wordBreak: 'break-word',
    }}>
      {label}
    </span>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}
        dangerouslySetInnerHTML={{ __html: label }} />
      {children}
    </div>
  );
}

function ChipRow({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="muted" style={{ fontSize: 14 }}>—</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((it, i) => <Chip key={`${it}-${i}`} label={it} />)}
    </div>
  );
}

function ColorSwatch({ hex }: { hex: string }) {
  return (
    <div title={hex} style={{ width: 24, height: 24, borderRadius: 5, background: hex, border: '1px solid var(--border)', flexShrink: 0 }} />
  );
}

// ── Author Voice context card (with integrated upload) ───────────────────────

const RECENCY_PRESETS: Array<{ label: string; value: number; hint: string }> = [
  { label: '1× Flat', value: 1, hint: 'All proposals weighted equally' },
  { label: '2× Default', value: 2, hint: 'Recent proposals weighted 2× older ones' },
  { label: '4× Aggressive', value: 4, hint: 'Recent proposals heavily dominate' },
];

function UploadArea({
  accept, uploading, progress, dragActive, hint, inputRef, onDragOver, onDragLeave, onDrop, onFiles,
}: {
  accept: string; uploading: boolean; progress: number; dragActive: boolean; hint: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void; onFiles: (files: FileList) => void;
}) {
  return (
    <div
      style={{
        border: `1.5px dashed ${dragActive ? 'var(--primary)' : 'var(--border)'}`,
        borderRadius: 8,
        padding: '18px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 5,
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
        background: dragActive ? 'color-mix(in srgb, var(--primary) 5%, transparent)' : 'transparent',
      }}
      onClick={() => inputRef.current?.click()}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input ref={inputRef} type="file" multiple accept={accept} style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ''; }} />
      {uploading ? (
        <>
          <Loader size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} />
          <span style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 500 }}>Uploading… {progress}%</span>
        </>
      ) : (
        <>
          <UploadCloud size={16} strokeWidth={1.5} style={{ color: 'var(--muted)' }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Drop files or click to upload</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>{hint}</span>
        </>
      )}
    </div>
  );
}

function VoiceContextCard({
  voice, docs, applyAuthorVoice, onToggle, onRecompute, recencyMultiplier, onMultiplierChange,
  uploading, progress, dragActive, inputRef, onDragOver, onDragLeave, onDrop, onFiles,
}: {
  voice: AuthorVoice | null; docs: VoiceDocEntry[];
  applyAuthorVoice: boolean; onToggle: (v: boolean) => void; onRecompute: () => void;
  recencyMultiplier: number; onMultiplierChange: (v: number) => void;
  uploading: boolean; progress: number; dragActive: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void; onFiles: (files: FileList) => void;
}) {
  const extracted = docs.filter((d) => d.status === 'extracted').length;
  const hasVoice = voice && voice.docCount > 0;
  const hasDocs = docs.length > 0;

  return (
    <div style={{ borderRadius: 12, padding: 20, background: '#fff', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileText size={13} strokeWidth={1.5} style={{ color: 'var(--muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', flex: 1 }}>
          Author Voice
        </span>
        {hasVoice && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--success, #16a34a)', fontWeight: 500, flexShrink: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success, #16a34a)', display: 'inline-block', flexShrink: 0 }} />
            {extracted} doc{extracted === 1 ? '' : 's'}
          </span>
        )}
        {hasVoice && (
          <button className="brief-knowledge-icon-btn" onClick={onRecompute} title="Recompute voice">
            <RefreshCw size={13} strokeWidth={1.5} />
          </button>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', color: 'var(--muted)', flexShrink: 0 }}>
          <input type="checkbox" checked={applyAuthorVoice} onChange={(e) => onToggle(e.target.checked)} style={{ width: 12, height: 12 }} />
          Apply
        </label>
      </div>

      {/* Recency bias */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>Recency</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {RECENCY_PRESETS.map((p) => (
            <button key={p.value} title={p.hint} onClick={() => onMultiplierChange(p.value)} style={{
              fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 6,
              border: '1px solid var(--border)', cursor: 'pointer',
              background: recencyMultiplier === p.value ? 'var(--primary)' : 'var(--panel)',
              color: recencyMultiplier === p.value ? '#fff' : 'var(--muted)',
              transition: 'background 0.15s, color 0.15s',
            }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content: upload zone OR full voice detail */}
      {!hasDocs ? (
        <UploadArea
          accept={ACCEPTED_VOICE} uploading={uploading} progress={progress} dragActive={dragActive}
          hint="PDF · DOCX · MD · TXT · PNG · JPG — style only, no facts stored"
          inputRef={inputRef} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onFiles={onFiles}
        />
      ) : !hasVoice ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Processing {docs.length} proposal{docs.length === 1 ? '' : 's'}…
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <LabeledField label={`Tone — ${voice.formality}`}>
            <ChipRow items={voice.tone} />
          </LabeledField>
          <LabeledField label="Typical structure">
            <ChipRow items={voice.sectionPatterns} />
          </LabeledField>
          {(voice.openingStyle || voice.closingStyle) && (
            <LabeledField label="Opening &amp; closing">
              <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {voice.openingStyle && <span><strong>Opens:</strong> {voice.openingStyle}</span>}
                {voice.closingStyle && <span><strong>Closes:</strong> {voice.closingStyle}</span>}
              </div>
            </LabeledField>
          )}
          <LabeledField label="Persuasion emphasis">
            <ChipRow items={voice.persuasionPatterns.map((p) => p.value)} />
          </LabeledField>
          <LabeledField label="Recurring phrases">
            <ChipRow items={voice.recurringPhrases.map((p) => p.value)} />
          </LabeledField>
          <LabeledField label="Characteristic vocabulary">
            <ChipRow items={voice.vocabulary.map((p) => p.value)} />
          </LabeledField>
          <LabeledField label="Formatting habits">
            <ChipRow items={voice.formatting} />
          </LabeledField>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Merged from {voice.docCount} doc{voice.docCount === 1 ? '' : 's'} · recent uploads weighted higher.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Design Kit context card (with integrated upload) ──────────────────────────

function DesignKitCard({
  kit, assets, applyDesignKit, onToggle, onRecompute,
  uploading, progress, dragActive, inputRef, onDragOver, onDragLeave, onDrop, onFiles,
}: {
  kit: DesignKit | null; assets: AssetMetadata[];
  applyDesignKit: boolean; onToggle: (v: boolean) => void; onRecompute: () => void;
  uploading: boolean; progress: number; dragActive: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void; onFiles: (files: FileList) => void;
}) {
  const tagged = assets.filter((a) => a.status === 'tagged').length;
  const hasKit = kit && kit.primaryColor;
  const hasAssets = assets.length > 0;

  return (
    <div style={{ borderRadius: 12, padding: 20, background: '#fff', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Layers size={13} strokeWidth={1.5} style={{ color: 'var(--muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', flex: 1 }}>
          Brand Assets
        </span>
        {hasKit && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--success, #16a34a)', fontWeight: 500, flexShrink: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success, #16a34a)', display: 'inline-block', flexShrink: 0 }} />
            {tagged} asset{tagged === 1 ? '' : 's'}
          </span>
        )}
        {hasKit && (
          <button className="brief-knowledge-icon-btn" onClick={onRecompute} title="Recompute design kit">
            <RefreshCw size={13} strokeWidth={1.5} />
          </button>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', color: 'var(--muted)', flexShrink: 0 }}>
          <input type="checkbox" checked={applyDesignKit} onChange={(e) => onToggle(e.target.checked)} style={{ width: 12, height: 12 }} />
          Apply
        </label>
      </div>

      {/* Content: upload zone OR kit summary */}
      {!hasAssets ? (
        <UploadArea
          accept={ACCEPTED_ASSETS} uploading={uploading} progress={progress} dragActive={dragActive}
          hint="PNG · JPG · WEBP · GIF · SVG — logos, palettes, hero images"
          inputRef={inputRef} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onFiles={onFiles}
        />
      ) : !hasKit ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Processing {assets.length} asset{assets.length === 1 ? '' : 's'}…
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <LabeledField label="Palette">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {kit.palette.map((hex) => (
                <div key={hex} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: hex, border: '1px solid var(--border)' }} />
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>{hex}</span>
                </div>
              ))}
            </div>
          </LabeledField>
          {kit.fontHints.length > 0 && (
            <LabeledField label="Typography">
              <ChipRow items={kit.fontHints} />
            </LabeledField>
          )}
          {kit.designBrief && (
            <LabeledField label="Brief">
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>{kit.designBrief}</p>
            </LabeledField>
          )}
          {(kit.logoAssetId || kit.heroAssetId) && (
            <LabeledField label="Selected assets">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                {kit.logoAssetId && (
                  <span><strong>Logo:</strong> {assets.find((a) => a.id === kit.logoAssetId)?.fileName ?? kit.logoAssetId.slice(0, 8)}</span>
                )}
                {kit.heroAssetId && (
                  <span><strong>Hero:</strong> {assets.find((a) => a.id === kit.heroAssetId)?.fileName ?? kit.heroAssetId.slice(0, 8)}</span>
                )}
              </div>
            </LabeledField>
          )}
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Merged from {assets.filter((a) => a.status === 'tagged').length} tagged asset{assets.filter((a) => a.status === 'tagged').length === 1 ? '' : 's'} · primary assets take precedence.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InspirationContextPage() {
  const { apiKey } = useAuth();
  const [tab, setTab] = useState<Tab>('voice');

  // Voice state
  const [voice, setVoice] = useState<AuthorVoice | null>(null);
  const [docs, setDocs] = useState<VoiceDocEntry[]>([]);
  const [applyAuthorVoice, setApplyAuthorVoice] = useState(true);
  const [recencyMultiplier, setRecencyMultiplier] = useState(2);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState(0);
  const [voiceDrag, setVoiceDrag] = useState(false);
  const voiceInputRef = useRef<HTMLInputElement>(null);

  // Assets state
  const [assets, setAssets] = useState<AssetMetadata[]>([]);
  const [designKit, setDesignKit] = useState<DesignKit | null>(null);
  const [applyDesignKit, setApplyDesignKit] = useState(true);
  const [assetUploading, setAssetUploading] = useState(false);
  const [assetProgress, setAssetProgress] = useState(0);
  const [assetDrag, setAssetDrag] = useState(false);
  const assetInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);

  // Hover / menu / confirm state for right panel rows
  const [hoveredDocId, setHoveredDocId] = useState<string | null>(null);
  const [menuDocId, setMenuDocId] = useState<string | null>(null);
  const [menuDocPos, setMenuDocPos] = useState({ top: 0, right: 0 });
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState<string | null>(null);
  const docMenuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null);
  const [menuAssetId, setMenuAssetId] = useState<string | null>(null);
  const [menuAssetPos, setMenuAssetPos] = useState({ top: 0, right: 0 });
  const [confirmDeleteAsset, setConfirmDeleteAsset] = useState<string | null>(null);
  const assetMenuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const refreshVoice = useCallback(async () => {
    if (!apiKey) return;
    try {
      const [v, d] = await Promise.all([fetchAuthorVoice(apiKey), fetchVoiceDocuments(apiKey)]);
      setVoice(v); setDocs(d);
    } catch (err) { setError((err as Error).message); }
  }, [apiKey]);

  const refreshAssets = useCallback(async () => {
    if (!apiKey) return;
    try {
      const [a, kit] = await Promise.all([fetchDesignAssets(apiKey), fetchDesignKit(apiKey)]);
      setAssets(a); setDesignKit(kit);
    } catch (err) { setError((err as Error).message); }
  }, [apiKey]);

  useEffect(() => {
    if (!apiKey) return;
    void refreshVoice();
    void refreshAssets();
    fetchOrgContextSettings(apiKey)
      .then((s) => {
        setApplyAuthorVoice(s.applyAuthorVoice);
        setApplyDesignKit(s.applyDesignKit);
        setRecencyMultiplier(s.recencyMultiplier ?? 2);
      })
      .catch(() => {});
  }, [apiKey, refreshVoice, refreshAssets]);

  useEffect(() => {
    if (!docs.some((d) => d.status === 'processing')) return;
    const t = setTimeout(() => void refreshVoice(), 3000);
    return () => clearTimeout(t);
  }, [docs, refreshVoice]);

  useEffect(() => {
    if (!assets.some((a) => a.status === 'processing')) return;
    const t = setTimeout(() => void refreshAssets(), 3000);
    return () => clearTimeout(t);
  }, [assets, refreshAssets]);

  // Voice handlers
  const handleVoiceFiles = useCallback(async (files: FileList | File[]) => {
    if (!apiKey) return;
    setVoiceUploading(true); setError(null);
    try {
      for (const f of Array.from(files)) await uploadVoiceDocument(apiKey, f, setVoiceProgress);
      await refreshVoice();
    } catch (err) { setError((err as Error).message); }
    finally { setVoiceUploading(false); setVoiceProgress(0); }
  }, [apiKey, refreshVoice]);

  const onDeleteDoc = useCallback(async (id: string) => {
    if (!apiKey) return;
    try { const v = await deleteVoiceDocument(apiKey, id); setVoice(v); await refreshVoice(); }
    catch (err) { setError((err as Error).message); }
  }, [apiKey, refreshVoice]);

  const onToggleVoice = useCallback(async (next: boolean) => {
    if (!apiKey) return;
    setApplyAuthorVoice(next);
    try { await saveOrgContextSettings(apiKey, { applyAuthorVoice: next }); }
    catch (err) { setError((err as Error).message); setApplyAuthorVoice(!next); }
  }, [apiKey]);

  const onMultiplierChange = useCallback(async (next: number) => {
    if (!apiKey) return;
    const prev = recencyMultiplier;
    setRecencyMultiplier(next);
    try { await saveOrgContextSettings(apiKey, { recencyMultiplier: next }); }
    catch (err) { setError((err as Error).message); setRecencyMultiplier(prev); }
  }, [apiKey, recencyMultiplier]);

  // Asset handlers
  const handleAssetFiles = useCallback(async (files: FileList | File[]) => {
    if (!apiKey) return;
    setAssetUploading(true); setError(null);
    try {
      for (const f of Array.from(files)) await uploadDesignAsset(apiKey, f, setAssetProgress);
      await refreshAssets();
    } catch (err) { setError((err as Error).message); }
    finally { setAssetUploading(false); setAssetProgress(0); }
  }, [apiKey, refreshAssets]);

  const onDeleteAsset = useCallback(async (id: string) => {
    if (!apiKey) return;
    try { const kit = await deleteDesignAsset(apiKey, id); setDesignKit(kit); await refreshAssets(); }
    catch (err) { setError((err as Error).message); }
  }, [apiKey, refreshAssets]);

  const onTogglePrimary = useCallback(async (id: string, isPrimary: boolean) => {
    if (!apiKey) return;
    try { const updated = await setAssetPrimary(apiKey, id, isPrimary); setAssets(updated); await refreshAssets(); }
    catch (err) { setError((err as Error).message); }
  }, [apiKey, refreshAssets]);

  const onToggleDesignKit = useCallback(async (next: boolean) => {
    if (!apiKey) return;
    setApplyDesignKit(next);
    try { await saveOrgContextSettings(apiKey, { applyDesignKit: next }); }
    catch (err) { setError((err as Error).message); setApplyDesignKit(!next); }
  }, [apiKey]);

  // ── Count badge shared style ──────────────────────────────────────────────

  const countBadge = (count: number, active: boolean) => (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 16,
      height: 16,
      borderRadius: '50%',
      background: active ? 'var(--primary)' : 'var(--border)',
      color: active ? '#fff' : 'var(--muted)',
      fontSize: 10,
      fontWeight: 600,
      lineHeight: 1,
      padding: '0 4px',
      marginBottom: 1,
    }}>
      {count}
    </span>
  );

  return (
    <div className="chat-v2">
      <div className="chat-v2-center">

        {/* ── Header ── */}
        <header className="chat-v2-header">
          <div className="chat-v2-header-left">
            <button className="topbar-hamburger" aria-label="Open navigation">
              <Icon icon={Menu} size="md" />
            </button>
            <span className="chat-v2-ns">Inspiration</span>
            <span style={{ fontSize: 13, color: 'var(--muted)', display: 'none' }} className="proposal-header-extra">
              Past proposals &amp; brand assets
            </span>
          </div>
          <div className="chat-v2-header-right">
            <ThemeToggle />
          </div>
        </header>

        {/* ── Left: main content ── */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', padding: '28px 32px 40px' }}>

            {error && (
              <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: 16 }}>
                {error}
              </div>
            )}

        {/* ── Tab bar ── */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
          {(['voice', 'assets'] as Tab[]).map((t) => {
            const label = t === 'voice' ? 'Past proposals' : 'Assets';
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--primary)' : 'var(--muted)',
                  cursor: 'pointer',
                  marginBottom: -1,
                  transition: 'color 0.15s, border-color 0.15s',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* ── Past Proposals tab ── */}
        {tab === 'voice' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <VoiceContextCard
              voice={voice} docs={docs}
              applyAuthorVoice={applyAuthorVoice}
              onToggle={(v) => void onToggleVoice(v)}
              onRecompute={() => { void recomputeAuthorVoice(apiKey!).then(setVoice).catch((e: Error) => setError(e.message)); }}
              recencyMultiplier={recencyMultiplier}
              onMultiplierChange={(v: number) => void onMultiplierChange(v)}
              uploading={voiceUploading} progress={voiceProgress} dragActive={voiceDrag}
              inputRef={voiceInputRef}
              onDragOver={(e) => { e.preventDefault(); setVoiceDrag(true); }}
              onDragLeave={() => setVoiceDrag(false)}
              onDrop={(e) => { e.preventDefault(); setVoiceDrag(false); if (e.dataTransfer.files) void handleVoiceFiles(e.dataTransfer.files); }}
              onFiles={(files) => void handleVoiceFiles(files)}
            />

          </div>
        )}

        {/* ── Assets tab ── */}
        {tab === 'assets' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <DesignKitCard
              kit={designKit} assets={assets}
              applyDesignKit={applyDesignKit}
              onToggle={(v) => void onToggleDesignKit(v)}
              onRecompute={() => { void recomputeDesignKit(apiKey!).then(setDesignKit).catch((e: Error) => setError(e.message)); }}
              uploading={assetUploading} progress={assetProgress} dragActive={assetDrag}
              inputRef={assetInputRef}
              onDragOver={(e) => { e.preventDefault(); setAssetDrag(true); }}
              onDragLeave={() => setAssetDrag(false)}
              onDrop={(e) => { e.preventDefault(); setAssetDrag(false); if (e.dataTransfer.files) void handleAssetFiles(e.dataTransfer.files); }}
              onFiles={(files) => void handleAssetFiles(files)}
            />


          </div>
        )}
      </div>
      </div>{/* end chat-v2-center */}

      {/* ── Right panel ── */}
      <div
        style={{
          width: 300,
          minWidth: 0,
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          background: 'var(--panel)',
        }}
      >
        <div className="client-panel">

          {/* ── Tab bar ── */}
          <div className="client-panel-tabs" style={{ height: 48 }}>
            <button
              className={`client-panel-tab${tab === 'voice' ? ' active' : ''}`}
              onClick={() => setTab('voice')}
              style={{ gap: 5 }}
            >
              Proposals
              {docs.length > 0 && countBadge(docs.length, tab === 'voice')}
            </button>
            <button
              className={`client-panel-tab${tab === 'assets' ? ' active' : ''}`}
              onClick={() => setTab('assets')}
              style={{ gap: 5 }}
            >
              Assets
              {assets.length > 0 && countBadge(assets.length, tab === 'assets')}
            </button>
          </div>

          {/* ── Panel body ── */}
          <div className="client-panel-body">

            {/* Proposals list */}
            {tab === 'voice' && (
              <div
                className="client-panel-list"
                style={{ paddingTop: 8, paddingLeft: 12, paddingRight: 12 }}
              >
                {/* Section header + upload */}
                <div
                  className="brief-panel-section-header"
                  style={{ padding: '0 4px 6px', display: 'flex', alignItems: 'center' }}
                >
                  <span style={{
                    flex: 'none',
                    fontSize: 14,
                    fontWeight: 400,
                    color: 'var(--muted)',
                    textTransform: 'none',
                    letterSpacing: 0,
                  }}>
                    Past proposals
                  </span>
                  <button
                    className="brief-knowledge-icon-btn"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => voiceInputRef.current?.click()}
                    title="Upload"
                  >
                    <Plus size={16} />
                  </button>
                </div>

                {docs.length === 0 && !voiceUploading ? (
                  <div style={{ padding: '4px 2px', fontSize: 13, color: 'var(--muted)', opacity: 0.5 }}>
                    Upload .pdf, .docx, .txt, .md, or images.
                  </div>
                ) : (
                  docs.map((doc) => {
                    const isHov = hoveredDocId === doc.id;
                    const menuOpen = menuDocId === doc.id;
                    return (
                      <div
                        key={doc.id}
                        style={{ position: 'relative' }}
                        onMouseEnter={() => setHoveredDocId(doc.id)}
                        onMouseLeave={() => setHoveredDocId(null)}
                      >
                        <div
                          className="client-panel-row"
                          style={{ paddingRight: isHov || menuOpen ? 36 : 10, cursor: 'default' }}
                        >
                          <span className="client-panel-row-name">{doc.sourceDocument}</span>
                          {doc.status === 'processing' && (
                            <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--primary)' }}>
                              <Loader size={10} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />
                              Processing
                            </span>
                          )}
                          {doc.status === 'extracted' && (
                            <span
                              className="ingestion-badge--indexed"
                              style={{ flexShrink: 0, fontSize: 10, fontWeight: 500, background: 'transparent', border: 'none' }}
                            >
                              INDEXED
                            </span>
                          )}
                          {doc.status === 'failed' && (
                            <span
                              className="ingestion-badge--failed"
                              style={{ flexShrink: 0, fontSize: 10, fontWeight: 500, background: 'transparent', border: 'none' }}
                            >
                              FAILED
                            </span>
                          )}
                        </div>
                        <button
                          ref={(el) => { docMenuBtnRefs.current[doc.id] = el; }}
                          className="btn btn-sm client-panel-row-menu"
                          title="Options"
                          style={{
                            position: 'absolute',
                            right: 10,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            padding: '1px 5px',
                            border: 'none',
                            lineHeight: 1,
                            opacity: isHov || menuOpen ? 1 : 0,
                            pointerEvents: isHov || menuOpen ? 'auto' : 'none',
                            transition: 'opacity 0.15s',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            const btn = docMenuBtnRefs.current[doc.id];
                            if (!btn) return;
                            const rect = btn.getBoundingClientRect();
                            setMenuDocPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                            setMenuDocId(menuOpen ? null : doc.id);
                          }}
                        >
                          <MoreHorizontal size={13} />
                        </button>
                      </div>
                    );
                  })
                )}

                {voiceUploading && (
                  <div className="client-panel-row" style={{ cursor: 'default' }}>
                    <Loader
                      size={13}
                      strokeWidth={2}
                      style={{ animation: 'spin 1s linear infinite', flexShrink: 0, color: 'var(--primary)' }}
                    />
                    <span className="client-panel-row-name" style={{ color: 'var(--primary)' }}>
                      Uploading… {voiceProgress}%
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Assets list */}
            {tab === 'assets' && (
              <div
                className="client-panel-list"
                style={{ paddingTop: 8, paddingLeft: 12, paddingRight: 12 }}
              >
                {/* Section header + upload */}
                <div
                  className="brief-panel-section-header"
                  style={{ padding: '0 4px 6px', display: 'flex', alignItems: 'center' }}
                >
                  <span style={{
                    flex: 'none',
                    fontSize: 14,
                    fontWeight: 400,
                    color: 'var(--muted)',
                    textTransform: 'none',
                    letterSpacing: 0,
                  }}>
                    Brand assets
                  </span>
                  <button
                    className="brief-knowledge-icon-btn"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => assetInputRef.current?.click()}
                    title="Upload"
                  >
                    <Plus size={16} />
                  </button>
                </div>

                {assets.length === 0 && !assetUploading ? (
                  <div style={{ padding: '4px 2px', fontSize: 13, color: 'var(--muted)', opacity: 0.5 }}>
                    Upload .png, .jpg, .webp, .gif, or .svg files.
                  </div>
                ) : (
                  assets.map((asset) => {
                    const isHov = hoveredAssetId === asset.id;
                    const menuOpen = menuAssetId === asset.id;
                    return (
                      <div
                        key={asset.id}
                        style={{ position: 'relative' }}
                        onMouseEnter={() => setHoveredAssetId(asset.id)}
                        onMouseLeave={() => setHoveredAssetId(null)}
                      >
                        <div
                          className="client-panel-row"
                          style={{ paddingRight: isHov || menuOpen ? 36 : 10, cursor: 'default', flexDirection: 'column', alignItems: 'flex-start', gap: 2, height: 'auto', minHeight: 32, padding: `4px ${isHov || menuOpen ? 36 : 10}px 4px 10px` }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 0 }}>
                            <span className="client-panel-row-name">{asset.fileName}</span>
                            {asset.status === 'processing' && (
                              <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--primary)' }}>
                                <Loader size={10} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />
                                Processing
                              </span>
                            )}
                            {asset.status === 'tagged' && (
                              <span
                                className="ingestion-badge--indexed"
                                style={{ flexShrink: 0, fontSize: 10, fontWeight: 500, background: 'transparent', border: 'none' }}
                              >
                                INDEXED
                              </span>
                            )}
                            {asset.status === 'failed' && (
                              <span
                                className="ingestion-badge--failed"
                                style={{ flexShrink: 0, fontSize: 10, fontWeight: 500, background: 'transparent', border: 'none' }}
                              >
                                FAILED
                              </span>
                            )}
                          </div>
                          {asset.status === 'tagged' && (
                            <label
                              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--muted)', cursor: 'pointer', paddingLeft: 1 }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={asset.isPrimary}
                                onChange={(e) => void onTogglePrimary(asset.id, e.target.checked)}
                                style={{ width: 11, height: 11 }}
                              />
                              Primary
                            </label>
                          )}
                        </div>
                        <button
                          ref={(el) => { assetMenuBtnRefs.current[asset.id] = el; }}
                          className="btn btn-sm client-panel-row-menu"
                          title="Options"
                          style={{
                            position: 'absolute',
                            right: 10,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            padding: '1px 5px',
                            border: 'none',
                            lineHeight: 1,
                            opacity: isHov || menuOpen ? 1 : 0,
                            pointerEvents: isHov || menuOpen ? 'auto' : 'none',
                            transition: 'opacity 0.15s',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            const btn = assetMenuBtnRefs.current[asset.id];
                            if (!btn) return;
                            const rect = btn.getBoundingClientRect();
                            setMenuAssetPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                            setMenuAssetId(menuOpen ? null : asset.id);
                          }}
                        >
                          <MoreHorizontal size={13} />
                        </button>
                      </div>
                    );
                  })
                )}

                {assetUploading && (
                  <div className="client-panel-row" style={{ cursor: 'default' }}>
                    <Loader
                      size={13}
                      strokeWidth={2}
                      style={{ animation: 'spin 1s linear infinite', flexShrink: 0, color: 'var(--primary)' }}
                    />
                    <span className="client-panel-row-name" style={{ color: 'var(--primary)' }}>
                      Uploading… {assetProgress}%
                    </span>
                  </div>
                )}
              </div>
            )}

          </div>{/* end client-panel-body */}
        </div>{/* end client-panel */}
      </div>{/* end right panel */}

      {/* ── Doc row context menu ── */}
      {menuDocId && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 99998 }} onClick={() => setMenuDocId(null)} />
          <div className="card" style={{ position: 'fixed', top: menuDocPos.top, right: menuDocPos.right, minWidth: 120, padding: '4px 0', zIndex: 99999 }}>
            <button
              className="btn btn-sm"
              style={{ width: '100%', textAlign: 'left', borderRadius: 0, border: 'none', justifyContent: 'flex-start', padding: '8px 14px', fontSize: 14, color: 'var(--danger)', gap: 8 }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { const id = menuDocId; setMenuDocId(null); setConfirmDeleteDoc(id); }}
            >
              <Icon icon={Trash2} size="sm" />
              <span>Delete</span>
            </button>
          </div>
        </>,
        document.body,
      )}

      {/* ── Asset row context menu ── */}
      {menuAssetId && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 99998 }} onClick={() => setMenuAssetId(null)} />
          <div className="card" style={{ position: 'fixed', top: menuAssetPos.top, right: menuAssetPos.right, minWidth: 120, padding: '4px 0', zIndex: 99999 }}>
            <button
              className="btn btn-sm"
              style={{ width: '100%', textAlign: 'left', borderRadius: 0, border: 'none', justifyContent: 'flex-start', padding: '8px 14px', fontSize: 14, color: 'var(--danger)', gap: 8 }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { const id = menuAssetId; setMenuAssetId(null); setConfirmDeleteAsset(id); }}
            >
              <Icon icon={Trash2} size="sm" />
              <span>Delete</span>
            </button>
          </div>
        </>,
        document.body,
      )}

      {/* ── Confirm delete dialogs ── */}
      {confirmDeleteDoc && (
        <ConfirmDialog
          title="Delete document"
          message={`Delete "${docs.find((d) => d.id === confirmDeleteDoc)?.sourceDocument ?? confirmDeleteDoc}"? This will remove it from the knowledge base and cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={async () => { await onDeleteDoc(confirmDeleteDoc); setConfirmDeleteDoc(null); }}
          onCancel={() => setConfirmDeleteDoc(null)}
        />
      )}
      {confirmDeleteAsset && (
        <ConfirmDialog
          title="Delete asset"
          message={`Delete "${assets.find((a) => a.id === confirmDeleteAsset)?.fileName ?? confirmDeleteAsset}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={async () => { await onDeleteAsset(confirmDeleteAsset); setConfirmDeleteAsset(null); }}
          onCancel={() => setConfirmDeleteAsset(null)}
        />
      )}
    </div>
  );
}
