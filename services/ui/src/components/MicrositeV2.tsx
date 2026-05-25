'use client';

/**
 * MicrositeV2 — renderer for the V2 experimental pipeline.
 * Each section is Claude-generated HTML with inline styles baked in.
 * Zero dependency on plugins, theme tokens, or legacy section components.
 */

import { useState, useEffect } from 'react';
import type { LayoutAST, LayoutSection } from '@/types/presentation';

interface Props {
  ast: LayoutAST;
  generating?: boolean;
  onBack?: () => void;
}

function buildHtml(ast: LayoutAST): string {
  const firstHtml = (ast.sections[0] as LayoutSection & { customHtml?: string })?.customHtml ?? '';
  const isFullDoc = /^\s*<!DOCTYPE|^\s*<html/i.test(firstHtml);
  if (isFullDoc) return firstHtml;
  const fonts = ast.brand?.googleFontsUrl
    ? `<link rel="stylesheet" href="${ast.brand.googleFontsUrl}">` : '';
  const sectionsHtml = ast.sections
    .map(s => (s as LayoutSection & { customHtml?: string }).customHtml ?? '')
    .join('\n');
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ast.meta?.client || 'Microsite'}</title>
${fonts}
<style>*{box-sizing:border-box;margin:0;padding:0}body{line-height:1.6}</style>
</head><body>${sectionsHtml}</body></html>`;
}

function downloadMicrosite(ast: LayoutAST) {
  const blob = new Blob([buildHtml(ast)], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${ast.meta?.client || 'microsite'}.html`.replace(/[^a-z0-9._-]/gi, '-').toLowerCase();
  a.click();
  URL.revokeObjectURL(url);
}

export function MicrositeV2({ ast, generating, onBack }: Props) {
  const googleFontsUrl = ast.brand?.googleFontsUrl;

  return (
    <>
      {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
      <style>{`
        .v2-site *, .v2-site *::before, .v2-site *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .v2-site { line-height: 1.6; }
        @media (max-width: 640px) {
          .v2-site section { padding: 48px 0 !important; }
          .v2-site section > div { padding: 0 20px !important; }
        }
        .v2-action-btn { transition: background 0.15s, box-shadow 0.15s; }
        .v2-action-btn:hover { background: #f5f5f5 !important; box-shadow: 0 2px 8px rgba(0,0,0,0.10) !important; }
      `}</style>

      {/* Floating buttons — bottom-right, each separate */}
      <div style={{
        position: 'fixed', bottom: 24, right: 24,
        zIndex: 9999, display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center',
      }}>
        {onBack && (
          <button className="v2-action-btn" onClick={onBack} style={{
            background: 'rgba(255,255,255,0.96)', color: '#111',
            border: '1px solid rgba(0,0,0,0.12)', borderRadius: 50,
            padding: '8px 20px', fontSize: 13, fontWeight: 500,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            whiteSpace: 'nowrap', backdropFilter: 'blur(12px)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
          }}>
            ← Back
          </button>
        )}
        <button className="v2-action-btn" onClick={() => downloadMicrosite(ast)} style={{
          background: 'rgba(255,255,255,0.96)', color: '#111',
          border: '1px solid rgba(0,0,0,0.12)', borderRadius: 50,
          padding: '8px 20px', fontSize: 13, fontWeight: 500,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          whiteSpace: 'nowrap', backdropFilter: 'blur(12px)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
        }}>
          ↓ Download
        </button>
      </div>

      {/* Sections — Claude-generated HTML owns the full viewport */}
      <div className="v2-site">
        {generating ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: '60vh', color: '#999', fontSize: 14 }}>
            Generating…
          </div>
        ) : (
          ast.sections.map((section) => (
            <V2Section key={section.id} section={section} />
          ))
        )}
      </div>
    </>
  );
}

function V2IframeSection({ html }: { html: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [html]);
  if (!blobUrl) return null;
  return (
    <iframe
      src={blobUrl}
      style={{ width: '100%', height: '100vh', border: 'none', display: 'block' }}
      title="microsite"
    />
  );
}

function V2Section({ section }: { section: LayoutSection }) {
  const html = (section as LayoutSection & { customHtml?: string }).customHtml;

  if (html) {
    const isFullDoc = /^\s*<!DOCTYPE|^\s*<html/i.test(html);
    if (isFullDoc) return <V2IframeSection html={html} />;
    return (
      <div
        data-section-type={section.sectionType}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <section id={section.id} style={{ padding: '72px 0', background: '#fff' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 40px' }}>
        <h2 style={{ fontSize: 32, fontWeight: 700, color: '#111' }}>{section.heading}</h2>
      </div>
    </section>
  );
}
