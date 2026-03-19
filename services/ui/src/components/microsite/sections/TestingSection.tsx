'use client';

import type { PluginTokens, TestingContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, SubHeadline, Body, Label } from '../shared/Typography';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';

interface Props {
  content: TestingContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
}

const PYRAMID_WIDTHS = ['40%', '55%', '70%', '85%', '100%'];
const PYRAMID_OPACITIES = [0.3, 0.25, 0.2, 0.15, 0.1];

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(128, 128, 128, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function TestingSection({ content, tokens, index }: Props) {
  const sortedLayers = [...(content.layers ?? [])].sort((a, b) => a.level - b.level);

  return (
    <section
      id="testing"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: getSectionGradient('testing', tokens),
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div
        style={{
          position: 'absolute',
          right: '-3%',
          top: '5%',
          fontFamily: `'${tokens.heroFont}', serif`,
          fontSize: 'clamp(8rem, 18vw, 16rem)',
          fontWeight: tokens.heroWeight,
          color: tokens.text,
          opacity: 0.02,
          lineHeight: 1,
          pointerEvents: 'none',
          zIndex: 1,
        }}
      >
        {String(index + 1).padStart(2, '0')}
      </div>

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 960, margin: '0 auto' }}>
        <Reveal>
          <Label tokens={tokens} style={{ display: 'block', marginBottom: 16 }}>
            {content.eyebrow}
          </Label>
        </Reveal>

        <Reveal delay={80}>
          <Headline tokens={tokens} style={{ marginBottom: 48 }}>
            {content.headline}
          </Headline>
        </Reveal>

        {/* Pyramid visualization */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            marginBottom: 'clamp(2.5rem, 5vw, 4rem)',
          }}
        >
          {sortedLayers.map((layer, li) => {
            const widthPercent = PYRAMID_WIDTHS[Math.min(li, PYRAMID_WIDTHS.length - 1)];
            const bgOpacity = PYRAMID_OPACITIES[Math.min(li, PYRAMID_OPACITIES.length - 1)];

            return (
              <Reveal key={li} variant="scale" delay={160 + li * 100}>
                <div
                  style={{
                    width: widthPercent,
                    minWidth: 280,
                    maxWidth: 800,
                    margin: '0 auto',
                    padding: '16px 24px',
                    borderRadius: 8,
                    background: hexToRgba(tokens.accent, bgOpacity),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span
                      style={{
                        fontFamily: `'${tokens.heroFont}', serif`,
                        fontWeight: tokens.heroWeight,
                        fontSize: '1.1rem',
                        color: tokens.accent,
                        flexShrink: 0,
                      }}
                    >
                      L{layer.level}
                    </span>

                    <span
                      style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontWeight: 600,
                        fontSize: '0.95rem',
                        color: tokens.text,
                      }}
                    >
                      {layer.name}
                    </span>

                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 10px',
                        borderRadius: 12,
                        background: hexToRgba(tokens.accent, 0.2),
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: tokens.accent,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {layer.coverage}
                    </span>
                  </div>

                  <span
                    style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.85rem',
                      fontWeight: 300,
                      color: tokens.textMuted,
                      lineHeight: 1.5,
                    }}
                  >
                    {layer.description}
                  </span>
                </div>
              </Reveal>
            );
          })}
        </div>

        {/* Additional info grid */}
        {(content.additionalInfo ?? []).length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 'clamp(1.5rem, 3vw, 2rem)',
            }}
          >
            {(content.additionalInfo ?? []).map((info, ai) => (
              <Reveal key={ai} variant="fadeUp" delay={160 + sortedLayers.length * 100 + ai * 80}>
                <div>
                  <SubHeadline tokens={tokens} style={{ marginBottom: 10, fontSize: '1.1rem' }}>
                    {info.heading}
                  </SubHeadline>
                  <Body tokens={tokens} style={{ fontSize: '0.9rem' }}>
                    {info.body}
                  </Body>
                </div>
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
