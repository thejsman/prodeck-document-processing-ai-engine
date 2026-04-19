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

  const bgBase = index % 2 === 0 ? tokens.bg : tokens.surfaceAlt;
  const hasItems = listItems.length > 0;

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

      {/* Background watermark number */}
      <div style={{
        position: 'absolute', bottom: '-2%', right: '2%',
        fontFamily: `'${tokens.heroFont}', serif`,
        fontSize: 'clamp(8rem, 18vw, 16rem)',
        fontWeight: 900,
        color: `${tokens.accent}06`,
        lineHeight: 1,
        pointerEvents: 'none', userSelect: 'none',
        zIndex: 1,
      }}>
        {String(index + 1).padStart(2, '0')}
      </div>

      {/* Top accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: `linear-gradient(90deg, transparent, ${tokens.accent}40, transparent)`,
        zIndex: 2,
      }} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>

        {/* Header — centered */}
        <div style={{ maxWidth: 720, margin: '0 auto 0', textAlign: 'center' }}>
          <Reveal>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: '0.65rem', fontWeight: 700,
              letterSpacing: '0.18em', textTransform: 'uppercase' as const,
              color: tokens.accent,
              marginBottom: 'clamp(0.75rem, 1.5vw, 1rem)',
            }}>
              <span style={{ width: 20, height: 1, background: tokens.accent, display: 'inline-block' }} />
              {content.eyebrow || 'Overview'}
              <span style={{ width: 20, height: 1, background: tokens.accent, display: 'inline-block' }} />
            </span>
          </Reveal>

          <Reveal delay={60}>
            <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
              <h2 style={{
                fontFamily: `'${tokens.heroFont}', serif`,
                fontWeight: Number(tokens.heroWeight) || 700,
                fontSize: 'clamp(1.4rem, 3.2vw, 2.2rem)',
                lineHeight: 1.12,
                letterSpacing: '-0.02em',
                color: tokens.text,
                margin: '0 0 clamp(1.25rem, 2.5vw, 2rem)',
              }}>
                {content.headline}
              </h2>
            </InlineEditable>
          </Reveal>

          {content.body && (
            <Reveal delay={100}>
              <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
                <div style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.9rem', lineHeight: 1.85,
                  color: tokens.textMuted,
                  marginBottom: hasItems ? 'clamp(3rem, 6vw, 5rem)' : 0,
                }}>
                  {(content.body ?? '').split('\n\n').filter(Boolean).map((para, i) => (
                    <p key={i} style={{ margin: i === 0 ? 0 : '1em 0 0' }}>{para}</p>
                  ))}
                </div>
              </InlineEditable>
            </Reveal>
          )}
        </div>

        {/* Items — 2-column numbered card grid */}
        {hasItems && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: listItems.length === 1 ? '1fr' : 'repeat(2, 1fr)',
            gap: 'clamp(0.75rem, 2vw, 1.25rem)',
            marginTop: content.body ? 0 : 'clamp(2.5rem, 5vw, 4rem)',
          }}>
            {listItems.map((item, i) => {
              const isEven = i % 2 === 0;
              return (
                <Reveal key={i} delay={150 + i * 60}>
                  <div style={{
                    position: 'relative',
                    padding: 'clamp(1.5rem, 3vw, 2rem)',
                    borderRadius: tokens.borderRadius ?? '14px',
                    background: isEven
                      ? `linear-gradient(135deg, ${tokens.accent}0d, ${tokens.surfaceCard})`
                      : tokens.surfaceCard,
                    border: `1px solid ${isEven ? tokens.accent + '22' : tokens.border}`,
                    boxShadow: isEven ? `0 4px 24px ${tokens.accent}0a, ${tokens.cardShadow ?? ''}` : tokens.cardShadow,
                    overflow: 'hidden',
                    transition: 'transform 0.18s, box-shadow 0.18s',
                  }}>
                    {/* Subtle corner glow on even cards */}
                    {isEven && (
                      <div style={{
                        position: 'absolute', top: 0, right: 0,
                        width: 100, height: 100,
                        background: `radial-gradient(circle at top right, ${tokens.accent}14, transparent 70%)`,
                        pointerEvents: 'none',
                      }} />
                    )}

                    {/* Item number badge */}
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 32, height: 32, borderRadius: '50%',
                      background: `${tokens.accent}15`,
                      border: `1px solid ${tokens.accent}30`,
                      marginBottom: 'clamp(0.75rem, 1.5vw, 1rem)',
                    }}>
                      <span style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.65rem', fontWeight: 800,
                        color: tokens.accent,
                        letterSpacing: '0.05em',
                      }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                    </div>

                    <h3 style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontWeight: 700,
                      fontSize: 'clamp(0.85rem, 1.4vw, 0.95rem)',
                      color: tokens.text,
                      margin: '0 0 clamp(0.5rem, 1vw, 0.75rem)',
                      lineHeight: 1.35,
                    }}>
                      {item.title}
                    </h3>

                    {item.subtitle && (
                      <p style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.82rem',
                        color: tokens.textMuted,
                        margin: 0,
                        lineHeight: 1.7,
                      }}>
                        {item.subtitle}
                      </p>
                    )}
                  </div>
                </Reveal>
              );
            })}
          </div>
        )}

        {/* No items: image fallback */}
        {!hasItems && imageUrl && (
          <Reveal delay={180}>
            <div style={{
              marginTop: 'clamp(2.5rem, 5vw, 4rem)',
              borderRadius: tokens.borderRadius ?? '14px',
              overflow: 'hidden',
              border: `1px solid ${tokens.border}`,
              boxShadow: tokens.cardShadow,
            }}>
              <img src={imageUrl} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}
