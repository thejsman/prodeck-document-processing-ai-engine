'use client';

import type { PluginTokens, BenefitsContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { GlassCard } from '../shared/GlassCard';
import { Headline, Label, Body } from '../shared/Typography';
import { SectionIcon } from '../shared/SectionIcon';
import { InlineEditable } from '../editor/InlineEditable';

interface Props {
  content: BenefitsContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function BenefitsSection({ content, tokens, sectionId }: Props) {
  const items = content.items ?? [];
  const cols = items.length <= 3 ? items.length : Math.min(items.length, 3);

  return (
    <section
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: `linear-gradient(180deg, ${tokens.surface} 0%, ${tokens.bg} 100%)`,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', textAlign: 'center', marginBottom: 16 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>
        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ textAlign: 'center', marginBottom: 60 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 'clamp(1rem, 2.5vw, 2rem)',
        }}>
          {items.map((item, i) => (
            <Reveal key={i} delay={160 + i * 80}>
              <GlassCard tokens={tokens}>
                {/* Icon badge */}
                <div style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: `linear-gradient(135deg, ${tokens.accent}25, ${tokens.accent}10)`,
                  border: `1px solid ${tokens.accent}30`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 22,
                }}>
                  <SectionIcon hint={item.iconHint} color={tokens.accent} size={22} />
                </div>

                <div style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontWeight: 700,
                  fontSize: '1rem',
                  color: tokens.text,
                  marginBottom: 10,
                }}>
                  {item.title}
                </div>

                <Body tokens={tokens} style={{ fontSize: '0.9rem', lineHeight: 1.7 }}>
                  {item.description}
                </Body>
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
