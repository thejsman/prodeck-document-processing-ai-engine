'use client';

import { useState } from 'react';
import { useEditContext } from './EditContext';
import type { LayoutAST } from '../../../types/presentation';

const ACCENT = '#6366f1';

interface FontPair {
  name: string;
  heading: string;
  body: string;
  headingWeight: number;
  url: string;
  preview: string;
  tag: string;
}

const FONT_PAIRS: FontPair[] = [
  {
    name: 'Modern',
    heading: 'Inter',
    body: 'Inter',
    headingWeight: 800,
    url: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap',
    preview: 'Clean & contemporary',
    tag: 'popular',
  },
  {
    name: 'Editorial',
    heading: 'Playfair Display',
    body: 'Source Sans 3',
    headingWeight: 700,
    url: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Source+Sans+3:wght@400;600&display=swap',
    preview: 'Timeless editorial',
    tag: 'elegant',
  },
  {
    name: 'Geometric',
    heading: 'Montserrat',
    body: 'Open Sans',
    headingWeight: 800,
    url: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=Open+Sans:wght@400;600&display=swap',
    preview: 'Strong & versatile',
    tag: 'popular',
  },
  {
    name: 'Tech',
    heading: 'Space Grotesk',
    body: 'DM Sans',
    headingWeight: 700,
    url: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=DM+Sans:wght@400;500&display=swap',
    preview: 'Sharp & technical',
    tag: 'modern',
  },
  {
    name: 'Elegant',
    heading: 'Cormorant Garamond',
    body: 'Raleway',
    headingWeight: 600,
    url: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Raleway:wght@400;500&display=swap',
    preview: 'Luxury & refined',
    tag: 'elegant',
  },
  {
    name: 'Bold Impact',
    heading: 'Oswald',
    body: 'Roboto',
    headingWeight: 700,
    url: 'https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&family=Roboto:wght@400;500&display=swap',
    preview: 'High impact headers',
    tag: 'bold',
  },
  {
    name: 'Warm',
    heading: 'Lora',
    body: 'Nunito',
    headingWeight: 700,
    url: 'https://fonts.googleapis.com/css2?family=Lora:wght@600;700&family=Nunito:wght@400;600&display=swap',
    preview: 'Friendly & approachable',
    tag: 'warm',
  },
  {
    name: 'Minimal',
    heading: 'DM Sans',
    body: 'DM Sans',
    headingWeight: 700,
    url: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap',
    preview: 'Quiet confidence',
    tag: 'minimal',
  },
  {
    name: 'Classic',
    heading: 'Merriweather',
    body: 'Lato',
    headingWeight: 700,
    url: 'https://fonts.googleapis.com/css2?family=Merriweather:wght@700&family=Lato:wght@400;700&display=swap',
    preview: 'Traditional authority',
    tag: 'classic',
  },
  {
    name: 'Startup',
    heading: 'Poppins',
    body: 'Poppins',
    headingWeight: 700,
    url: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap',
    preview: 'Energetic & youthful',
    tag: 'popular',
  },
];

interface Props {
  onClose: () => void;
}

export function TypographyPicker({ onClose }: Props) {
  const ctx = useEditContext();
  const [applied, setApplied] = useState<string | null>(null);

  if (!ctx) return null;

  const currentHeadingFont = ctx.ast.customTokens?.heroFont ?? ctx.ast.brand?.googleFontsUrl ?? '';

  function applyPair(pair: FontPair) {
    if (!ctx) return;
    const newAst: LayoutAST = {
      ...ctx.ast,
      customTokens: {
        ...ctx.ast.customTokens,
        heroFont: pair.heading,
        bodyFont: pair.body,
        heroWeight: pair.headingWeight,
      },
      customFonts: [
        ...(ctx.ast.customFonts?.filter(f => f.family !== pair.heading && f.family !== pair.body) ?? []),
        { family: pair.heading, url: pair.url },
        ...(pair.body !== pair.heading ? [{ family: pair.body, url: pair.url }] : []),
      ],
    };
    ctx.replaceAst(newAst);
    setApplied(pair.name);
    setTimeout(onClose, 600);
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        zIndex: 30000,
        marginTop: 6,
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
        border: '1px solid #e2e8f0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        width: 340,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #e2e8f0' }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#1e293b' }}>Typography</p>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>Choose a heading + body font pairing</p>
      </div>

      <div style={{ maxHeight: 380, overflowY: 'auto', padding: '8px 0' }}>
        {FONT_PAIRS.map(pair => {
          const isActive = applied === pair.name || currentHeadingFont.includes(pair.heading);
          return (
            <button
              key={pair.name}
              onClick={() => applyPair(pair)}
              style={{
                width: '100%',
                padding: '10px 14px',
                border: 'none',
                background: isActive ? '#f5f3ff' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = '#f8fafc'; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {/* Font preview */}
              <div style={{
                width: 52, height: 40, borderRadius: 8, flexShrink: 0,
                background: isActive ? '#eef2ff' : '#f8fafc',
                border: `1.5px solid ${isActive ? ACCENT : '#e2e8f0'}`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 2, overflow: 'hidden', padding: '0 4px',
              }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: isActive ? ACCENT : '#1e293b', lineHeight: 1, whiteSpace: 'nowrap' }}>
                  Ag
                </span>
                <span style={{ fontSize: 8, color: '#94a3b8', lineHeight: 1, whiteSpace: 'nowrap' }}>
                  body
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: isActive ? ACCENT : '#1e293b' }}>{pair.name}</span>
                  <span style={{
                    fontSize: 9, fontWeight: 600, color: '#94a3b8',
                    background: '#f1f5f9', padding: '1px 5px', borderRadius: 4,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>{pair.tag}</span>
                  {isActive && <span style={{ fontSize: 9, color: ACCENT, fontWeight: 700, marginLeft: 'auto' }}>✓ Active</span>}
                </div>
                <div style={{ fontSize: 10, color: '#64748b' }}>
                  {pair.heading} · {pair.body}
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>{pair.preview}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ padding: '8px 14px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
        <p style={{ margin: 0, fontSize: 10, color: '#94a3b8' }}>
          Changes apply instantly. Undo with Ctrl+Z.
        </p>
      </div>
    </div>
  );
}
