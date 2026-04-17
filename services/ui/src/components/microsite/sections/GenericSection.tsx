'use client';

import type { PluginTokens, GenericContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { InlineEditable } from '../editor/InlineEditable';
import { ClickableDiagram } from '../editor/ClickableDiagram';

interface Props {
  content: GenericContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

function DiamondIcon({ color }: { color: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ flexShrink: 0, marginTop: 3 }}>
      <rect x="5.5" y="0.636" width="6.8" height="6.8" rx="0.8" transform="rotate(45 5.5 0.636)" fill={color} />
    </svg>
  );
}

export function GenericSection({ content, tokens, imageUrl, index, sectionId }: Props) {
  const listItems: Array<{ title: string; subtitle?: string }> = [
    ...(content.highlights ?? []).map(h => ({ title: h.title, subtitle: h.subtitle })),
    ...(content.items ?? []).map(i => ({ title: i.name, subtitle: i.detail })),
    ...(content.pillars ?? []).map(p => ({ title: p.name, subtitle: p.description })),
  ];

  const hasDiagram = !!content.diagram;

  // Two-column PATH layout when exactly 2 items
  const isTwoPath = listItems.length === 2;
  // Standard right-panel list when 3+ items
  const hasRightPanel = listItems.length >= 3;

  return (
    <section
      id={sectionId}
      style={{
        position: 'relative',
        padding: 'clamp(5rem, 9vw, 8rem) 2rem',
        background: index % 2 === 0 ? tokens.bg : tokens.surfaceAlt,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>

        {/* ── Eyebrow label ── */}
        <Reveal>
          <span style={{
            fontFamily: `'${tokens.bodyFont}', sans-serif`,
            fontSize: '0.68rem',
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase' as const,
            color: tokens.accent,
            display: 'block',
            marginBottom: 'clamp(1rem, 2vw, 1.5rem)',
          }}>
            {content.eyebrow || 'Section'}
          </span>
        </Reveal>

        {/* ── Headline + body (always left-aligned) ── */}
        <div style={{ maxWidth: hasRightPanel ? '55%' : 680 }}>
          <Reveal delay={60}>
            <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
              <h2 style={{
                fontFamily: `'${tokens.heroFont}', serif`,
                fontWeight: Number(tokens.heroWeight) || 700,
                fontSize: 'clamp(2rem, 4vw, 3.2rem)',
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                color: tokens.text,
                margin: '0 0 clamp(1.2rem, 2.5vw, 2rem)',
              }}>
                {content.headline}
              </h2>
            </InlineEditable>
          </Reveal>

          <Reveal delay={130}>
            <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
              <div style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: 'clamp(0.95rem, 1.5vw, 1.05rem)',
                lineHeight: 1.8,
                color: tokens.textMuted,
              }}>
                {(content.body ?? '').split('\n\n').filter(Boolean).map((para, i) => (
                  <p key={i} style={{ margin: i === 0 ? 0 : '1.1em 0 0' }}>{para}</p>
                ))}
              </div>
            </InlineEditable>
          </Reveal>
        </div>

        {/* ── Right panel (3+ items: diamond list) ── */}
        {hasRightPanel && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) minmax(0,0.85fr)',
            gap: 'clamp(3rem, 6vw, 6rem)',
            alignItems: 'flex-start',
            marginTop: 0,
          }}>
            {/* empty left col — headline/body already rendered above in full width */}
            <div />
            <div>
              <Reveal delay={160}>
                <p style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase' as const,
                  color: tokens.textSubtle,
                  margin: '0 0 clamp(1rem, 2vw, 1.5rem)',
                }}>
                  This section covers
                </p>
              </Reveal>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {listItems.map((item, i) => (
                  <Reveal key={i} delay={200 + i * 50}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 14,
                      padding: '16px 20px',
                      borderLeft: `2px solid ${tokens.accent}`,
                      background: tokens.surfaceCard,
                      borderRadius: '0 6px 6px 0',
                    }}>
                      <DiamondIcon color={tokens.accent} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontFamily: `'${tokens.bodyFont}', sans-serif`,
                          fontWeight: 600,
                          fontSize: '0.95rem',
                          color: tokens.text,
                          margin: 0,
                          lineHeight: 1.4,
                        }}>
                          {item.title}
                        </p>
                        {item.subtitle && (
                          <p style={{
                            fontFamily: `'${tokens.bodyFont}', sans-serif`,
                            fontSize: '0.82rem',
                            color: tokens.textMuted,
                            margin: '4px 0 0',
                            lineHeight: 1.55,
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

        {/* ── Two-column PATH layout (exactly 2 items) ── */}
        {isTwoPath && (
          <Reveal delay={200}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              marginTop: 'clamp(2.5rem, 5vw, 4rem)',
              border: `1px solid ${tokens.border}`,
              borderRadius: 8,
              overflow: 'hidden',
            }}>
              {listItems.map((item, i) => (
                <div
                  key={i}
                  style={{
                    padding: 'clamp(1.5rem, 3vw, 2.5rem)',
                    background: tokens.surfaceCard,
                    borderRight: i === 0 ? `1px solid ${tokens.accent}40` : undefined,
                  }}
                >
                  {/* Path label */}
                  <p style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase' as const,
                    color: tokens.accent,
                    margin: '0 0 12px',
                  }}>
                    Path {String(i + 1).padStart(2, '0')}
                  </p>

                  {/* Title */}
                  <h3 style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 700,
                    fontSize: 'clamp(1.05rem, 2vw, 1.3rem)',
                    color: tokens.text,
                    margin: '0 0 8px',
                    lineHeight: 1.3,
                  }}>
                    {item.title}
                  </h3>

                  {/* Dot-separated subtitle */}
                  {item.subtitle && (
                    <p style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.85rem',
                      color: tokens.textMuted,
                      margin: 0,
                      lineHeight: 1.5,
                    }}>
                      {item.subtitle}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Reveal>
        )}

        {/* ── No items: diagram or image ── */}
        {!hasRightPanel && !isTwoPath && (hasDiagram || imageUrl) && (
          <Reveal delay={220}>
            <div style={{ marginTop: 'clamp(2rem, 4vw, 3rem)' }}>
              {hasDiagram
                ? <ClickableDiagram diagram={content.diagram!} tokens={tokens} delay={0} caption="" />
                : <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${tokens.border}` }}>
                    <img src={imageUrl!} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
                  </div>
              }
            </div>
          </Reveal>
        )}

        {/* Diagram when right panel is present */}
        {(hasRightPanel || isTwoPath) && hasDiagram && (
          <Reveal delay={300}>
            <div style={{ marginTop: 'clamp(2rem, 4vw, 3rem)' }}>
              <ClickableDiagram diagram={content.diagram!} tokens={tokens} delay={0} caption="" />
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}
