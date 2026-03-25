'use client';

import type { PluginTokens, SecurityContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { CircularIconBadge } from '../shared/CircularIconBadge';
import { Headline, Body, Label } from '../shared/Typography';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { ThemedMermaid } from '../shared/ThemedMermaid';

interface Props {
  content: SecurityContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
}

export function SecuritySection({ content, tokens }: Props) {
  return (
    <section
      id="security"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: getSectionGradient('security', tokens),
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
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 'clamp(2rem, 4vw, 3rem)',
          }}
        >
          {(content.items ?? []).map((item, si) => (
            <Reveal key={si} variant="fadeUp" delay={160 + si * 80}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 12,
                }}
              >
                <CircularIconBadge hint={item.iconHint} tokens={tokens} size={44} />

                <h4
                  style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 600,
                    fontSize: '1.05rem',
                    color: tokens.text,
                    margin: 0,
                    lineHeight: 1.3,
                  }}
                >
                  {item.name}
                </h4>

                <Body tokens={tokens} style={{ fontSize: '0.9rem' }}>
                  {item.description}
                </Body>
              </div>
            </Reveal>
          ))}
        </div>

        {content.diagram && (
          <ThemedMermaid diagram={content.diagram} tokens={tokens} delay={240} caption="Security architecture" />
        )}
      </div>
    </section>
  );
}
