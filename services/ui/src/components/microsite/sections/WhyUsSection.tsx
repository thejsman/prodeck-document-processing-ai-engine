'use client';

import type { PluginTokens, WhyUsContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { AnimatedCounter } from '../shared/AnimatedCounter';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

interface Props {
  content: WhyUsContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function WhyUsSection({ content, tokens }: Props) {
  const stats = Array.isArray(content.stats) ? content.stats : content.stats ? [content.stats] : [];
  const accentRgb = tokens.accentRgb ?? '99,179,237';

  return (
    <section
      id="whyus"
      style={{
        position: 'relative',
        padding: 'clamp(5rem, 10vw, 8rem) 2rem',
        background: getSectionGradient('whyus', tokens),
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 880, margin: '0 auto' }}>

        {/* Section header — left-aligned, typographic */}
        <Reveal>
          <div style={{ marginBottom: 'clamp(3rem, 6vw, 5rem)' }}>
            <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
              <span style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.62rem', fontWeight: 700,
                letterSpacing: '0.18em', textTransform: 'uppercase' as const,
                color: tokens.accent, display: 'block', marginBottom: 20,
              }}>
                {content.eyebrow}
              </span>
            </InlineEditable>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'clamp(2rem, 5vw, 4rem)',
              alignItems: 'end',
            }}>
              <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
                <h2 style={{
                  fontFamily: `'${tokens.heroFont}', serif`,
                  fontWeight: Number(tokens.heroWeight) || 700,
                  fontSize: 'clamp(2rem, 4vw, 3.2rem)',
                  lineHeight: 1.1, letterSpacing: '-0.03em',
                  color: tokens.text, margin: 0,
                }}>
                  {content.headline}
                </h2>
              </InlineEditable>

              <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
                <p style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '1rem', lineHeight: 1.75,
                  color: tokens.textMuted, margin: 0,
                }}>
                  {content.body}
                </p>
              </InlineEditable>
            </div>
          </div>
        </Reveal>

        {/* Divider */}
        <div style={{ height: 1, background: tokens.border, marginBottom: 'clamp(2.5rem, 5vw, 4rem)' }} />

        {/* Stats — numbered list, open, no cards */}
        <div>
          {stats.map((stat, si) => (
            <Reveal key={si} delay={100 + si * 80}>
              <InlineArrayItem arrayPath="stats" index={si} total={stats.length}>
                <div style={{
                  position: 'relative',
                  display: 'grid',
                  gridTemplateColumns: '72px 1fr 1fr',
                  gap: 'clamp(1rem, 3vw, 2.5rem)',
                  alignItems: 'start',
                  paddingBottom: 'clamp(1.5rem, 3vw, 2.5rem)',
                  marginBottom: si < stats.length - 1 ? 'clamp(1.5rem, 3vw, 2.5rem)' : 0,
                  borderBottom: si < stats.length - 1 ? `1px solid ${tokens.border}` : 'none',
                }}>
                  {/* Left: large ordinal number */}
                  <div style={{
                    fontFamily: `'${tokens.heroFont}', serif`,
                    fontSize: 'clamp(1.1rem, 2vw, 1.4rem)',
                    fontWeight: 700,
                    color: si === 0 ? tokens.accent : `rgba(${accentRgb},0.3)`,
                    letterSpacing: '-0.02em',
                    lineHeight: 1,
                    paddingTop: 4,
                  }}>
                    {String(si + 1).padStart(2, '0')}
                  </div>

                  {/* Centre: stat number + label */}
                  <div>
                    <InlineEditable field={`stats.${si}.number`} label="Number" value={stat.number ?? ''}>
                      <div style={{
                        fontFamily: `'${tokens.heroFont}', serif`,
                        fontWeight: 800,
                        fontSize: 'clamp(2.2rem, 4.5vw, 3.5rem)',
                        lineHeight: 1, letterSpacing: '-0.04em',
                        color: tokens.text,
                        marginBottom: 8,
                      }}>
                        <AnimatedCounter value={stat.number} />
                      </div>
                    </InlineEditable>
                    <InlineEditable field={`stats.${si}.label`} label="Label" value={stat.label ?? ''}>
                      <div style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontWeight: 600, fontSize: '0.75rem',
                        letterSpacing: '0.1em', textTransform: 'uppercase' as const,
                        color: tokens.accent,
                      }}>
                        {stat.label}
                      </div>
                    </InlineEditable>
                  </div>

                  {/* Right: context */}
                  <InlineEditable field={`stats.${si}.context`} label="Context" value={stat.context ?? ''} multiline>
                    <p style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.95rem', lineHeight: 1.75,
                      color: tokens.textMuted, margin: 0,
                      paddingTop: 6,
                    }}>
                      {stat.context}
                    </p>
                  </InlineEditable>
                </div>
              </InlineArrayItem>
            </Reveal>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          <InlineAddItem
            arrayPath="stats"
            template={{ number: '0', label: 'New stat', context: 'Context…' }}
            label="Add stat"
          />
        </div>
      </div>
    </section>
  );
}
