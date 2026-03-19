'use client';

import type { PluginTokens, TimelineContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Body, Label } from '../shared/Typography';
import { ThemedMermaid } from '../shared/ThemedMermaid';

interface Props {
  content: TimelineContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
}

export function TimelineSection({ content, tokens, index }: Props) {
  return (
    <section
      id="timeline"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: tokens.surfaceAlt,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'absolute', right: '-3%', top: '10%', fontFamily: `'${tokens.heroFont}', serif`, fontSize: 'clamp(8rem, 18vw, 16rem)', fontWeight: tokens.heroWeight, color: tokens.text, opacity: 0.02, lineHeight: 1, pointerEvents: 'none', zIndex: 1 }}>
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

        {content.subheadline && (
          <Reveal delay={160}>
            <Body tokens={tokens} style={{ maxWidth: 600, marginBottom: 48 }}>
              {content.subheadline}
            </Body>
          </Reveal>
        )}

        {content.diagram && (
          <div style={{ marginBottom: 'clamp(2.5rem, 4vw, 3rem)' }}>
            <ThemedMermaid
              diagram={content.diagram}
              tokens={tokens}
              delay={240}
              caption="Project schedule"
            />
          </div>
        )}

        {/* Timeline track */}
        <div style={{ position: 'relative', paddingLeft: 40 }}>
          {/* Vertical line */}
          <div
            style={{
              position: 'absolute',
              left: 11,
              top: 0,
              bottom: 0,
              width: 2,
              background: `linear-gradient(to bottom, ${tokens.accent}, ${tokens.border})`,
            }}
          />

          {(content.phases ?? []).map((phase, pi) => (
            <Reveal key={pi} delay={240 + pi * 80}>
              <div style={{ position: 'relative', paddingBottom: pi < (content.phases ?? []).length - 1 ? 40 : 0 }}>
                {/* Dot */}
                <div
                  style={{
                    position: 'absolute',
                    left: -40 + 3,
                    top: 4,
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: tokens.bg,
                    border: `2px solid ${tokens.accent}`,
                    zIndex: 2,
                  }}
                >
                  <div style={{ position: 'absolute', inset: 4, borderRadius: '50%', background: tokens.accent }} />
                </div>

                {/* Phase card */}
                <div
                  style={{
                    padding: '20px 24px',
                    borderRadius: 8,
                    border: `1px solid ${tokens.border}`,
                    background: tokens.surfaceCard,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                    <h4
                      style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontWeight: 600,
                        fontSize: '1rem',
                        color: tokens.text,
                        margin: 0,
                      }}
                    >
                      {phase.name}
                    </h4>
                    <span
                      style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: tokens.accent,
                        padding: '2px 10px',
                        borderRadius: 20,
                        background: `${tokens.accent}15`,
                        border: `1px solid ${tokens.accent}30`,
                      }}
                    >
                      {phase.duration}
                    </span>
                  </div>
                  <Body tokens={tokens} style={{ fontSize: '0.9rem' }}>
                    {phase.description}
                  </Body>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
