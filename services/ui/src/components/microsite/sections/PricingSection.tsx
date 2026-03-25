'use client';

import type { PluginTokens, PricingContent, LayoutSection } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Body, Label } from '../shared/Typography';
import { CTAButton } from '../shared/CTAButton';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { InlineEditable } from '../editor/InlineEditable';

interface Props {
  content: PricingContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sections?: LayoutSection[];
  sectionId?: string;
}

function sectionCta(sections: LayoutSection[], targetId: string | undefined, fallback: string): string {
  if (!targetId) return fallback;
  const s = sections.find(sec => sec.id === targetId);
  return s ? s.heading : fallback;
}

export function PricingSection({ content, tokens, index, sections = [], sectionId }: Props) {
  const ctaSection =
    sections.find(s => s.sectionType === 'nextsteps') ??
    sections.find(s => s.sectionType === 'whyus');
  const ctaTarget = ctaSection?.id;
  return (
    <section
      id="pricing"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: getSectionGradient('pricing', tokens),
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 960, margin: '0 auto' }}>
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', marginBottom: 16 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ marginBottom: 12 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        <Reveal delay={160}>
          <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline ?? ''} multiline>
            <Body tokens={tokens} style={{ maxWidth: 600, marginBottom: 48 }}>
              {content.subheadline}
            </Body>
          </InlineEditable>
        </Reveal>

        {/* Pricing table */}
        {(content.rows ?? []).length > 0 && (
          <Reveal delay={240}>
            <div
              style={{
                borderRadius: 8,
                border: `1px solid ${tokens.border}`,
                overflow: 'hidden',
                marginBottom: 24,
              }}
            >
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  }}
                >
                  <thead>
                    <tr style={{ background: tokens.surfaceAlt }}>
                      {(content.rows?.[0] ?? []).map((cell, ci) => (
                        <th
                          key={ci}
                          style={{
                            padding: '14px 20px',
                            textAlign: ci === 0 ? 'left' : 'right',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: tokens.textMuted,
                            borderBottom: `1px solid ${tokens.border}`,
                          }}
                        >
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(content.rows ?? []).slice(1).map((row, ri) => (
                      <tr key={ri} style={{ background: ri % 2 === 0 ? tokens.surfaceCard : tokens.surface }}>
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            style={{
                              padding: '14px 20px',
                              textAlign: ci === 0 ? 'left' : 'right',
                              fontSize: '0.9rem',
                              color: tokens.text,
                              borderBottom: `1px solid ${tokens.borderSubtle}`,
                              fontWeight: ci === 0 ? 500 : 300,
                            }}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Reveal>
        )}

        {content.totalLabel && (
          <Reveal delay={320}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                padding: '16px 20px',
                borderRadius: 8,
                background: tokens.surfaceCard,
                border: `1px solid ${tokens.border}`,
                marginBottom: 24,
              }}
            >
              <span style={{ fontFamily: `'${tokens.heroFont}', serif`, fontWeight: tokens.heroWeight, fontSize: '1.3rem', color: tokens.accent }}>
                {content.totalLabel}
              </span>
            </div>
          </Reveal>
        )}

        {content.footnote && (
          <Reveal delay={400}>
            <Body tokens={tokens} style={{ fontSize: '0.85rem', color: tokens.textSubtle, marginBottom: 32 }}>
              {content.footnote}
            </Body>
          </Reveal>
        )}

        {content.cta && (
          <Reveal delay={480}>
            <CTAButton tokens={tokens} targetSectionId={ctaTarget}>
              {sectionCta(sections, ctaTarget, content.cta)}
            </CTAButton>
          </Reveal>
        )}
      </div>
    </section>
  );
}
