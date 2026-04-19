'use client';

import type { PluginTokens, GenericContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { InlineEditable } from '../editor/InlineEditable';

interface Props {
  content: GenericContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function GenericSection({ content, tokens, imageUrl, index, sectionId }: Props) {
  const listItems: Array<{ title: string; subtitle?: string }> = [
    ...(content.highlights ?? []).map(h => ({ title: h.title, subtitle: h.subtitle })),
    ...(content.items ?? []).map(i => ({ title: i.name, subtitle: i.detail })),
    ...(content.pillars ?? []).map(p => ({ title: p.name, subtitle: p.description })),
  ];

  const isTwoPath = listItems.length === 2;
  const hasRightPanel = listItems.length >= 3;
  const bgBase = index % 2 === 0 ? tokens.bg : tokens.surfaceAlt;

  return (
    <section
      id={sectionId}
      style={{
        position: 'relative',
        padding: 'clamp(5rem, 9vw, 8rem) 2rem',
        background: bgBase,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      {/* Decorative gradient orb */}
      <div style={{
        position: 'absolute', top: '10%', right: '-8%',
        width: 450, height: 450, borderRadius: '50%',
        background: `radial-gradient(circle, ${tokens.accent}09 0%, transparent 70%)`,
        pointerEvents: 'none', zIndex: 1,
      }} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>

        {/* Eyebrow */}
        <Reveal>
          <span style={{
            fontFamily: `'${tokens.bodyFont}', sans-serif`,
            fontSize: '0.68rem', fontWeight: 600,
            letterSpacing: '0.14em', textTransform: 'uppercase' as const,
            color: tokens.accent, display: 'block',
            marginBottom: 'clamp(0.75rem, 1.5vw, 1rem)',
          }}>
            {content.eyebrow || 'Section'}
          </span>
        </Reveal>

        {/* Headline + decorative underline */}
        <div style={{ maxWidth: hasRightPanel ? '55%' : 720 }}>
          <Reveal delay={60}>
            <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
              <h2 style={{
                fontFamily: `'${tokens.heroFont}', serif`,
                fontWeight: Number(tokens.heroWeight) || 700,
                fontSize: 'clamp(1.2rem, 3vw, 2rem)',
                lineHeight: 1.12,
                letterSpacing: '-0.02em',
                color: tokens.text,
                margin: '0 0 clamp(1rem, 2vw, 1.5rem)',
              }}>
                {content.headline}
              </h2>
            </InlineEditable>
          </Reveal>

          {/* Accent underline stripe */}
          <Reveal delay={90}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              marginBottom: 'clamp(1.5rem, 3vw, 2.5rem)',
            }}>
              <div style={{ height: 2, width: 36, background: tokens.accent, borderRadius: 2 }} />
              <div style={{ height: 2, width: 16, background: `${tokens.accent}50`, borderRadius: 2 }} />
              <div style={{ height: 2, width: 8, background: `${tokens.accent}25`, borderRadius: 2 }} />
            </div>
          </Reveal>

          <Reveal delay={130}>
            <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
              <div style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.9rem', lineHeight: 1.8,
                color: tokens.textMuted,
              }}>
                {(content.body ?? '').split('\n\n').filter(Boolean).map((para, i) => (
                  <p key={i} style={{ margin: i === 0 ? 0 : '1.1em 0 0' }}>{para}</p>
                ))}
              </div>
            </InlineEditable>
          </Reveal>
        </div>

        {/* Right panel: 3+ items as premium cards */}
        {hasRightPanel && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) minmax(0,0.85fr)',
            gap: 'clamp(3rem, 6vw, 6rem)',
            alignItems: 'flex-start',
            marginTop: 0,
          }}>
            <div />
            <div>
              <Reveal delay={160}>
                <p style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.62rem', fontWeight: 600,
                  letterSpacing: '0.14em', textTransform: 'uppercase' as const,
                  color: tokens.textSubtle,
                  margin: '0 0 clamp(0.75rem, 1.5vw, 1.25rem)',
                }}>
                  Key points
                </p>
              </Reveal>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {listItems.map((item, i) => (
                  <Reveal key={i} delay={200 + i * 50}>
                    <div style={{
                      display: 'flex', alignItems: 'flex-start', gap: 14,
                      padding: '14px 18px',
                      borderRadius: '0 10px 10px 0',
                      borderLeft: `3px solid ${tokens.accent}`,
                      background: `linear-gradient(90deg, ${tokens.accent}08, ${tokens.surfaceCard})`,
                      boxShadow: `inset 0 0 0 1px ${tokens.border}`,
                      transition: 'transform 0.15s',
                    }}>
                      {/* Dot */}
                      <div style={{
                        flexShrink: 0, marginTop: 5,
                        width: 6, height: 6, borderRadius: '50%',
                        background: tokens.accent,
                        boxShadow: `0 0 6px ${tokens.accent}60`,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontFamily: `'${tokens.bodyFont}', sans-serif`,
                          fontWeight: 600, fontSize: '0.825rem',
                          color: tokens.text, margin: 0, lineHeight: 1.4,
                        }}>
                          {item.title}
                        </p>
                        {item.subtitle && (
                          <p style={{
                            fontFamily: `'${tokens.bodyFont}', sans-serif`,
                            fontSize: '0.8rem', color: tokens.textMuted,
                            margin: '4px 0 0', lineHeight: 1.55,
                          }}>
                            {item.subtitle}
                          </p>
                        )}
                      </div>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Two-column path layout */}
        {isTwoPath && (
          <Reveal delay={200}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              marginTop: 'clamp(2.5rem, 5vw, 4rem)',
              gap: 2,
              borderRadius: tokens.borderRadius ?? '12px',
              overflow: 'hidden',
              border: `1px solid ${tokens.border}`,
              boxShadow: tokens.cardShadow,
            }}>
              {listItems.map((item, i) => (
                <div
                  key={i}
                  style={{
                    position: 'relative',
                    padding: 'clamp(1.5rem, 3vw, 2.5rem)',
                    background: i === 0
                      ? `linear-gradient(135deg, ${tokens.accent}10, ${tokens.surfaceCard})`
                      : tokens.surfaceCard,
                    borderRight: i === 0 ? `1px solid ${tokens.accent}25` : undefined,
                    overflow: 'hidden',
                  }}
                >
                  {/* Path number */}
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '4px 12px',
                    borderRadius: 100,
                    background: `${tokens.accent}12`,
                    border: `1px solid ${tokens.accent}25`,
                    marginBottom: 16,
                  }}>
                    <span style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.62rem', fontWeight: 700,
                      letterSpacing: '0.1em', textTransform: 'uppercase' as const,
                      color: tokens.accent,
                    }}>
                      Option {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>

                  <h3 style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 700, fontSize: '0.95rem',
                    color: tokens.text, margin: '0 0 10px', lineHeight: 1.3,
                  }}>
                    {item.title}
                  </h3>

                  {item.subtitle && (
                    <p style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.825rem', color: tokens.textMuted,
                      margin: 0, lineHeight: 1.6,
                    }}>
                      {item.subtitle}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Reveal>
        )}

        {/* No items: image */}
        {!hasRightPanel && !isTwoPath && imageUrl && (
          <Reveal delay={220}>
            <div style={{ marginTop: 'clamp(2rem, 4vw, 3rem)' }}>
              <div style={{
                borderRadius: tokens.borderRadius ?? '12px',
                overflow: 'hidden',
                border: `1px solid ${tokens.border}`,
                boxShadow: tokens.cardShadow,
              }}>
                <img src={imageUrl} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}
