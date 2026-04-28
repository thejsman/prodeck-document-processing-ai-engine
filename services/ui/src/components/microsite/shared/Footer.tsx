'use client';

import type { PluginTokens, BrandConfig, LayoutSection } from '../../../types/presentation';

interface Props {
  tokens: PluginTokens;
  brand: BrandConfig;
  sections?: LayoutSection[];
  client?: string;
  date?: string;
}

function BrandIcon({ color }: { color: string }) {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="11" height="11" rx="2" fill={color} opacity="0.9" />
      <rect x="17" y="4" width="11" height="11" rx="2" fill={color} opacity="0.5" />
      <rect x="4" y="17" width="11" height="11" rx="2" fill={color} opacity="0.5" />
      <rect x="17" y="17" width="11" height="11" rx="2" fill={color} opacity="0.9" />
    </svg>
  );
}

export function Footer({ tokens, brand, client, date }: Props) {
  const clientName = client || brand.companyName;
  const preparer = 'KM';

  // Extract domain hint from tagline if it looks like a domain
  const domainHint = brand.tagline && /^[\w.-]+\.\w{2,}$/.test(brand.tagline.trim()) ? brand.tagline.trim() : null;

  return (
    <footer
      style={{
        background: tokens.bg,
        borderTop: `1px solid ${tokens.border}`,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '18px 40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '2rem',
        }}
      >
        {/* ── Left: icon + client name + domain ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {brand.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt={clientName}
              style={{ height: 32, width: 'auto', objectFit: 'contain', flexShrink: 0 }}
            />
          ) : (
            <BrandIcon color={tokens.text} />
          )}

          <div>
            <div
              style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontWeight: 700,
                fontSize: '0.88rem',
                color: tokens.text,
                lineHeight: 1.25,
              }}
            >
              {clientName}
            </div>
            {domainHint && (
              <div
                style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.72rem',
                  color: tokens.textSubtle,
                  lineHeight: 1.3,
                }}
              >
                {domainHint}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: "Proposal prepared by" label + preparer name ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.72rem',
                color: tokens.textSubtle,
                lineHeight: 1.4,
              }}
            >
              Proposal prepared by
            </div>
            {date && (
              <div
                style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.65rem',
                  color: tokens.textSubtle,
                  opacity: 0.65,
                  lineHeight: 1.3,
                }}
              >
                Proposal prepared {date} · Version 1.0 · Confidential
              </div>
            )}
          </div>

          <div
            style={{
              fontFamily: `'${tokens.heroFont}', serif`,
              fontWeight: 700,
              fontSize: '1.4rem',
              color: tokens.text,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            {preparer}
          </div>
        </div>
      </div>
    </footer>
  );
}
