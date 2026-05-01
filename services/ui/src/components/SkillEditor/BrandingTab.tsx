'use client';

import { useRef, useState } from 'react';
import type { MicrositeDefaultsApi, AssetInfoApi } from '@/lib/api';
import { AIAssistBlock } from './AIAssistBlock';

const THEMES = [
  'Obsidian Luxury',
  'Ivory Editorial',
  'Cobalt Executive',
  'Slate Modern',
  'Forest Trust',
  'Ember Bold',
];

interface BrandingTabProps {
  micrositeDefaults: MicrositeDefaultsApi;
  assets: AssetInfoApi[];
  onChange: (defaults: MicrositeDefaultsApi) => void;
  onAssetUpload: (file: File) => Promise<void>;
  onAssetDelete: (fileName: string) => Promise<void>;
  onAIAssist: (instruction: string) => Promise<void>;
}

function fieldStyle(): React.CSSProperties {
  return {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '7px 10px',
    color: 'var(--text)',
    fontSize: 13,
    boxSizing: 'border-box',
    outline: 'none',
    fontFamily: 'inherit',
    width: '100%',
  };
}

export function BrandingTab({
  micrositeDefaults,
  assets,
  onChange,
  onAssetUpload,
  onAssetDelete,
  onAIAssist,
}: BrandingTabProps) {
  const md = micrositeDefaults;
  const upd = (patch: Partial<MicrositeDefaultsApi>) => onChange({ ...md, ...patch });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await onAssetUpload(file);
      }
    } finally {
      setUploading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <p style={{ fontSize: 12, color: 'var(--muted)' }}>
        These defaults pre-fill the Presentation Builder when creating microsites from proposals made with this skill.
      </p>

      {/* Tagline */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Tagline
        </label>
        <input
          value={md.tagline ?? ''}
          onChange={(e) => upd({ tagline: e.target.value || undefined })}
          placeholder="Innovation Delivered"
          style={fieldStyle()}
        />
      </div>

      {/* Colors */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Primary Color
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="color"
              value={md.primaryColor ?? '#1a3a5c'}
              onChange={(e) => upd({ primaryColor: e.target.value })}
              style={{ width: 36, height: 32, border: '1px solid var(--border)', borderRadius: 4, padding: 2, cursor: 'pointer', background: 'none' }}
            />
            <input
              value={md.primaryColor ?? ''}
              onChange={(e) => upd({ primaryColor: e.target.value || undefined })}
              placeholder="#1a3a5c"
              style={{ ...fieldStyle(), flex: 1 }}
            />
          </div>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Secondary Color
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="color"
              value={md.secondaryColor ?? '#c8a96e'}
              onChange={(e) => upd({ secondaryColor: e.target.value })}
              style={{ width: 36, height: 32, border: '1px solid var(--border)', borderRadius: 4, padding: 2, cursor: 'pointer', background: 'none' }}
            />
            <input
              value={md.secondaryColor ?? ''}
              onChange={(e) => upd({ secondaryColor: e.target.value || undefined })}
              placeholder="#c8a96e"
              style={{ ...fieldStyle(), flex: 1 }}
            />
          </div>
        </div>
      </div>

      {/* Theme selector */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Theme
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {THEMES.map((theme) => (
            <button
              key={theme}
              onClick={() => upd({ theme })}
              style={{
                border: `2px solid ${md.theme === theme ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: 8,
                padding: '10px 8px',
                background: md.theme === theme ? 'var(--primary-soft, rgba(var(--primary-rgb,0,0,0),0.1))' : 'var(--panel)',
                cursor: 'pointer',
                textAlign: 'center',
                fontSize: 11,
                fontWeight: 500,
                color: md.theme === theme ? 'var(--primary)' : 'var(--text)',
                transition: 'border-color 0.15s',
              }}
            >
              {theme}
              {md.theme === theme && <div style={{ fontSize: 10, color: 'var(--primary)', marginTop: 2 }}>✓ Active</div>}
            </button>
          ))}
        </div>
      </div>

      {/* Assets upload */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Assets
        </label>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          Upload files that sections can reference — compliance docs, case studies, boilerplate text.
        </p>

        {/* Drop zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            e.preventDefault();
            await handleFileSelect(e.dataTransfer.files);
          }}
          style={{
            border: '2px dashed var(--border)',
            borderRadius: 8,
            padding: '24px 16px',
            textAlign: 'center',
            cursor: uploading ? 'wait' : 'pointer',
            background: 'var(--panel-soft, var(--panel))',
            marginBottom: 12,
          }}
        >
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
            {uploading ? 'Uploading…' : '↑ Drag and drop files, or click to browse'}
          </p>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            Accepted: .md, .txt, .json, .png, .svg — Max 10 MB
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".md,.txt,.json,.png,.svg,.jpg,.jpeg"
          style={{ display: 'none' }}
          onChange={(e) => handleFileSelect(e.target.files)}
        />

        {/* Asset list */}
        {assets.length > 0 && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto auto',
              gap: 8,
              padding: '6px 12px',
              background: 'var(--panel-soft, var(--panel))',
              borderBottom: '1px solid var(--border)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>
              <span>File</span>
              <span>Size</span>
              <span>Used By</span>
              <span></span>
            </div>
            {assets.map((asset) => (
              <div
                key={asset.fileName}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto auto',
                  gap: 8,
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 12,
                  alignItems: 'center',
                }}
              >
                <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {asset.fileName}
                </span>
                <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatBytes(asset.sizeBytes)}</span>
                <span style={{ color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
                  {asset.referencedBySections.length > 0
                    ? asset.referencedBySections.join(', ')
                    : '—'}
                </span>
                <button
                  onClick={() => onAssetDelete(asset.fileName)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger, #e53e3e)', fontSize: 12, padding: '0 4px' }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <AIAssistBlock
        placeholder={`e.g. "Change the theme to Cobalt Executive and update colors to match"`}
        onApply={onAIAssist}
      />
    </div>
  );
}
