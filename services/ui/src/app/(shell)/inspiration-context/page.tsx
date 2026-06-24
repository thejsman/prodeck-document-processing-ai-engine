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
      border: '1px solid var(--border)',
      color: 'var(--text)',
      whiteSpace: 'nowrap',
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

// ── Author Voice context card ─────────────────────────────────────────────────

function VoiceContextCard({
  voice,
  docs,
  applyAuthorVoice,
  onToggle,
  onRecompute,
}: {
  voice: AuthorVoice | null;
  docs: VoiceDocEntry[];
  applyAuthorVoice: boolean;
  onToggle: (v: boolean) => void;
  onRecompute: () => void;
}) {
  const extracted = docs.filter((d) => d.status === 'extracted').length;
  const hasVoice = voice && voice.docCount > 0;

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 20,
      background: 'var(--panel-soft)',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          Author Voice Context
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {hasVoice && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--success, #16a34a)', fontWeight: 500 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success, #16a34a)', display: 'inline-block' }} />
              Active · {extracted} proposal{extracted === 1 ? '' : 's'} analysed
            </span>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--muted)' }}>
            <input type="checkbox" checked={applyAuthorVoice} onChange={(e) => onToggle(e.target.checked)} />
            Apply
          </label>
          {hasVoice && (
            <button className="btn btn-sm" onClick={onRecompute} style={{ fontSize: 12 }}>Recompute</button>
          )}
        </div>
      </div>

      {!hasVoice ? (
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          No voice learned yet. Upload past proposals below — we extract tone, structure, and phrasing. No client facts are stored.
        </p>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
            {[
              voice.openingStyle && `Proposals ${voice.openingStyle.toLowerCase()}.`,
              voice.sectionPatterns.length > 0 && `Sections consistently include: ${voice.sectionPatterns.slice(0, 4).join(', ')}.`,
              voice.tone.length > 0 && `Tone is ${voice.tone.slice(0, 3).join(', ')}.`,
              voice.closingStyle && `${voice.closingStyle}.`,
            ].filter(Boolean).join(' ')}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[...voice.recurringPhrases.slice(0, 3).map((p) => p.value),
              ...voice.persuasionPatterns.slice(0, 2).map((p) => p.value),
              ...voice.formatting.slice(0, 2),
            ].filter(Boolean).map((label, i) => <Chip key={`${label}-${i}`} label={label} />)}
          </div>
        </>
      )}
    </div>
  );
}

// ── Design Kit context card ───────────────────────────────────────────────────

function DesignKitCard({
  kit,
  assets,
  applyDesignKit,
  onToggle,
  onRecompute,
}: {
  kit: DesignKit | null;
  assets: AssetMetadata[];
  applyDesignKit: boolean;
  onToggle: (v: boolean) => void;
  onRecompute: () => void;
}) {
  const tagged = assets.filter((a) => a.status === 'tagged').length;
  const hasKit = kit && kit.primaryColor;

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 20,
      background: 'var(--panel-soft)',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          Design Kit
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {hasKit && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--success, #16a34a)', fontWeight: 500 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success, #16a34a)', display: 'inline-block' }} />
              Active · {tagged} asset{tagged === 1 ? '' : 's'} tagged
            </span>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--muted)' }}>
            <input type="checkbox" checked={applyDesignKit} onChange={(e) => onToggle(e.target.checked)} />
            Apply
          </label>
          {hasKit && (
            <button className="btn btn-sm" onClick={onRecompute} style={{ fontSize: 12 }}>Recompute</button>
          )}
        </div>
      </div>

      {!hasKit ? (
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          No design kit yet. Upload logos, palettes, and brand images below — we extract colors and style for microsites.
        </p>
      ) : (
        <>
          {kit.designBrief && (
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>{kit.designBrief}</p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {kit.palette.map((hex) => (
              <div key={hex} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <ColorSwatch hex={hex} />
                <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{hex}</span>
              </div>
            ))}
          </div>
          {kit.fontHints.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {kit.fontHints.map((h, i) => <Chip key={`${h}-${i}`} label={h} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── File rows ─────────────────────────────────────────────────────────────────

function DocRow({ doc, onDelete }: { doc: VoiceDocEntry; onDelete: (id: string) => void }) {
  const statusColor =
    doc.status === 'extracted' ? 'var(--success, #16a34a)'
    : doc.status === 'failed' ? 'var(--danger, #dc2626)'
    : 'var(--warning, #d97706)';
  const statusLabel = doc.status === 'extracted' ? 'Indexed' : doc.status === 'failed' ? 'Failed' : 'Processing…';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--panel-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14 }}>
        📄
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.sourceDocument}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Uploaded</div>
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: statusColor, border: `1px solid ${statusColor}`, borderRadius: 999, padding: '2px 10px', whiteSpace: 'nowrap' }}>
        {statusLabel}
      </span>
      <button className="btn btn-sm" onClick={() => onDelete(doc.id)} style={{ fontSize: 12 }}>Remove</button>
    </div>
  );
}

function AssetRow({
  asset,
  onDelete,
  onTogglePrimary,
}: {
  asset: AssetMetadata;
  onDelete: (id: string) => void;
  onTogglePrimary: (id: string, isPrimary: boolean) => void;
}) {
  const statusColor =
    asset.status === 'tagged' ? 'var(--success, #16a34a)'
    : asset.status === 'failed' ? 'var(--danger, #dc2626)'
    : 'var(--warning, #d97706)';
  const statusLabel = asset.status === 'tagged' ? 'Indexed' : asset.status === 'failed' ? 'Failed' : 'Processing…';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: asset.palette[0] ?? 'var(--panel-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
        {!asset.palette[0] && '🖼'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.fileName}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'capitalize' }}>{asset.assetType !== 'other' ? asset.assetType : ''}</div>
      </div>
      {asset.status === 'tagged' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={asset.isPrimary} onChange={(e) => onTogglePrimary(asset.id, e.target.checked)} />
          Primary
        </label>
      )}
      <span style={{ fontSize: 12, fontWeight: 600, color: statusColor, border: `1px solid ${statusColor}`, borderRadius: 999, padding: '2px 10px', whiteSpace: 'nowrap' }}>
        {statusLabel}
      </span>
      <button className="btn btn-sm" onClick={() => onDelete(asset.id)} style={{ fontSize: 12 }}>Remove</button>
    </div>
  );
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

function DropZone({
  accept,
  uploading,
  progress,
  dragActive,
  hint,
  inputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onFiles,
}: {
  accept: string;
  uploading: boolean;
  progress: number;
  dragActive: boolean;
  hint: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onFiles: (files: FileList) => void;
}) {
  return (
    <div
      className={`upload-zone${dragActive ? ' upload-zone-active' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" multiple accept={accept} style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ''; }} />
      <div className="upload-zone-content">
        <span className="upload-zone-icon" style={{ fontSize: 28 }}>&#x2B06;</span>
        <p style={{ margin: '6px 0 2px', fontSize: 14 }}>
          {uploading ? `Uploading… ${progress}%` : 'Drop files here to expand context'}
        </p>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>{hint}</p>
      </div>
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
      .then((s) => { setApplyAuthorVoice(s.applyAuthorVoice); setApplyDesignKit(s.applyDesignKit); })
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

  return (
    <>
      <div className="page-header">
        <h1>Inspiration</h1>
        <p className="muted">Past proposals &amp; brand assets · informs every generation</p>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: 0 }}>
          {error}
        </div>
      )}

      {/* ── Tab bar ────────────────────────────────────────────────── */}
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

      {/* ── Past Proposals tab ─────────────────────────────────────── */}
      {tab === 'voice' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <VoiceContextCard
            voice={voice}
            docs={docs}
            applyAuthorVoice={applyAuthorVoice}
            onToggle={(v) => void onToggleVoice(v)}
            onRecompute={() => { void recomputeAuthorVoice(apiKey!).then(setVoice).catch((e: Error) => setError(e.message)); }}
          />

          <DropZone
            accept={ACCEPTED_VOICE}
            uploading={voiceUploading}
            progress={voiceProgress}
            dragActive={voiceDrag}
            hint="PDF · DOCX · MD · TXT · PNG · JPG — no facts stored, only style"
            inputRef={voiceInputRef}
            onDragOver={(e) => { e.preventDefault(); setVoiceDrag(true); }}
            onDragLeave={() => setVoiceDrag(false)}
            onDrop={(e) => { e.preventDefault(); setVoiceDrag(false); if (e.dataTransfer.files) void handleVoiceFiles(e.dataTransfer.files); }}
            onFiles={(files) => void handleVoiceFiles(files)}
          />

          {/* ── Learned Voice detail ─────────────────────────────── */}
          {voice && voice.docCount > 0 && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                Learned Voice
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <LabeledField label={`Tone — ${voice.formality}`}>
                  <ChipRow items={voice.tone} />
                </LabeledField>
                <LabeledField label="Typical structure">
                  <ChipRow items={voice.sectionPatterns} />
                </LabeledField>
                {(voice.openingStyle || voice.closingStyle) && (
                  <LabeledField label="Opening &amp; closing">
                    <div style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
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
              </div>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Merged from {voice.docCount} document{voice.docCount === 1 ? '' : 's'} · recent uploads weighted higher.
              </p>
            </div>
          )}

          {docs.length > 0 && (
            <div className="card" style={{ padding: '4px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', padding: '12px 0 4px' }}>
                {docs.length} Proposal{docs.length === 1 ? '' : 's'}
              </div>
              {docs.map((d) => <DocRow key={d.id} doc={d} onDelete={(id) => void onDeleteDoc(id)} />)}
            </div>
          )}
        </div>
      )}

      {/* ── Assets tab ─────────────────────────────────────────────── */}
      {tab === 'assets' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <DesignKitCard
            kit={designKit}
            assets={assets}
            applyDesignKit={applyDesignKit}
            onToggle={(v) => void onToggleDesignKit(v)}
            onRecompute={() => { void recomputeDesignKit(apiKey!).then(setDesignKit).catch((e: Error) => setError(e.message)); }}
          />

          {/* ── Design Kit detail ────────────────────────────────── */}
          {designKit && designKit.primaryColor && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                Design Kit Preview
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <LabeledField label="Brand palette">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {designKit.palette.map((hex) => (
                      <div key={hex} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: hex, border: '1px solid var(--border)' }} />
                        <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>{hex}</span>
                      </div>
                    ))}
                  </div>
                </LabeledField>
                {designKit.fontHints.length > 0 && (
                  <LabeledField label="Typography hints">
                    <ChipRow items={designKit.fontHints} />
                  </LabeledField>
                )}
                {designKit.designBrief && (
                  <LabeledField label="Design brief">
                    <p style={{ fontSize: 14, margin: 0, lineHeight: 1.6 }}>{designKit.designBrief}</p>
                  </LabeledField>
                )}
                {(designKit.logoAssetId || designKit.heroAssetId) && (
                  <LabeledField label="Selected assets">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
                      {designKit.logoAssetId && (
                        <span>
                          <strong>Logo:</strong>{' '}
                          {assets.find((a) => a.id === designKit.logoAssetId)?.fileName ?? designKit.logoAssetId.slice(0, 8)}
                        </span>
                      )}
                      {designKit.heroAssetId && (
                        <span>
                          <strong>Hero:</strong>{' '}
                          {assets.find((a) => a.id === designKit.heroAssetId)?.fileName ?? designKit.heroAssetId.slice(0, 8)}
                        </span>
                      )}
                    </div>
                  </LabeledField>
                )}
              </div>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Merged from {assets.filter((a) => a.status === 'tagged').length} tagged asset{assets.filter((a) => a.status === 'tagged').length === 1 ? '' : 's'} · primary assets take precedence.
              </p>
            </div>
          )}

          <DropZone
            accept={ACCEPTED_ASSETS}
            uploading={assetUploading}
            progress={assetProgress}
            dragActive={assetDrag}
            hint="PNG · JPG · WEBP · GIF · SVG — logos, palettes, hero images"
            inputRef={assetInputRef}
            onDragOver={(e) => { e.preventDefault(); setAssetDrag(true); }}
            onDragLeave={() => setAssetDrag(false)}
            onDrop={(e) => { e.preventDefault(); setAssetDrag(false); if (e.dataTransfer.files) void handleAssetFiles(e.dataTransfer.files); }}
            onFiles={(files) => void handleAssetFiles(files)}
          />

          {assets.length > 0 && (
            <div className="card" style={{ padding: '4px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', padding: '12px 0 4px' }}>
                {assets.length} Asset{assets.length === 1 ? '' : 's'}
              </div>
              {assets.map((a) => (
                <AssetRow
                  key={a.id}
                  asset={a}
                  onDelete={(id) => void onDeleteAsset(id)}
                  onTogglePrimary={(id, p) => void onTogglePrimary(id, p)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
