'use client';

import type { PluginTokens, GenericContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Body, Label } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';

interface Props {
  content: GenericContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function GenericSection({ content, tokens, imageUrl, index, sectionId }: Props) {
  const isEven = index % 2 === 0;
  return (
    <section
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: isEven ? tokens.bg : tokens.surfaceAlt,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'absolute', [isEven ? 'right' : 'left']: '-3%', top: '10%', fontFamily: `'${tokens.heroFont}', serif`, fontSize: 'clamp(8rem, 18vw, 16rem)', fontWeight: tokens.heroWeight, color: tokens.text, opacity: 0.02, lineHeight: 1, pointerEvents: 'none', zIndex: 1 }}>
        {String(index + 1).padStart(2, '0')}
      </div>

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: imageUrl ? '1fr 1fr' : '1fr', gap: 'clamp(2rem, 4vw, 4rem)', alignItems: 'center' }}>
          <div style={{ order: isEven ? 0 : 1 }}>
            <Reveal>
              <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
                <Label tokens={tokens} style={{ display: 'block', marginBottom: 16 }}>
                  {content.eyebrow}
                </Label>
              </InlineEditable>
            </Reveal>

            <Reveal delay={80}>
              <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
                <Headline tokens={tokens} style={{ marginBottom: 20 }}>
                  {content.headline}
                </Headline>
              </InlineEditable>
            </Reveal>

            <Reveal delay={160}>
              <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
                <Body tokens={tokens}>
                  {content.body}
                </Body>
              </InlineEditable>
            </Reveal>
          </div>

          {imageUrl && (
            <Reveal delay={200} style={{ order: isEven ? 1 : 0 }}>
              <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${tokens.border}` }}>
                <img src={imageUrl} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>
            </Reveal>
          )}
        </div>
      </div>
    </section>
  );
}
