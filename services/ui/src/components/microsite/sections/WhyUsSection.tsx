'use client';

import type { PluginTokens, WhyUsContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Body, Label } from '../shared/Typography';
import { AnimatedCounter } from '../shared/AnimatedCounter';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { ClickableDiagram } from '../editor/ClickableDiagram';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

interface Props {
  content: WhyUsContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function WhyUsSection({ content, tokens, index, sectionId }: Props) {
  const stats = Array.isArray(content.stats) ? content.stats : content.stats ? [content.stats] : [];
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
            gridTemplateColumns: `repeat(${Math.min(stats.length || 1, 4)}, minmax(0, 1fr))`,
            gap: 'clamp(1rem, 2vw, 2rem)',
          }}
        >
          {stats.map((stat, si) => (
            <Reveal key={si} delay={240 + si * 80}>
              <InlineArrayItem arrayPath="stats" index={si} total={stats.length}>
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
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: '20%',
                    right: '20%',
                    height: 2,
                    background: `linear-gradient(90deg, transparent, ${tokens.accent}, transparent)`,
                  }} />

                  <InlineEditable field={`stats.${si}.number`} label="Number" value={stat.number ?? ''}>
                    <div
                      style={{
                        fontFamily: `'${tokens.heroFont}', serif`,
                        fontWeight: tokens.heroWeight,
                        fontSize: 'clamp(1.25rem, 2.8vw, 2.2rem)',
                        lineHeight: 1.1,
                        color: tokens.accent,
                        marginBottom: 10,
                        wordBreak: 'break-word',
                        overflowWrap: 'break-word',
                      }}
                    >
                      <AnimatedCounter value={stat.number} />
                    </div>
                  </InlineEditable>
                  <InlineEditable field={`stats.${si}.label`} label="Label" value={stat.label ?? ''}>
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
                  </InlineEditable>
                  <InlineEditable field={`stats.${si}.context`} label="Context" value={stat.context ?? ''} multiline>
                    <Body tokens={tokens} style={{ fontSize: '0.8rem' }}>
                      {stat.context}
                    </Body>
                  </InlineEditable>
                </div>
              </InlineArrayItem>
            </Reveal>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <InlineAddItem
            arrayPath="stats"
            template={{ number: '0', label: 'New stat', context: 'Context…' }}
            label="Add stat"
          />
        </div>

        <ClickableDiagram
          diagram={content.diagram ?? ''}
          tokens={tokens}
          delay={240 + Math.min((content.stats?.length ?? 3), 4) * 80 + 80}
          wrapperStyle={{ maxWidth: 520, margin: '0 auto' }}
        />
      </div>
    </section>
  );
}
