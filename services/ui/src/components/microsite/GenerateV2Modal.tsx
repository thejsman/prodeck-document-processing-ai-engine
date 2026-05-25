'use client';

import { useState, useRef, useCallback } from 'react';
import { X, CheckCircle, ImageIcon } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { generateMicrositeV2Stream } from '@/lib/api';
import type { LayoutAST, LayoutSection } from '@/types/presentation';

interface Props {
  apiKey: string;
  namespace: string;
  proposalId: string;
  proposalName: string;
  proposalMarkdown: string;
  onComplete: (ast: LayoutAST) => void;
  onClose: () => void;
}

type Step = 'configure' | 'generate';


export function GenerateV2Modal({
  apiKey, namespace, proposalId, proposalName, proposalMarkdown,
  onComplete, onClose,
}: Props) {
  const [step, setStep] = useState<Step>('configure');

  // Step 1 — configure
  const [instructions, setInstructions] = useState('');
  const [referenceImage, setReferenceImage] = useState<{ base64: string; mediaType: string; preview: string } | null>(null);
  const [imageExtracting, setImageExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Step 3 — generate
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const astRef = useRef<LayoutAST | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Image handling ──────────────────────────────────────────────────────────

  const handleImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    setImageExtracting(true);

    const compress = (dataUrl: string, maxBytes = 4 * 1024 * 1024): Promise<string> =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img;
          // Scale down if needed so base64 fits under maxBytes (rough: 1px ≈ 3 bytes pre-base64)
          const area = maxBytes * 0.72; // base64 overhead is ~4/3
          const scale = Math.min(1, Math.sqrt(area / (width * height * 3)));
          canvas.width  = Math.round(width  * scale);
          canvas.height = Math.round(height * scale);
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
          // Try JPEG quality 0.85; drop to 0.70 if still too big
          let out = canvas.toDataURL('image/jpeg', 0.85);
          if (out.length * 0.75 > maxBytes) out = canvas.toDataURL('image/jpeg', 0.70);
          resolve(out);
        };
        img.src = dataUrl;
      });

    const reader = new FileReader();
    reader.onload = async (e) => {
      const raw = e.target?.result as string;
      const dataUrl = await compress(raw);
      const [header, base64] = dataUrl.split(',');
      const mediaType = header.replace('data:', '').replace(';base64', '');
      setReferenceImage({ base64, mediaType, preview: raw }); // preview uses original for sharpness
      setImageExtracting(false);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  }, [handleImageFile]);

  // ── Generate ────────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    setStep('generate');
    setProgressLines(['Connecting…']);
    setGenerateError(null);
    setDone(false);
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      await generateMicrositeV2Stream(apiKey, namespace, proposalId, {
        proposalMarkdown,
        userPrompt: instructions.trim() || undefined,
        referenceImage: referenceImage ? { base64: referenceImage.base64, mediaType: referenceImage.mediaType } : undefined,
        signal: abort.signal,
        onEvent(event) {
          if (event.type === 'start') {
            setProgressLines(['Pipeline started ✓']);
          } else if (event.type === 'progress') {
            const e = event as { type: 'progress'; message: string };
            setProgressLines(p => [...p, e.message]);
          } else if (event.type === 'plan') {
            const e = event as { type: 'plan'; totalSections: number };
            setProgressLines(p => [...p, `Plan ready — ${e.totalSections} sections ✓`]);
          } else if (event.type === 'section') {
            const e = event as { type: 'section'; heading: string; index?: number };
            setProgressLines(p => [...p, `${e.heading}…`]);

            if (astRef.current) {
              const ev = event as typeof event & { customHtml?: string };
              const newSection = {
                id: event.id,
                heading: event.heading,
                sectionType: event.sectionType as LayoutSection['sectionType'],
                content: (event.content ?? { headline: event.heading }) as unknown as LayoutSection['content'],
                customHtml: ev.customHtml,
                image: (event.image as LayoutSection['image']) ?? { source: 'gradient', query: '', url: null, fallback: 'gradient-mesh' },
                editable: true,
                version: 1,
              };
              const sections = [...astRef.current.sections];
              sections.splice((event as { index?: number }).index ?? sections.length, 0, newSection as LayoutSection);
              astRef.current = { ...astRef.current, sections };
            }
          } else if (event.type === 'complete') {
            const raw = (event as { type: 'complete'; ast: unknown }).ast;
            if (raw && typeof raw === 'object') {
              astRef.current = raw as LayoutAST;
              (astRef.current as LayoutAST).generationMode = 'v2';
            }
            setProgressLines(p => [...p, 'Done ✓']);
            setDone(true);
          } else if (event.type === 'error') {
            throw new Error((event as { type: 'error'; message: string }).message ?? 'Generation failed');
          }
        },
      });
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      setGenerateError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleView = () => {
    if (astRef.current) {
      onComplete(astRef.current);
      onClose();
    }
  };

  const handleFullPage = () => {
    const ast = astRef.current;
    if (!ast) return;
    const fonts = ast.brand?.googleFontsUrl
      ? `<link rel="stylesheet" href="${ast.brand.googleFontsUrl}">` : '';
    const sectionsHtml = ast.sections
      .map(s => (s as LayoutSection & { customHtml?: string }).customHtml ?? '')
      .join('\n');
    const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ast.meta?.client || 'Microsite'}</title>
${fonts}
<style>*{box-sizing:border-box;margin:0;padding:0}body{line-height:1.6}nav,header,[style*="position:fixed"],[style*="position: fixed"]{position:relative!important;top:auto!important;}</style>
</head><body>${sectionsHtml}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  // ── Shared styles ───────────────────────────────────────────────────────────

  const modalBox: React.CSSProperties = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius)',
    boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
    width: '100%',
    maxWidth: step === 'configure' ? 500 : 500,
    padding: 28,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  };

  const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    marginBottom: 6,
  };

  const textarea: React.CSSProperties = {
    width: '100%',
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    padding: '10px 12px',
    fontSize: 13,
    color: 'var(--text)',
    resize: 'vertical',
    minHeight: 90,
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const btn = (variant: 'primary' | 'ghost'): React.CSSProperties => ({
    height: 34,
    padding: '0 20px',
    background: variant === 'primary' ? 'var(--primary)' : 'none',
    color: variant === 'primary' ? '#fff' : 'var(--text-muted)',
    border: variant === 'primary' ? 'none' : '1px solid var(--color-border)',
    borderRadius: 'var(--radius)',
    fontSize: 13,
    fontWeight: variant === 'primary' ? 500 : 400,
    cursor: 'pointer',
  });

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && step !== 'generate') handleClose(); }}
    >
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
              {step === 'configure' && 'Generate Microsite'}
              {step === 'generate' && 'Generating'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{proposalName}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Step dots */}
            {(['configure', 'generate'] as Step[]).map((s) => (
              <div key={s} style={{
                width: 6, height: 6, borderRadius: '50%',
                background: s === step || (s === 'configure' && step === 'generate') ? 'var(--primary)' : 'var(--color-border)',
                opacity: s === step ? 1 : 0.5,
              }} />
            ))}
            <button onClick={handleClose} disabled={step === 'generate' && !done && !generateError}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, marginLeft: 4,
                opacity: step === 'generate' && !done && !generateError ? 0.3 : 1 }}>
              <Icon icon={X} size="sm" />
            </button>
          </div>
        </div>

        {/* ── Step 1: Configure ── */}
        {step === 'configure' && (
          <>
            <div>
              <div style={label}>Instructions (optional)</div>
              <textarea
                style={{ ...textarea, minHeight: 110 }}
                placeholder="e.g. Dark theme, focus on pricing and timeline, make it bold and modern"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                autoFocus
              />
            </div>

            {/* Screenshot upload */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={label}>Design reference <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>(optional)</span></div>
              <div
                ref={dropRef}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onDragEnter={(e) => { e.preventDefault(); (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--primary)'; }}
                onDragLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-border)'; }}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: '2px dashed var(--color-border)',
                  borderRadius: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                  minHeight: 120,
                  transition: 'border-color 0.15s',
                }}
              >
                {referenceImage ? (
                  <>
                    <img
                      src={referenceImage.preview}
                      alt="Design reference"
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.4 }}
                    />
                    <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <Icon icon={CheckCircle} size="md" style={{ color: 'var(--primary)' }} />
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>Design reference ready</div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setReferenceImage(null); }}
                        style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', marginTop: 2 }}
                      >
                        Remove
                      </button>
                    </div>
                  </>
                ) : imageExtracting ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading image…</div>
                ) : (
                  <>
                    <Icon icon={ImageIcon} size="md" style={{ color: 'var(--text-muted)' }} />
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Drop a screenshot or click to upload
                    </div>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button style={btn('ghost')} onClick={handleClose}>Cancel</button>
              <button style={btn('primary')} onClick={handleGenerate}>
                Generate Microsite →
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Generate ── */}
        {step === 'generate' && (
          <>
            {progressLines.length > 0 && (
              <div style={{
                background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                borderRadius: 6, padding: '10px 12px', maxHeight: 240, overflowY: 'auto',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                {progressLines.map((line, i) => (
                  <div key={i} style={{ fontSize: 12, color: line.endsWith('✓') ? 'var(--text-muted)' : 'var(--text)', fontFamily: 'monospace' }}>
                    {line}
                  </div>
                ))}
              </div>
            )}

            {generateError && (
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: 6, padding: '10px 12px', fontSize: 13, color: '#ef4444' }}>
                {generateError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {done ? (
                <>
                  <button style={btn('ghost')} onClick={handleFullPage}>Open Full Page ↗</button>
                  <button style={btn('primary')} onClick={handleView}>View Microsite →</button>
                </>
              ) : generateError ? (
                <>
                  <button style={btn('ghost')} onClick={() => setStep('configure')}>← Back</button>
                  <button style={btn('primary')} onClick={handleGenerate}>Retry</button>
                </>
              ) : (
                <button disabled style={{ ...btn('primary'), opacity: 0.6, cursor: 'not-allowed' }}>
                  Generating…
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
