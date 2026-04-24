'use client';

import type { PluginTokens, DeliverablesContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';
import { InlineIconEdit } from '../editor/InlineIconEdit';

interface Props {
  content: DeliverablesContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function DeliverablesSection({ content, tokens }: Props) {
  const items = content.items ?? [];
  const accentRgb = tokens.accentRgb ?? '99,179,237';

  return (
    <section
      id="deliverables"
      style={{
        position: 'relative',
        padding: 'clamp(5rem, 10vw, 8rem) 2rem',
        background: tokens.surface,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      {/* Background accent orb — top left */}
      <div style={{
        position: 'absolute', top: '-8%', left: '-4%',
        width: 480, height: 480, borderRadius: '50%',
        background: `radial-gradient(circle, rgba(${accentRgb},0.06) 0%, transparent 65%)`,
        pointerEvents: 'none', zIndex: 0,
      }} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1040, margin: '0 auto' }}>

        {/* ── Header ── */}
        <Reveal>
          <div style={{
            display: 'flex', alignItems: 'flex-end',
            justifyContent: 'space-between',
            flexWrap: 'wrap' as const, gap: 16,
            marginBottom: 'clamp(2.5rem, 5vw, 4rem)',
          }}>
            <div>
              <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
                <span style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.62rem', fontWeight: 700,
                  letterSpacing: '0.18em', textTransform: 'uppercase' as const,
                  color: tokens.accent, display: 'block', marginBottom: 16,
                }}>
                  {content.eyebrow}
                </span>
              </InlineEditable>
              <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
                <h2 style={{
                  fontFamily: `'${tokens.heroFont}', serif`,
                  fontWeight: Number(tokens.heroWeight) || 700,
                  fontSize: 'clamp(2rem, 4vw, 3rem)',
                  lineHeight: 1.1, letterSpacing: '-0.03em',
                  color: tokens.text, margin: 0,
                }}>
                  {content.headline}
                </h2>
              </InlineEditable>
            </div>

            {/* Ghost count */}
            {items.length > 0 && (
              <div style={{ textAlign: 'right' as const, flexShrink: 0 }}>
                <div style={{
                  fontFamily: `'${tokens.heroFont}', serif`,
                  fontSize: 'clamp(2.5rem, 5vw, 4rem)',
                  fontWeight: 800, letterSpacing: '-0.05em',
                  color: `rgba(${accentRgb},0.12)`, lineHeight: 1,
                }}>
                  {String(items.length).padStart(2, '0')}
                </div>
                <div style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.58rem', fontWeight: 700,
                  letterSpacing: '0.14em', textTransform: 'uppercase' as const,
                  color: tokens.textSubtle,
                }}>
                  {content.eyebrow}
                </div>
              </div>
            )}
          </div>
        </Reveal>

        {/* ── Card grid ── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 'clamp(0.75rem, 1.5vw, 1rem)',
        }}>
          {items.map((item, ii) => {
            const isFirst = ii === 0;
            return (
              <Reveal key={ii} delay={80 + ii * 45}>
                <InlineArrayItem arrayPath="items" index={ii} total={items.length}>
                  <div style={{
                    position: 'relative',
                    borderRadius: 14,
                    border: `1px solid ${isFirst ? `rgba(${accentRgb},0.35)` : tokens.border}`,
                    background: isFirst
                      ? `linear-gradient(145deg, rgba(${accentRgb},0.08) 0%, ${tokens.surfaceCard} 60%)`
                      : tokens.surfaceCard,
                    boxShadow: isFirst
                      ? `0 4px 20px rgba(${accentRgb},0.12)`
                      : tokens.cardShadow,
                    padding: 'clamp(1.25rem, 2.5vw, 1.75rem)',
                    display: 'flex',
                    flexDirection: 'column' as const,
                    gap: 16,
                    overflow: 'hidden',
                    height: '100%',
                    boxSizing: 'border-box' as const,
                  }}>
                    {/* Top accent stripe */}
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0,
                      height: isFirst ? 3 : 2,
                      background: isFirst
                        ? tokens.accent
                        : `linear-gradient(90deg, rgba(${accentRgb},0.4), transparent)`,
                    }} />

                    {/* Icon row + ordinal */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 4,
                    }}>
                      {/* Icon container */}
                      <div style={{
                        width: 44, height: 44, borderRadius: 12,
                        background: isFirst
                          ? tokens.accent
                          : `rgba(${accentRgb},0.1)`,
                        border: isFirst ? 'none' : `1px solid rgba(${accentRgb},0.2)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                        boxShadow: isFirst ? `0 2px 12px rgba(${accentRgb},0.35)` : 'none',
                      }}>
                        <InlineIconEdit
                          fieldPath={`items.${ii}.iconHint`}
                          hint={item.iconHint}
                          color={isFirst ? (tokens.bg || '#fff') : tokens.accent}
                          size={20}
                          containerStyle={{ display: 'inline-flex' }}
                        />
                      </div>

                      {/* Ordinal */}
                      <span style={{
                        fontFamily: `'${tokens.heroFont}', serif`,
                        fontSize: '1.5rem', fontWeight: 800,
                        letterSpacing: '-0.04em', lineHeight: 1,
                        color: isFirst ? `rgba(${accentRgb},0.3)` : `rgba(${accentRgb},0.15)`,
                        userSelect: 'none' as const,
                      }}>
                        {String(ii + 1).padStart(2, '0')}
                      </span>
                    </div>

                    {/* Tag */}
                    {item.tag && (
                      <span style={{
                        alignSelf: 'flex-start' as const,
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.58rem', fontWeight: 700,
                        letterSpacing: '0.1em', textTransform: 'uppercase' as const,
                        color: tokens.accent,
                        background: `rgba(${accentRgb},0.1)`,
                        borderRadius: 4, padding: '3px 8px',
                      }}>
                        {item.tag}
                      </span>
                    )}

                    {/* Name */}
                    <InlineEditable field={`items.${ii}.name`} label="Name" value={item.name ?? ''}>
                      <h4 style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontWeight: 700,
                        fontSize: '0.95rem',
                        color: tokens.text,
                        margin: 0, lineHeight: 1.35,
                      }}>
                        {item.name}
                      </h4>
                    </InlineEditable>

                    {/* Divider */}
                    <div style={{
                      height: 1,
                      background: isFirst
                        ? `rgba(${accentRgb},0.2)`
                        : tokens.border,
                    }} />

                    {/* Detail */}
                    <InlineEditable field={`items.${ii}.detail`} label="Detail" value={item.detail ?? ''} multiline>
                      <p style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.85rem', lineHeight: 1.75,
                        color: tokens.textMuted, margin: 0,
                        flex: 1,
                      }}>
                        {item.detail}
                      </p>
                    </InlineEditable>
                  </div>
                </InlineArrayItem>
              </Reveal>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 20 }}>
          <InlineAddItem
            arrayPath="items"
            template={{ iconHint: 'document', name: 'New deliverable', detail: 'Describe this deliverable…' }}
            label="Add deliverable"
          />
        </div>
      </div>
    </section>
  );
}
