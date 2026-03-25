'use client';

import type { PluginTokens, ChallengeContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Body, Label } from '../shared/Typography';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { ThemedMermaid } from '../shared/ThemedMermaid';
import { InlineEditable } from '../editor/InlineEditable';

interface Props {
  content: ChallengeContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function ChallengeSection({ content, tokens, imageUrl, index, sectionId }: Props) {
  return (
    <section
      id="challenge"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: getSectionGradient('challenge', tokens),
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

        <div style={{ display: 'grid', gridTemplateColumns: (imageUrl || content.diagram) ? '1fr 1fr' : '1fr', gap: 'clamp(2rem, 4vw, 4rem)', alignItems: 'center' }}>
          <div>
            <Reveal delay={80}>
              <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
                <Headline tokens={tokens} style={{ marginBottom: 24 }}>
                  {content.headline}
                </Headline>
              </InlineEditable>
            </Reveal>

            <Reveal delay={160}>
              <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
                <Body tokens={tokens} style={{ marginBottom: 32 }}>
                  {content.body}
                </Body>
              </InlineEditable>
            </Reveal>

            {content.pullquote && (
              <Reveal delay={240}>
                <InlineEditable field="pullquote" label="Pull quote" value={content.pullquote ?? ''} multiline>
                  <blockquote
                    style={{
                      borderLeft: `3px solid ${tokens.accent}`,
                      paddingLeft: 24,
                      margin: 0,
                      fontFamily: `'${tokens.heroFont}', serif`,
                      fontWeight: tokens.heroWeight,
                      fontStyle: 'italic',
                      fontSize: 'clamp(1.1rem, 2.5vw, 1.4rem)',
                      lineHeight: 1.5,
                      color: tokens.text,
                    }}
                  >
                    {content.pullquote}
                  </blockquote>
                </InlineEditable>
              </Reveal>
            )}
          </div>

          {content.diagram ? (
            <ThemedMermaid diagram={content.diagram} tokens={tokens} delay={200} caption="Impact chain" />
          ) : imageUrl ? (
            <Reveal delay={200}>
              <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${tokens.border}` }}>
                <img src={imageUrl} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>
            </Reveal>
          ) : null}
        </div>
      </div>
    </section>
  );
}
