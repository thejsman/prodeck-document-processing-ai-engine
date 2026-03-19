'use client';

import type { PluginTokens, BrandConfig, LayoutSection } from '../../../types/presentation';

interface Props {
  tokens: PluginTokens;
  brand: BrandConfig;
  sections: LayoutSection[];
  client?: string;
  date?: string;
}

export function Footer({ tokens, brand, sections, client, date }: Props) {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <footer
      style={{
        background: tokens.surface,
        borderTop: 'none',
        borderImage: `linear-gradient(90deg, transparent, ${tokens.accent}40, transparent) 1`,
        borderImageSlice: 1,
        borderTopWidth: 1,
        borderTopStyle: 'solid',
        padding: 'clamp(2rem, 4vw, 3.5rem) 2rem env(safe-area-inset-bottom, 2rem)',
      }}
    >
      <div
        style={{
          maxWidth: 960,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '2rem',
          marginBottom: '2rem',
        }}
      >
        {/* Company info */}
        <div>
          <p style={{
            fontFamily: `'${tokens.bodyFont}', sans-serif`,
            fontWeight: 600,
            fontSize: 14,
            color: tokens.accent,
            letterSpacing: tokens.labelTracking,
            textTransform: 'uppercase',
            margin: '0 0 8px',
          }}>
            {brand.companyName}
          </p>
          {brand.tagline && (
            <p style={{
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: 13,
              color: tokens.textMuted,
              margin: 0,
              lineHeight: 1.5,
            }}>
              {brand.tagline}
            </p>
          )}
        </div>

        {/* Section nav */}
        <div>
          <p style={{
            fontFamily: `'${tokens.bodyFont}', sans-serif`,
            fontWeight: 600,
            fontSize: 11,
            color: tokens.textSubtle,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            margin: '0 0 12px',
          }}>
            Sections
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sections.slice(0, 6).map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                onMouseEnter={(e) => (e.currentTarget.style.color = tokens.accent)}
                onMouseLeave={(e) => (e.currentTarget.style.color = tokens.textMuted)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: 13,
                  color: tokens.textMuted,
                  padding: 0,
                  transition: 'color 0.2s',
                }}
              >
                {s.heading}
              </button>
            ))}
          </div>
        </div>

        {/* Prepared for */}
        {client && (
          <div>
            <p style={{
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontWeight: 600,
              fontSize: 11,
              color: tokens.textSubtle,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              margin: '0 0 12px',
            }}>
              Prepared For
            </p>
            <p style={{
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: 13,
              color: tokens.textMuted,
              margin: 0,
              lineHeight: 1.5,
            }}>
              {client}
              {date && <><br />{date}</>}
            </p>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div style={{
        borderTop: `1px solid ${tokens.borderSubtle}`,
        paddingTop: '1rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <p style={{
          fontFamily: `'${tokens.bodyFont}', sans-serif`,
          fontSize: 11,
          color: tokens.textSubtle,
          margin: 0,
        }}>
          Confidential &middot; &copy; {new Date().getFullYear()} {brand.companyName}
        </p>
      </div>
    </footer>
  );
}
