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

export function OverviewSection({ content, tokens }: Props) {
  const highlights = content.highlights ?? [];
  const cardRadius = parseInt(tokens.borderRadius ?? '10') || 10;

  return (
    <section
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: `linear-gradient(160deg, ${tokens.bg} 0%, ${tokens.surface} 100%)`,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      {/* Radial glow top-left */}
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: '45%', height: '60%',
        background: `radial-gradient(ellipse at top left, ${tokens.accent}14 0%, transparent 65%)`,
        pointerEvents: 'none', zIndex: 0,
      }} />

      {/* Dot grid */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `radial-gradient(${tokens.border} 1px, transparent 1px)`,
        backgroundSize: '30px 30px',
        opacity: 0.4, zIndex: 0, pointerEvents: 'none',
      }} />

      {/* Left accent bar */}
      <div style={{
        position: 'absolute', left: 0, top: '12%', bottom: '12%',
        width: 3,
        background: `linear-gradient(to bottom, transparent, ${tokens.accent}, transparent)`,
        zIndex: 2,
      }} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1060, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 'clamp(3rem, 6vw, 5rem)',
          }}
        >
          {/* ── Left: eyebrow + headline + body ── */}
          <div style={{ flex: highlights.length > 0 ? '3 1 0' : '1 1 0', minWidth: 0 }}>
            <Reveal>
              <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
                <Label tokens={tokens} style={{ display: 'block', marginBottom: 16 }}>
                  {content.eyebrow}
                </Label>
              </InlineEditable>
            </Reveal>

            <Reveal delay={60}>
              <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
                <Display tokens={tokens} gradient style={{ marginBottom: 20 }}>
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
                <div style={{ maxWidth: 500 }}>
                  {(content.body ?? '').split('\n\n').filter(Boolean).map((para, i) => (
                    <Body
                      key={i}
                      tokens={tokens}
                      style={{ lineHeight: 1.8, marginBottom: i < (content.body ?? '').split('\n\n').filter(Boolean).length - 1 ? '1em' : 0 }}
                    >
                      {para}
                    </Body>
                  ))}
                </div>
              </InlineEditable>
            </Reveal>
          </div>

          {/* ── Right: key highlights panel ── */}
          {highlights.length > 0 && (
            <div style={{ flex: '2 1 0', minWidth: 0, alignSelf: 'flex-start' }}>
            <Reveal delay={180}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.6rem, 1.5vw, 0.875rem)' }}>
                <p style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.6rem', fontWeight: 700,
                  letterSpacing: '0.13em', textTransform: 'uppercase' as const,
                  color: tokens.textSubtle ?? tokens.textMuted,
                  margin: '0 0 4px',
                }}>
                  At a Glance
                </p>
                {highlights.map((h, i) => (
                  <InlineArrayItem key={i} arrayPath="highlights" index={i} total={highlights.length}>
                    <div style={{
                      display: 'flex', alignItems: 'flex-start', gap: 14,
                      padding: 'clamp(0.9rem, 1.8vw, 1.2rem) clamp(1rem, 2vw, 1.4rem)',
                      borderRadius: cardRadius,
                      background: tokens.surfaceCard,
                      border: `1px solid ${tokens.border}`,
                      boxShadow: tokens.cardShadow,
                      position: 'relative', overflow: 'hidden',
                    }}>
                      <div style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0, width: 2,
                        background: tokens.accent,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <InlineEditable field={`highlights.${i}.value`} label="Value" value={h.value ?? ''}>
                          <p style={{
                            fontFamily: `'${tokens.bodyFont}', sans-serif`,
                            fontSize: '1rem', fontWeight: 700, lineHeight: 1.2,
                            color: tokens.accent, margin: '0 0 4px',
                          }}>{h.value}</p>
                        </InlineEditable>
                        <InlineEditable field={`highlights.${i}.label`} label="Label" value={h.label ?? ''}>
                          <p style={{
                            fontFamily: `'${tokens.bodyFont}', sans-serif`,
                            fontSize: '0.78rem', lineHeight: 1.45,
                            color: tokens.textMuted, fontWeight: 500, margin: 0,
                          }}>{h.label}</p>
                        </InlineEditable>
                      </div>
                    </div>
                  </InlineArrayItem>
                ))}

                <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 4 }}>
                  <InlineAddItem
                    arrayPath="highlights"
                    template={{ label: 'Key fact', value: '—' }}
                    label="Add highlight"
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
