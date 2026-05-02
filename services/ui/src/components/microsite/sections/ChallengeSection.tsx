'use client';

import type { PluginTokens, ChallengeContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { inlineMarkdownToHtml, hasMarkdown, rt } from '../shared/Typography';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

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
  const hasRightCol = imageUrl || highlights.length > 0;

  return (
    <section
      id="challenge"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 7vw, 6rem) 2rem',
        background: getSectionGradient('challenge', tokens),
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>

        {/* Eyebrow */}
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <span style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.6rem', fontWeight: 700,
                letterSpacing: '0.18em', textTransform: 'uppercase' as const,
                color: tokens.accent,
              }} {...rt(content.eyebrow ?? '')} />
              <div style={{ width: 28, height: 1, background: tokens.accent, flexShrink: 0 }} />
            </div>
          </InlineEditable>
        </Reveal>

        {/* Headline — full width above the columns */}
        <Reveal delay={60}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <h2 style={{
              fontFamily: `'${tokens.heroFont}', serif`,
              fontWeight: Number(tokens.heroWeight) || 700,
              fontSize: 'clamp(2rem, 4vw, 3rem)',
              lineHeight: 1.1,
              letterSpacing: '-0.03em',
              color: tokens.text,
              margin: '0 0 36px',
              maxWidth: hasRightCol ? '60%' : '100%',
            }} {...rt(content.headline ?? '')} />
          </InlineEditable>
        </Reveal>

        {/* 2-column: body + blockquote LEFT, stat grid or image RIGHT */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: hasRightCol ? '1fr 1fr' : '1fr',
          gap: 'clamp(2.5rem, 5vw, 5rem)',
          alignItems: 'start',
        }}>

          {/* LEFT — body + pullquote */}
          <div>
            <Reveal delay={120}>
              <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
                <p
                  style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.95rem', fontWeight: 300,
                    lineHeight: 1.8, color: tokens.textMuted,
                    margin: '0 0 16px',
                  }}
                  {...(hasMarkdown(content.body ?? '')
                    ? { dangerouslySetInnerHTML: { __html: inlineMarkdownToHtml(content.body ?? '') } }
                    : { children: content.body })}
                />
              </InlineEditable>
            </Reveal>

            {content.pullquote && (
              <Reveal delay={200}>
                <InlineEditable field="pullquote" label="Pull quote" value={content.pullquote ?? ''} multiline>
                  <blockquote style={{
                    margin: '28px 0 0',
                    padding: '20px 24px',
                    borderLeft: `3px solid ${tokens.accent}`,
                    background: `rgba(${accentRgb},0.05)`,
                  }}>
                    <p style={{
                      fontFamily: `'${tokens.heroFont}', serif`,
                      fontStyle: 'italic',
                      fontSize: '1rem',
                      lineHeight: 1.55,
                      color: tokens.text,
                      margin: 0,
                    }}
                      {...(hasMarkdown(content.pullquote ?? '')
                        ? { dangerouslySetInnerHTML: { __html: inlineMarkdownToHtml(content.pullquote ?? '') } }
                        : { children: content.pullquote })}
                    />
                  </blockquote>
                </InlineEditable>
              </Reveal>
            )}
          </div>

          {/* RIGHT — image or stat grid */}
          {hasRightCol && (
            imageUrl ? (
              <Reveal delay={160}>
                <div style={{ borderRadius: 8, overflow: 'hidden', boxShadow: tokens.cardShadow }}>
                  <img src={imageUrl} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
                </div>
              </Reveal>
            ) : highlights.length > 0 ? (
              <Reveal delay={160}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 1,
                  background: tokens.border,
                  border: `1px solid ${tokens.border}`,
                }}>
                  {highlights.map((h, i) => (
                    <InlineArrayItem
                      key={i}
                      arrayPath="highlights"
                      index={i}
                      total={highlights.length}
                      style={{
                        background: tokens.surface ?? tokens.bg,
                        ...(highlights.length === 3 && i === 2 ? { gridColumn: '1 / -1' } : {}),
                      }}
                    >
                      <div
                        style={{
                          background: tokens.surface ?? tokens.bg,
                          padding: 'clamp(1.25rem, 2.5vw, 1.75rem)',
                          display: 'flex',
                          flexDirection: 'column' as const,
                          alignItems: 'center',
                          textAlign: 'center' as const,
                          ...(highlights.length === 3 && i === 2 ? {
                            gridColumn: '1 / -1',
                          } : {}),
                        }}
                      >
                        {/* Big stat number */}
                        <InlineEditable field={`highlights.${i}.title`} label="Stat" value={h.title ?? ''}>
                          <div
                            style={{
                              fontFamily: `'${tokens.heroFont}', serif`,
                              fontWeight: Number(tokens.heroWeight) || 700,
                              fontSize: 'clamp(1.4rem, 2.5vw, 2rem)',
                              color: tokens.accent,
                              lineHeight: 1,
                              marginBottom: 5,
                            }}
                            {...rt(h.title ?? '')}
                          />
                        </InlineEditable>
                        {/* Label */}
                        {h.subtitle && (
                          <InlineEditable field={`highlights.${i}.subtitle`} label="Label" value={h.subtitle ?? ''}>
                            <div
                              style={{
                                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                fontSize: '0.6rem',
                                fontWeight: 500,
                                color: tokens.textMuted,
                                letterSpacing: '0.03em',
                                lineHeight: 1.4,
                              }}
                              {...rt(h.subtitle ?? '')}
                            />
                          </InlineEditable>
                        )}
                      </div>
                    </InlineArrayItem>
                  ))}
                </div>
              </Reveal>
            ) : null
          )}
        </div>

        {/* Add highlight — only visible in editor mode */}
        {highlights.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <InlineAddItem
              arrayPath="highlights"
              template={{ title: '0', subtitle: 'Metric label' }}
              label="Add stat"
            />
          </div>
        )}
      </div>
    </section>
  );
}
