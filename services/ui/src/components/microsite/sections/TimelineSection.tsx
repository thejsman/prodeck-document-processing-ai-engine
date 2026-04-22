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
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
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

      {/* Decorative gradient orb */}
      <div style={{
        position: 'absolute', bottom: '-10%', right: '-8%',
        width: 500, height: 500, borderRadius: '50%',
        background: `radial-gradient(circle, ${tokens.accent}08 0%, transparent 70%)`,
        pointerEvents: 'none', zIndex: 1,
      }} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <Reveal>
          <span style={{
            fontFamily: `'${tokens.bodyFont}', sans-serif`,
            fontSize: '0.68rem', fontWeight: 600,
            letterSpacing: '0.14em', textTransform: 'uppercase' as const,
            color: tokens.accent, display: 'block',
            marginBottom: 'clamp(0.75rem, 1.5vw, 1rem)',
          }}>
            {content.eyebrow || 'Timeline'}
          </span>
        </Reveal>

        <Reveal delay={60}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <h2 style={{
              fontFamily: `'${tokens.heroFont}', serif`,
              fontWeight: Number(tokens.heroWeight) || 700,
              fontSize: 'clamp(1.2rem, 3vw, 2rem)',
              lineHeight: 1.1, letterSpacing: '-0.02em',
              color: tokens.text, margin: 0,
            }}>
              {content.headline}
            </h2>
          </InlineEditable>
        </Reveal>

        {/* Accent underline */}
        <Reveal delay={90}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 'clamp(1rem, 2vw, 1.5rem) 0' }}>
            <div style={{ height: 2, width: 36, background: tokens.accent, borderRadius: 2 }} />
            <div style={{ height: 2, width: 16, background: `${tokens.accent}50`, borderRadius: 2 }} />
            <div style={{ height: 2, width: 8, background: `${tokens.accent}25`, borderRadius: 2 }} />
          </div>
        </Reveal>

        {content.subheadline && (
          <Reveal delay={130}>
            <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline ?? ''} multiline>
              <p style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.875rem', lineHeight: 1.8,
                color: tokens.textMuted, margin: '0 0 clamp(2rem, 4vw, 3.5rem)',
                maxWidth: 640,
              }}>
                {content.subheadline}
              </p>
            </InlineEditable>
          </Reveal>
        )}

        {/* Summary stats bar */}
        {(content.summary ?? []).length > 0 && (
          <Reveal delay={160}>
            <div style={{
              display: 'flex', gap: 'clamp(24px,4vw,48px)',
              justifyContent: 'center', marginBottom: 52, flexWrap: 'wrap',
            }}>
              {(content.summary ?? []).map((s, i) => (
                <div key={i} style={{ textAlign: 'center' }}>
                  <div style={{
                    fontSize: 'clamp(2rem,4vw,2.8rem)', fontWeight: 800,
                    color: tokens.accent, lineHeight: 1,
                    fontFamily: `'${tokens.heroFont}', sans-serif`,
                  }}>{s.number}</div>
                  <div style={{
                    fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.1em',
                    textTransform: 'uppercase' as const, color: tokens.textMuted, marginTop: 6,
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  }}>{s.label}</div>
                </div>
              ))}
            </div>
          </Reveal>
        )}

        {/* Phase cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {phases.map((phase, pi) => {
            const outcomes = phase.outcomes ?? [];
            const deliverables = phase.deliverables ?? [];
            const hasRichContent = outcomes.length > 0 || deliverables.length > 0;
            const isLast = pi === phases.length - 1;

            return (
              <Reveal key={pi} delay={200 + pi * 60}>
                <InlineArrayItem arrayPath="phases" index={pi} total={phases.length}>
                  <div style={{ display: 'flex', gap: 0 }}>
                    {/* Timeline spine column */}
                    <div style={{
                      flexShrink: 0, width: 64,
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                    }}>
                      {/* Node circle */}
                      <div style={{
                        width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                        background: `linear-gradient(135deg, ${tokens.accent}30, ${tokens.accent}60)`,
                        border: `2px solid ${tokens.accent}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: `0 0 16px ${tokens.accent}30`,
                        zIndex: 2,
                      }}>
                        <span style={{
                          fontFamily: `'${tokens.heroFont}', sans-serif`,
                          fontWeight: 800, fontSize: '0.7rem',
                          color: tokens.accent, letterSpacing: '-0.01em',
                        }}>
                          {String(pi + 1).padStart(2, '0')}
                        </span>
                      </div>
                      {/* Spine line */}
                      {!isLast && (
                        <div style={{
                          width: 2, flex: 1, minHeight: 32,
                          background: `linear-gradient(180deg, ${tokens.accent}40, ${tokens.border}40)`,
                          margin: '4px 0',
                        }} />
                      )}
                    </div>

                    {/* Phase content */}
                    <div style={{
                      flex: 1, minWidth: 0,
                      paddingBottom: isLast ? 0 : 'clamp(1.5rem, 3vw, 2.5rem)',
                      paddingLeft: 'clamp(1rem, 2vw, 1.5rem)',
                      paddingTop: 6,
                    }}>
                      {/* Phase header */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        marginBottom: 12, flexWrap: 'wrap' as const,
                      }}>
                        <InlineEditable field={`phases.${pi}.name`} label="Phase Name" value={phase.name ?? ''}>
                          <h3 style={{
                            fontFamily: `'${tokens.bodyFont}', sans-serif`,
                            fontWeight: 700, fontSize: '0.925rem',
                            color: tokens.text, margin: 0, lineHeight: 1.3,
                          }}>
                            {phase.name}
                          </h3>
                        </InlineEditable>
                        {phase.duration && (
                          <InlineEditable field={`phases.${pi}.duration`} label="Duration" value={phase.duration ?? ''}>
                            <span style={{
                              fontFamily: `'${tokens.bodyFont}', sans-serif`,
                              fontSize: '0.68rem', fontWeight: 700,
                              color: tokens.accent,
                              padding: '3px 10px',
                              borderRadius: 100,
                              background: `${tokens.accent}14`,
                              border: `1px solid ${tokens.accent}30`,
                              whiteSpace: 'nowrap' as const,
                              flexShrink: 0,
                            }}>
                              {phase.duration}
                            </span>
                          </InlineEditable>
                        )}
                      </div>

                      {/* Phase card body */}
                      <div style={{
                        padding: 'clamp(1.2rem, 2.5vw, 1.75rem)',
                        borderRadius: tokens.borderRadius ?? '12px',
                        border: `1px solid ${tokens.border}`,
                        background: `linear-gradient(145deg, ${tokens.surfaceCard}, ${tokens.surface})`,
                        boxShadow: tokens.cardShadow,
                      }}>
                        {hasRichContent ? (
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: deliverables.length > 0 ? 'minmax(0,1.2fr) minmax(0,0.85fr)' : '1fr',
                            gap: 'clamp(1.5rem, 3vw, 2.5rem)',
                            alignItems: 'flex-start',
                          }}>
                            <div>
                              <InlineEditable field={`phases.${pi}.description`} label="Description" value={phase.description ?? ''} multiline>
                                <Body tokens={tokens} style={{ marginBottom: outcomes.length > 0 ? 'clamp(1rem, 2vw, 1.5rem)' : 0, lineHeight: 1.75 }}>
                                  {phase.description}
                                </Body>
                              </InlineEditable>

                              {outcomes.length > 0 && (
                                <>
                                  <p style={{
                                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                    fontSize: '0.62rem', fontWeight: 700,
                                    letterSpacing: '0.12em', textTransform: 'uppercase' as const,
                                    color: tokens.textSubtle, margin: '0 0 10px',
                                  }}>Outcomes</p>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                                    {outcomes.map((outcome, oi) => (
                                      <div key={oi} style={{
                                        padding: '9px 12px',
                                        borderRadius: 8,
                                        border: `1px solid ${tokens.border}`,
                                        background: `${tokens.accent}06`,
                                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                        fontSize: '0.8rem',
                                        color: tokens.textMuted, lineHeight: 1.4,
                                      }}>
                                        {outcome}
                                      </div>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>

                            {deliverables.length > 0 && (
                              <div>
                                <p style={{
                                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                  fontSize: '0.62rem', fontWeight: 700,
                                  letterSpacing: '0.12em', textTransform: 'uppercase' as const,
                                  color: tokens.textSubtle, margin: '0 0 10px',
                                }}>Deliverables</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                                  {deliverables.map((d, di) => (
                                    <div key={di} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                      <div style={{
                                        flexShrink: 0, marginTop: 2,
                                        width: 18, height: 18, borderRadius: '50%',
                                        background: `${tokens.accent}15`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      }}>
                                        <CheckIcon color={tokens.accent} />
                                      </div>
                                      <span style={{
                                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                        fontSize: '0.85rem', color: tokens.textMuted, lineHeight: 1.5,
                                      }}>{d}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <InlineEditable field={`phases.${pi}.description`} label="Description" value={phase.description ?? ''} multiline>
                            <Body tokens={tokens} style={{ lineHeight: 1.75 }}>{phase.description}</Body>
                          </InlineEditable>
                        )}
                      </div>
                    </div>
                  </div>
                </InlineArrayItem>
              </Reveal>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
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
