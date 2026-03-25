'use client';

import type { PluginTokens, MetricsContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { AnimatedCounter } from '../shared/AnimatedCounter';
import { Headline, Label, Body } from '../shared/Typography';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

interface Props {
  content: MetricsContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function MetricsSection({ content, tokens }: Props) {
  const stats = Array.isArray(content.stats) ? content.stats : content.stats ? [content.stats] : [];
  const strategies = content.strategies ?? [];

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
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', marginBottom: 16 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ marginBottom: 48 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
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
          {stats.map((stat, si) => (
            <Reveal key={si} variant="fadeIn" delay={160 + si * 100}>
              <InlineArrayItem arrayPath="stats" index={si} total={stats.length}>
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
                    <InlineEditable field={`stats.${si}.number`} label="Number" value={stat.number ?? ''}>
                      <AnimatedCounter value={stat.number} />
                    </InlineEditable>
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
                    <InlineEditable field={`stats.${si}.label`} label="Label" value={stat.label ?? ''}>
                      {stat.label}
                    </InlineEditable>
                  </div>

                  <InlineEditable field={`stats.${si}.context`} label="Context" value={stat.context ?? ''} multiline>
                    <Body tokens={tokens} style={{ fontSize: '0.8rem' }}>{stat.context}</Body>
                  </InlineEditable>
                </div>
              </InlineArrayItem>
            </Reveal>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
          <InlineAddItem
            arrayPath="stats"
            template={{ number: '0', label: 'New metric', context: 'Context…' }}
            label="Add metric"
          />
        </div>

        {/* Scaling Strategies */}
        {strategies.length > 0 && (
          <Reveal variant="fadeUp" delay={160 + stats.length * 100 + 80}>
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
                {strategies.map((strategy, si) => (
                  <InlineArrayItem key={si} arrayPath="strategies" index={si} total={strategies.length}>
                    <li
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
                      <InlineEditable field={`strategies.${si}`} label="Strategy" value={strategy ?? ''}>
                        {strategy}
                      </InlineEditable>
                    </li>
                  </InlineArrayItem>
                ))}
              </ul>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
                <InlineAddItem
                  arrayPath="strategies"
                  template="New scaling strategy…"
                  label="Add strategy"
                />
              </div>
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}
