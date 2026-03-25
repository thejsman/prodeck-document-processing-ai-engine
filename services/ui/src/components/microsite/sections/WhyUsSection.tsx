'use client';

import type { PluginTokens, WhyUsContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Body, Label } from '../shared/Typography';
import { AnimatedCounter } from '../shared/AnimatedCounter';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { ThemedMermaid } from '../shared/ThemedMermaid';
import { InlineEditable } from '../editor/InlineEditable';

interface Props {
  content: WhyUsContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function WhyUsSection({ content, tokens, index, sectionId }: Props) {
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
          <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
            <Body tokens={tokens} style={{ maxWidth: 640, marginBottom: 48 }}>
              {content.body}
            </Body>
          </InlineEditable>
        </Reveal>

        {/* Stats grid with AnimatedCounter */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min((Array.isArray(content.stats) ? content.stats : content.stats ? [content.stats] : []).length, 4)}, 1fr)`,
            gap: 'clamp(1rem, 2vw, 2rem)',
          }}
        >
          {(Array.isArray(content.stats) ? content.stats : content.stats ? [content.stats] : []).map((stat, si) => (
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
          <div style={{ maxWidth: 520, margin: '0 auto' }}>
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
