'use client';

import type { PluginTokens, DeliverablesContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Body, Label } from '../shared/Typography';
import { SectionIcon } from '../shared/SectionIcon';
import { GlassCard } from '../shared/GlassCard';

interface Props {
  content: DeliverablesContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
}

export function DeliverablesSection({ content, tokens, index }: Props) {
  return (
    <section
      id="deliverables"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: tokens.surface,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'absolute', left: '-3%', bottom: '5%', fontFamily: `'${tokens.heroFont}', serif`, fontSize: 'clamp(8rem, 18vw, 16rem)', fontWeight: tokens.heroWeight, color: tokens.text, opacity: 0.02, lineHeight: 1, pointerEvents: 'none', zIndex: 1 }}>
        {String(index + 1).padStart(2, '0')}
      </div>

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
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
            gap: 'clamp(1rem, 2vw, 1.5rem)',
          }}
        >
          {(content.items ?? []).map((item, ii) => (
            <Reveal key={ii} delay={160 + ii * 80}>
              <GlassCard tokens={tokens} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Icon badge */}
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: `linear-gradient(135deg, ${tokens.accent}25, ${tokens.accent}10)`,
                  border: `1px solid ${tokens.accent}30`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <SectionIcon hint={item.iconHint} color={tokens.accent} size={22} />
                </div>
                <h4
                  style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 700,
                    fontSize: '1rem',
                    color: tokens.text,
                    margin: 0,
                  }}
                >
                  {item.name}
                </h4>
                <Body tokens={tokens} style={{ fontSize: '0.875rem', lineHeight: 1.65 }}>
                  {item.detail}
                </Body>
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
