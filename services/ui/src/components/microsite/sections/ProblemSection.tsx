'use client';

import type { PluginTokens, ProblemContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Label, Body } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';

interface Props {
  content: ProblemContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function ProblemSection({ content, tokens, sectionId }: Props) {
  const painPoints = content.painPoints ?? [];

  return (
    <section
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        overflow: 'hidden',
        background: tokens.bg,
      }}
    >
      {/* Mesh gradient background at low opacity */}
      {tokens.meshGradient && (
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: tokens.meshGradient,
          opacity: 0.15,
          zIndex: 1,
          pointerEvents: 'none',
        }} />
      )}

      <NoiseOverlay opacity={tokens.noiseOpacity} />

      {/* Decorative side border */}
      <div style={{
        position: 'absolute',
        left: 0,
        top: '10%',
        bottom: '10%',
        width: 4,
        background: `linear-gradient(180deg, transparent, ${tokens.accent}, transparent)`,
        zIndex: 3,
      }} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 880, margin: '0 auto' }}>
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', marginBottom: 20 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          {/* Gradient headline */}
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <h2 style={{
              fontFamily: `'${tokens.heroFont}', serif`,
              fontWeight: tokens.heroWeight,
              fontSize: 'clamp(1.8rem, 4vw, 3rem)',
              lineHeight: 1.1,
              margin: '0 0 28px',
              backgroundImage: tokens.gradientText,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              color: 'transparent',
            }}>
              {content.headline}
            </h2>
          </InlineEditable>
        </Reveal>

        <Reveal delay={160}>
          <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
            <Body tokens={tokens} style={{ fontSize: '1.05rem', lineHeight: 1.8, marginBottom: 44 }}>
              {content.body}
            </Body>
          </InlineEditable>
        </Reveal>

        {/* Pain points */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {painPoints.map((point, i) => (
            <Reveal key={i} delay={220 + i * 60}>
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 18,
                padding: '18px 24px',
                borderRadius: 12,
                background: `${tokens.accent}08`,
                border: `1px solid ${tokens.accent}20`,
              }}>
                {/* Marker */}
                <div style={{
                  flexShrink: 0,
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: `${tokens.accent}20`,
                  border: `1px solid ${tokens.accent}40`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  color: tokens.accent,
                }}>
                  ✗
                </div>
                <span style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.95rem',
                  fontWeight: 400,
                  color: tokens.text,
                  lineHeight: 1.6,
                }}>
                  {point}
                </span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
