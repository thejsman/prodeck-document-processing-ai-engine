'use client';

import type { PluginTokens, WhyUsContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Body, Label } from '../shared/Typography';
import { AnimatedCounter } from '../shared/AnimatedCounter';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { ThemedMermaid } from '../shared/ThemedMermaid';

interface Props {
  content: WhyUsContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
}

export function WhyUsSection({ content, tokens, index }: Props) {
  return (
    <section
      id="whyus"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: getSectionGradient('whyus', tokens),
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'absolute', right: '-3%', bottom: '5%', fontFamily: `'${tokens.heroFont}', serif`, fontSize: 'clamp(8rem, 18vw, 16rem)', fontWeight: tokens.heroWeight, color: tokens.text, opacity: 0.02, lineHeight: 1, pointerEvents: 'none', zIndex: 1 }}>
        {String(index + 1).padStart(2, '0')}
      </div>

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 960, margin: '0 auto' }}>
        <Reveal>
          <Label tokens={tokens} style={{ display: 'block', marginBottom: 16 }}>
            {content.eyebrow}
          </Label>
        </Reveal>

        <Reveal delay={80}>
          <Headline tokens={tokens} style={{ marginBottom: 12 }}>
            {content.headline}
          </Headline>
        </Reveal>

        <Reveal delay={160}>
          <Body tokens={tokens} style={{ maxWidth: 640, marginBottom: 48 }}>
            {content.body}
          </Body>
        </Reveal>

        {/* Stats grid with AnimatedCounter */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min((content.stats ?? []).length, 4)}, 1fr)`,
            gap: 'clamp(1rem, 2vw, 2rem)',
          }}
        >
          {(content.stats ?? []).map((stat, si) => (
            <Reveal key={si} delay={240 + si * 80}>
              <div
                style={{
                  textAlign: 'center',
                  padding: '32px 20px',
                  borderRadius: 12,
                  border: `1px solid ${tokens.border}`,
                  background: tokens.surfaceCard,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Top accent line */}
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: '20%',
                  right: '20%',
                  height: 2,
                  background: `linear-gradient(90deg, transparent, ${tokens.accent}, transparent)`,
                }} />

                <div
                  style={{
                    fontFamily: `'${tokens.heroFont}', serif`,
                    fontWeight: tokens.heroWeight,
                    fontSize: 'clamp(2rem, 4vw, 3rem)',
                    lineHeight: 1,
                    color: tokens.accent,
                    marginBottom: 10,
                  }}
                >
                  <AnimatedCounter value={stat.number} />
                </div>
                <div
                  style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase' as const,
                    color: tokens.text,
                    marginBottom: 8,
                  }}
                >
                  {stat.label}
                </div>
                <Body tokens={tokens} style={{ fontSize: '0.8rem' }}>
                  {stat.context}
                </Body>
              </div>
            </Reveal>
          ))}
        </div>

        {content.diagram && (
          <div style={{ marginTop: 'clamp(2.5rem, 5vw, 4rem)', maxWidth: 520, margin: 'clamp(2.5rem, 5vw, 4rem) auto 0' }}>
            <ThemedMermaid
              diagram={content.diagram}
              tokens={tokens}
              delay={240 + Math.min((content.stats?.length ?? 3), 4) * 80 + 80}
            />
          </div>
        )}
      </div>
    </section>
  );
}
