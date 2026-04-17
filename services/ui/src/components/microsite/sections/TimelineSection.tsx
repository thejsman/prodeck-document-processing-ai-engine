'use client';

import type { PluginTokens, TimelineContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Body } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

interface Props {
  content: TimelineContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
      <path d="M2.5 7L5.5 10L11.5 4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TimelineSection({ content, tokens, index }: Props) {
  const phases = content.phases ?? [];

  return (
    <section
      id="timeline"
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
            {content.eyebrow || 'Timeline'}
          </span>
        </Reveal>

        {/* ── Headline + subheadline ── */}
        <Reveal delay={60}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <h2 style={{
              fontFamily: `'${tokens.heroFont}', serif`,
              fontWeight: Number(tokens.heroWeight) || 700,
              fontSize: 'clamp(1.1rem, 3vw, 1.8rem)',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              color: tokens.text,
              margin: '0 0 clamp(1rem, 2vw, 1.5rem)',
            }}>
              {content.headline}
            </h2>
          </InlineEditable>
        </Reveal>

        {content.subheadline && (
          <Reveal delay={130}>
            <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline ?? ''} multiline>
              <p style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.875rem',
                lineHeight: 1.8,
                color: tokens.textMuted,
                margin: '0 0 clamp(2.5rem, 5vw, 4rem)',
                maxWidth: 680,
              }}>
                {content.subheadline}
              </p>
            </InlineEditable>
          </Reveal>
        )}

        {/* ── Phase accordion cards ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {phases.map((phase, pi) => {
            const outcomes = phase.outcomes ?? [];
            const deliverables = phase.deliverables ?? [];
            const hasRichContent = outcomes.length > 0 || deliverables.length > 0;

            return (
              <Reveal key={pi} delay={200 + pi * 60}>
                <InlineArrayItem arrayPath="phases" index={pi} total={phases.length}>
                  <div style={{
                    borderTop: `1px solid ${tokens.border}`,
                    borderBottom: pi === phases.length - 1 ? `1px solid ${tokens.border}` : undefined,
                    background: tokens.surfaceCard,
                  }}>
                    {/* Phase header row */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 20,
                      padding: 'clamp(1.2rem, 2.5vw, 1.6rem) clamp(1.5rem, 3vw, 2.5rem)',
                      borderLeft: `3px solid ${tokens.accent}`,
                    }}>
                      <span style={{
                        fontFamily: `'${tokens.heroFont}', serif`,
                        fontSize: 'clamp(1rem, 2vw, 1.4rem)',
                        fontWeight: 700,
                        color: tokens.text,
                        opacity: 0.35,
                        lineHeight: 1,
                        letterSpacing: '-0.02em',
                        minWidth: 44,
                        userSelect: 'none' as const,
                      }}>
                        {String(pi + 1).padStart(2, '0')}
                      </span>
                      <div style={{ flex: 1 }}>
                        <InlineEditable field={`phases.${pi}.name`} label="Phase Name" value={phase.name ?? ''}>
                          <h3 style={{
                            fontFamily: `'${tokens.bodyFont}', sans-serif`,
                            fontWeight: 700,
                            fontSize: '0.875rem',
                            color: tokens.text,
                            margin: 0,
                            lineHeight: 1.3,
                          }}>
                            {phase.name}
                          </h3>
                        </InlineEditable>
                      </div>
                      {phase.duration && (
                        <InlineEditable field={`phases.${pi}.duration`} label="Duration" value={phase.duration ?? ''}>
                          <span style={{
                            fontFamily: `'${tokens.bodyFont}', sans-serif`,
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: tokens.accent,
                            padding: '4px 12px',
                            borderRadius: 20,
                            background: `${tokens.accent}15`,
                            border: `1px solid ${tokens.accent}30`,
                            whiteSpace: 'nowrap' as const,
                            flexShrink: 0,
                          }}>
                            {phase.duration}
                          </span>
                        </InlineEditable>
                      )}
                    </div>

                    {/* Phase body */}
                    <div style={{
                      padding: 'clamp(1.5rem, 3vw, 2rem) clamp(1.5rem, 3vw, 2.5rem) clamp(1.5rem, 3vw, 2rem) calc(44px + clamp(1.5rem, 3vw, 2.5rem) + 20px)',
                      borderLeft: `3px solid ${tokens.accent}20`,
                    }}>
                      {hasRichContent ? (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: deliverables.length > 0 ? 'minmax(0,1.2fr) minmax(0,0.8fr)' : '1fr',
                          gap: 'clamp(2rem, 4vw, 3rem)',
                          alignItems: 'flex-start',
                        }}>
                          {/* Left: description + outcomes grid */}
                          <div>
                            <InlineEditable field={`phases.${pi}.description`} label="Description" value={phase.description ?? ''} multiline>
                              <Body tokens={tokens} style={{ marginBottom: outcomes.length > 0 ? 'clamp(1rem, 2vw, 1.5rem)' : 0 }}>
                                {phase.description}
                              </Body>
                            </InlineEditable>

                            {outcomes.length > 0 && (
                              <>
                                <p style={{
                                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                  fontSize: '0.65rem',
                                  fontWeight: 600,
                                  letterSpacing: '0.14em',
                                  textTransform: 'uppercase' as const,
                                  color: tokens.textSubtle,
                                  margin: '0 0 12px',
                                }}>
                                  Outcomes
                                </p>
                                <div style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(2, 1fr)',
                                  gap: 8,
                                }}>
                                  {outcomes.map((outcome, oi) => (
                                    <div key={oi} style={{
                                      padding: '10px 14px',
                                      borderRadius: 6,
                                      border: `1px solid ${tokens.border}`,
                                      background: tokens.bg,
                                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                      fontSize: '0.82rem',
                                      color: tokens.textMuted,
                                      lineHeight: 1.4,
                                    }}>
                                      {outcome}
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>

                          {/* Right: deliverables checklist */}
                          {deliverables.length > 0 && (
                            <div>
                              <p style={{
                                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                fontSize: '0.65rem',
                                fontWeight: 600,
                                letterSpacing: '0.14em',
                                textTransform: 'uppercase' as const,
                                color: tokens.textSubtle,
                                margin: '0 0 12px',
                              }}>
                                Deliverables
                              </p>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {deliverables.map((d, di) => (
                                  <div key={di} style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 10,
                                  }}>
                                    <CheckIcon color={tokens.accent} />
                                    <span style={{
                                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                      fontSize: '0.88rem',
                                      color: tokens.textMuted,
                                      lineHeight: 1.5,
                                    }}>
                                      {d}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <InlineEditable field={`phases.${pi}.description`} label="Description" value={phase.description ?? ''} multiline>
                          <Body tokens={tokens}>{phase.description}</Body>
                        </InlineEditable>
                      )}
                    </div>
                  </div>
                </InlineArrayItem>
              </Reveal>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <InlineAddItem
            arrayPath="phases"
            template={{ label: 'Phase', name: 'New phase', duration: '2 weeks', description: 'Describe this phase…', outcomes: [], deliverables: [] }}
            label="Add phase"
          />
        </div>

      </div>
    </section>
  );
}
