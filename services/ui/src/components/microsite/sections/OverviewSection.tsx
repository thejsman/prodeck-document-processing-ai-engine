'use client';

import type { PluginTokens, OverviewContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Display, Body, Label } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

interface Props {
  content: OverviewContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

function DiamondIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
      <rect x="7" y="1" width="8.5" height="8.5" rx="1.5" transform="rotate(45 7 1)" fill={color} />
    </svg>
  );
}

export function OverviewSection({ content, tokens }: Props) {
  const highlights = content.highlights ?? [];

  return (
    <section
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: tokens.surface,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      {/* Subtle radial glow top-left */}
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: '45%', height: '60%',
        background: `radial-gradient(ellipse at top left, ${tokens.accent}12 0%, transparent 65%)`,
        pointerEvents: 'none', zIndex: 0,
      }} />

      {/* Left accent bar */}
      <div style={{
        position: 'absolute', left: 0, top: '15%', bottom: '15%',
        width: 3,
        background: `linear-gradient(to bottom, transparent, ${tokens.accent}, transparent)`,
        zIndex: 2,
      }} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1060, margin: '0 auto' }}>
        {/* Eyebrow */}
        <Reveal>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'clamp(2rem,4vw,3rem)' }}>
            <div style={{ width: 24, height: 2, background: tokens.accent, borderRadius: 2 }} />
            <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
              <Label tokens={tokens} style={{ letterSpacing: '0.12em' }}>
                {content.eyebrow}
              </Label>
            </InlineEditable>
          </div>
        </Reveal>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: highlights.length > 0 ? 'minmax(0,1.2fr) minmax(0,1fr)' : '1fr',
            gap: 'clamp(3rem, 6vw, 5rem)',
            alignItems: 'flex-start',
          }}
        >
          {/* ── Left: headline + body ── */}
          <div>
            <Reveal delay={60}>
              <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
                <Display tokens={tokens} gradient style={{ marginBottom: 24, lineHeight: 1.1 }}>
                  {content.headline}
                </Display>
              </InlineEditable>
            </Reveal>

            {content.subheadline?.trim() && (
              <Reveal delay={100}>
                <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline} multiline>
                  <Body tokens={tokens} style={{ fontSize: '0.95rem', maxWidth: 480, lineHeight: 1.75, marginBottom: 12 }}>
                    {content.subheadline}
                  </Body>
                </InlineEditable>
              </Reveal>
            )}

            <Reveal delay={140}>
              <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
                <div style={{ maxWidth: 520 }}>
                  {(content.body ?? '').split('\n\n').filter(Boolean).map((para, i, arr) => (
                    <Body
                      key={i}
                      tokens={tokens}
                      style={{ lineHeight: 1.8, marginBottom: i < arr.length - 1 ? '1em' : 0 }}
                    >
                      {para}
                    </Body>
                  ))}
                </div>
              </InlineEditable>
            </Reveal>
          </div>

          {/* ── Right: "This Proposal Covers" card list ── */}
          {highlights.length > 0 && (
            <div style={{ alignSelf: 'flex-start' }}>
              <Reveal delay={180}>
                <p style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.6rem', fontWeight: 700,
                  letterSpacing: '0.15em', textTransform: 'uppercase' as const,
                  color: tokens.textSubtle ?? tokens.textMuted,
                  margin: '0 0 12px',
                }}>
                  This Proposal Covers
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.5rem, 1.2vw, 0.75rem)' }}>
                  {highlights.map((h, i) => (
                    <Reveal key={i} delay={220 + i * 45}>
                      <InlineArrayItem arrayPath="highlights" index={i} total={highlights.length}>
                        <div style={{
                          display: 'flex', alignItems: 'flex-start', gap: 14,
                          padding: 'clamp(0.8rem, 1.6vw, 1.1rem) clamp(1rem, 2vw, 1.3rem)',
                          borderRadius: parseInt(tokens.borderRadius ?? '8') || 8,
                          background: tokens.surfaceCard,
                          border: `1px solid ${tokens.border}`,
                          boxShadow: tokens.cardShadow,
                          position: 'relative', overflow: 'hidden',
                        }}>
                          {/* Left accent bar */}
                          <div style={{
                            position: 'absolute', left: 0, top: 0, bottom: 0, width: 2,
                            background: tokens.accent,
                          }} />

                          {/* Diamond icon */}
                          <div style={{ paddingTop: 3, flexShrink: 0 }}>
                            <DiamondIcon color={tokens.accent} />
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <InlineEditable field={`highlights.${i}.value`} label="Title" value={h.value ?? ''}>
                              <p style={{
                                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                fontSize: '0.875rem', fontWeight: 700, lineHeight: 1.3,
                                color: tokens.text, margin: '0 0 3px',
                              }}>{h.value}</p>
                            </InlineEditable>
                            <InlineEditable field={`highlights.${i}.label`} label="Subtitle" value={h.label ?? ''}>
                              <p style={{
                                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                fontSize: '0.75rem', lineHeight: 1.5,
                                color: tokens.textMuted, margin: 0,
                              }}>{h.label}</p>
                            </InlineEditable>
                          </div>
                        </div>
                      </InlineArrayItem>
                    </Reveal>
                  ))}

                  <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 4 }}>
                    <InlineAddItem
                      arrayPath="highlights"
                      template={{ label: 'Brief description', value: 'Scope item' }}
                      label="Add item"
                    />
                  </div>
                </div>
              </Reveal>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
