'use client';

import type { PluginTokens, BrandConfig, LayoutSection } from '../../../types/presentation';

interface Props {
  tokens: PluginTokens;
  brand: BrandConfig;
  sections?: LayoutSection[];
  client?: string;
  date?: string;
}

export function Footer({ tokens, brand, client, date }: Props) {
  return (
    <footer
      style={{
        background: tokens.surfaceAlt,
        borderTop: `1px solid ${tokens.border}`,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {/* ── Main row: brand + prepared-for ──────────────────────────── */}
      <div style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '52px 40px 40px',
        display: 'grid',
        gridTemplateColumns: client ? '1fr auto' : '1fr',
        gap: '2rem',
        alignItems: 'flex-start',
      }}>

        {/* Brand block */}
        <div>
          <div style={{
            fontFamily: `'${tokens.heroFont}', serif`,
            fontWeight: tokens.heroWeight,
            fontSize: 'clamp(1.4rem, 2.8vw, 2rem)',
            color: tokens.text,
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
            marginBottom: brand.tagline ? 10 : 0,
          }}>
            {brand.companyName}
          </div>
          {brand.tagline && (
            <div style={{
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: '0.875rem',
              color: tokens.textMuted,
              lineHeight: 1.6,
              maxWidth: 480,
            }}>
              {brand.tagline}
            </div>
          )}
        </div>

        {/* Prepared-for block */}
        {client && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: '0.68rem',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: tokens.textSubtle,
              marginBottom: 6,
            }}>
              Prepared for
            </div>
            <div style={{
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: '0.9rem',
              fontWeight: 600,
              color: tokens.text,
              lineHeight: 1.4,
            }}>
              {client}
            </div>
            {date && (
              <div style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.78rem',
                color: tokens.textMuted,
                marginTop: 4,
              }}>
                {date}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom bar ──────────────────────────────────────────────── */}
      <div style={{
        borderTop: `1px solid ${tokens.borderSubtle}`,
        maxWidth: 1100,
        margin: '0 auto',
        padding: '16px 40px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <span style={{
          fontFamily: `'${tokens.bodyFont}', sans-serif`,
          fontSize: '0.72rem',
          color: tokens.textSubtle,
        }}>
          &copy; {new Date().getFullYear()} {brand.companyName}. All rights reserved.
        </span>
        <span style={{
          fontFamily: `'${tokens.bodyFont}', sans-serif`,
          fontSize: '0.72rem',
          color: tokens.textSubtle,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          Confidential
        </span>
      </div>
    </footer>
  );
}
