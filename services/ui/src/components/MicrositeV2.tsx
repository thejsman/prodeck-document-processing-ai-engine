'use client';

/**
 * MicrositeV2 — renderer for the V2 experimental pipeline.
 * Each section is Claude-generated HTML with inline styles baked in.
 * Zero dependency on plugins, theme tokens, or legacy section components.
 */

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

function openFullPage(ast: LayoutAST) {
  const blob = new Blob([buildHtml(ast)], { type: 'text/html' });
  window.open(URL.createObjectURL(blob), '_blank');
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
        .v2-fab { opacity: 0.25; transition: opacity 0.2s; }
        .v2-fab:hover { opacity: 1; }
      `}</style>

      {/* Floating action buttons — bottom-right, unobtrusive */}
      <div className="v2-fab" style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end',
      }}>
        <button onClick={() => openFullPage(ast)} style={{
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
          color: '#fff', border: 'none', borderRadius: 20,
          padding: '7px 14px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
          Full Page ↗
        </button>
        <button onClick={() => downloadMicrosite(ast)} style={{
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
          color: '#fff', border: 'none', borderRadius: 20,
          padding: '7px 14px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
          Download ↓
        </button>
        {onBack && (
          <button onClick={onBack} style={{
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
            color: '#fff', border: 'none', borderRadius: 20,
            padding: '7px 14px', fontSize: 11, cursor: 'pointer',
          }}>
            ← Back
          </button>
        )}
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

function V2Section({ section }: { section: LayoutSection }) {
  const html = (section as LayoutSection & { customHtml?: string }).customHtml;

  if (html) {
    const isFullDoc = /^\s*<!DOCTYPE|^\s*<html/i.test(html);
    if (isFullDoc) {
      return (
        <iframe
          srcDoc={html}
          style={{ width: '100%', height: '100vh', border: 'none', display: 'block' }}
          sandbox="allow-scripts allow-same-origin"
          title="microsite"
        />
      );
    }
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
