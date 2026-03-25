'use client';

import type { PluginTokens, MetricsContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { AnimatedCounter } from '../shared/AnimatedCounter';
import { Headline, Label, Body } from '../shared/Typography';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';

interface Props {
  content: MetricsContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
}

export function MetricsSection({ content, tokens }: Props) {
  return (
    <section
      id="metrics"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: getSectionGradient('metrics', tokens),
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />


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

        {/* Stats grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'clamp(2rem, 4vw, 3rem)',
            marginBottom: 'clamp(2.5rem, 5vw, 4rem)',
          }}
        >
          {(Array.isArray(content.stats) ? content.stats : content.stats ? [content.stats] : []).map((stat, si) => (
            <Reveal key={si} variant="fadeIn" delay={160 + si * 100}>
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    fontFamily: `'${tokens.heroFont}', serif`,
                    fontWeight: tokens.heroWeight,
                    fontSize: 'clamp(1.6rem, 3.5vw, 2.4rem)',
                    color: tokens.accent,
                    lineHeight: 1.15,
                    wordBreak: 'break-word',
                    overflowWrap: 'break-word',
                    marginBottom: 8,
                  }}
                >
                  <AnimatedCounter value={stat.number} />
                </div>

                <div
                  style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    letterSpacing: tokens.labelTracking,
                    textTransform: 'uppercase',
                    color: tokens.text,
                    marginBottom: 6,
                  }}
                >
                  {stat.label}
                </div>

                <Body tokens={tokens} style={{ fontSize: '0.8rem' }}>{stat.context}</Body>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Scaling Strategies */}
        {(content.strategies ?? []).length > 0 && (
          <Reveal variant="fadeUp" delay={160 + (content.stats?.length ?? 0) * 100 + 80}>
            <div>
              <Headline tokens={tokens} style={{ fontSize: '1.2rem', marginBottom: 20 }}>
                Scaling Strategies
              </Headline>

              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                {(content.strategies ?? []).map((strategy, si) => (
                  <li
                    key={si}
                    style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.95rem',
                      fontWeight: 300,
                      color: tokens.textMuted,
                      lineHeight: 1.7,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: tokens.accent,
                        flexShrink: 0,
                      }}
                    />
                    {strategy}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}
