'use client';

import type { PluginTokens, ChallengeContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { inlineMarkdownToHtml, hasMarkdown } from '../shared/Typography';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { InlineEditable } from '../editor/InlineEditable';

interface Props {
  content: ChallengeContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function ChallengeSection({ content, tokens, imageUrl }: Props) {
  const accentRgb = tokens.accentRgb ?? '99,179,237';
  const highlights = content.highlights ?? [];

  return (
    <section
      id="challenge"
      style={{
        position: 'relative',
        padding: 'clamp(5rem, 10vw, 8rem) 2rem',
        background: getSectionGradient('challenge', tokens),
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 880, margin: '0 auto' }}>

        {/* Eyebrow */}
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <span style={{
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: '0.62rem', fontWeight: 700,
              letterSpacing: '0.18em', textTransform: 'uppercase' as const,
              color: tokens.accent, display: 'block', marginBottom: 20,
            }}>
              {content.eyebrow}
            </span>
          </InlineEditable>
        </Reveal>

        {/* Headline + body — two-column when no image, single when image */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: imageUrl ? '1fr 1fr' : '5fr 4fr',
          gap: 'clamp(2.5rem, 5vw, 5rem)',
          alignItems: 'start',
          marginBottom: 'clamp(3rem, 6vw, 5rem)',
        }}>
          <Reveal delay={80}>
            <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
              <h2 style={{
                fontFamily: `'${tokens.heroFont}', serif`,
                fontWeight: Number(tokens.heroWeight) || 700,
                fontSize: 'clamp(2rem, 4vw, 3.2rem)',
                lineHeight: 1.1, letterSpacing: '-0.03em',
                color: tokens.text, margin: 0,
              }}>
                {content.headline}
              </h2>
            </InlineEditable>
          </Reveal>

          {imageUrl ? (
            <Reveal delay={160}>
              <div style={{ borderRadius: 8, overflow: 'hidden', boxShadow: tokens.cardShadow }}>
                <img src={imageUrl} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>
            </Reveal>
          ) : (
            <Reveal delay={160}>
              <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
                <p style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '1rem', lineHeight: 1.8,
                  color: tokens.textMuted, margin: 0,
                }}>
                  {content.body}
                </p>
              </InlineEditable>
            </Reveal>
          )}
        </div>

        {/* Body text when image is present */}
        {imageUrl && (
          <Reveal delay={200}>
            <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
              <p style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '1rem', lineHeight: 1.8,
                color: tokens.textMuted,
                margin: '0 0 clamp(2rem,4vw,3rem)',
                maxWidth: 640,
              }}>
                {content.body}
              </p>
            </InlineEditable>
          </Reveal>
        )}

        {/* Pull quote */}
        {content.pullquote && (
          <Reveal delay={260}>
            <InlineEditable field="pullquote" label="Pull quote" value={content.pullquote ?? ''} multiline>
              <blockquote style={{ margin: '0 0 clamp(2.5rem,5vw,4rem)', padding: 0, border: 'none' }}>
                <p style={{
                  fontFamily: `'${tokens.heroFont}', serif`,
                  fontWeight: Number(tokens.heroWeight) || 600,
                  fontStyle: 'italic',
                  fontSize: 'clamp(1.15rem, 2.2vw, 1.5rem)',
                  lineHeight: 1.55,
                  color: tokens.text,
                  margin: 0,
                  paddingLeft: 28,
                  borderLeft: `3px solid ${tokens.accent}`,
                }}
                  {...(hasMarkdown(content.pullquote ?? '')
                    ? { dangerouslySetInnerHTML: { __html: inlineMarkdownToHtml(content.pullquote ?? '') } }
                    : { children: content.pullquote })}
                />
              </blockquote>
            </InlineEditable>
          </Reveal>
        )}

        {/* Highlights — open numbered list, #heard style */}
        {highlights.length > 0 && (
          <>
            <div style={{ height: 1, background: tokens.border, marginBottom: 'clamp(2.5rem, 5vw, 4rem)' }} />
            <div>
              {highlights.map((h, i) => (
                <Reveal key={i} delay={300 + i * 65}>
                  <div style={{
                    position: 'relative',
                    display: 'grid',
                    gridTemplateColumns: '72px 1fr',
                    gap: 'clamp(1rem, 3vw, 2rem)',
                    alignItems: 'start',
                    paddingBottom: 'clamp(1.25rem, 2.5vw, 2rem)',
                    marginBottom: i < highlights.length - 1 ? 'clamp(1.25rem, 2.5vw, 2rem)' : 0,
                    borderBottom: i < highlights.length - 1 ? `1px solid ${tokens.border}` : 'none',
                  }}>
                    {/* Ordinal */}
                    <div style={{
                      fontFamily: `'${tokens.heroFont}', serif`,
                      fontSize: 'clamp(1.1rem, 2vw, 1.4rem)',
                      fontWeight: 700,
                      color: i === 0 ? tokens.accent : `rgba(${accentRgb},0.3)`,
                      letterSpacing: '-0.02em',
                      lineHeight: 1,
                      paddingTop: 3,
                    }}>
                      {String(i + 1).padStart(2, '0')}
                    </div>

                    {/* Content */}
                    <div>
                      <h3 style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontWeight: 700, fontSize: '1rem',
                        color: tokens.text, margin: '0 0 6px', lineHeight: 1.35,
                      }}>
                        {h.title}
                      </h3>
                      {h.subtitle && (
                        <p style={{
                          fontFamily: `'${tokens.bodyFont}', sans-serif`,
                          fontSize: '0.9rem', color: tokens.textMuted,
                          margin: 0, lineHeight: 1.75,
                        }}>
                          {h.subtitle}
                        </p>
                      )}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
