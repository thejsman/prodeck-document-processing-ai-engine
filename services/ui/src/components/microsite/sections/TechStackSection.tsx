'use client';

import type { PluginTokens, TechStackContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { GlassCard } from '../shared/GlassCard';
import { CircularIconBadge } from '../shared/CircularIconBadge';
import { Headline, SubHeadline, Label } from '../shared/Typography';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { ThemedMermaid } from '../shared/ThemedMermaid';

interface Props {
  content: TechStackContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
}

export function TechStackSection({ content, tokens }: Props) {
  return (
    <section
      id="techstack"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: getSectionGradient('techstack', tokens),
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

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 'clamp(1.5rem, 3vw, 2rem)',
          }}
        >
          {(content.categories ?? []).map((category, ci) => (
            <Reveal key={ci} variant="scale" delay={160 + ci * 100}>
              <GlassCard tokens={tokens}>
                <div style={{ marginBottom: 16 }}>
                  <CircularIconBadge hint={category.iconHint} tokens={tokens} size={48} />
                </div>

                <SubHeadline tokens={tokens} style={{ marginBottom: 16 }}>
                  {category.name}
                </SubHeadline>

                <ul
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {(category.items ?? []).map((item, ii) => (
                    <li
                      key={ii}
                      style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.9rem',
                        fontWeight: 300,
                        color: tokens.textMuted,
                        lineHeight: 1.6,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
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
                      {item}
                    </li>
                  ))}
                </ul>
              </GlassCard>
            </Reveal>
          ))}
        </div>

        {content.diagram && (
          <ThemedMermaid diagram={content.diagram} tokens={tokens} delay={240} caption="Technology stack" />
        )}
      </div>

      <style>{`
        @media (max-width: 640px) {
          #techstack > div:last-child > div:nth-child(3) {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
