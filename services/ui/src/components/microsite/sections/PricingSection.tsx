'use client';

import type { PluginTokens, PricingContent, LayoutSection } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';
import { CTAButton } from '../shared/CTAButton';

interface Props {
  content: PricingContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sections?: LayoutSection[];
  sectionId?: string;
}

function Check({ color }: { color: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="7.5" cy="7.5" r="7" stroke={color} strokeWidth="1.2" opacity={0.35} />
      <path d="M4.5 7.5L6.5 9.5L10.5 5.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function isPaymentRow(label: string) {
  return /upon|signing|milestone|complet|launch|deposit|50%|phase\s*\d/i.test(label);
}

export function PricingSection({ content, tokens, sections = [] }: Props) {
  const rows = content.rows ?? [];
  const firstRow = rows[0] ?? [];
  const isGenericHeader = /^(service|deliverable|item|scope|description|investment)$/i.test((firstRow[0] ?? '').trim());
  const dataRows = isGenericHeader ? rows.slice(1) : rows;

  const paymentRows = dataRows.filter(r => r.length >= 2 && isPaymentRow(r[0] ?? ''));
  const deliverableRows = dataRows.filter(r => !isPaymentRow(r[0] ?? ''));

  const mid = Math.ceil(deliverableRows.length / 2);
  const colA = deliverableRows.slice(0, mid);
  const colB = deliverableRows.slice(mid);

  const totalLabel = content.totalLabel?.trim();

  const ctaTarget = (
    sections.find(s => s.sectionType === 'approval') ??
    sections.find(s => s.sectionType === 'nextsteps')
  )?.id;

  const accentRgb = tokens.accentRgb ?? '99,179,237';

  return (
    <section
      id="pricing"
      style={{
        position: 'relative',
        padding: 'clamp(5rem, 10vw, 9rem) 2rem',
        background: tokens.bg,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      {/* Radial glow behind the card */}
      <div style={{
        position: 'absolute',
        top: '20%', left: '50%',
        transform: 'translateX(-50%)',
        width: '70%', height: '50%',
        background: `radial-gradient(ellipse at center, rgba(${accentRgb},0.07) 0%, transparent 70%)`,
        pointerEvents: 'none', zIndex: 0,
      }} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 960, margin: '0 auto' }}>

        {/* ── Section label + headline ── */}
        <Reveal>
          <div style={{ marginBottom: 'clamp(2.5rem, 5vw, 4rem)' }}>
            <span style={{
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: '0.68rem', fontWeight: 700,
              letterSpacing: '0.16em', textTransform: 'uppercase' as const,
              color: tokens.accent, display: 'block', marginBottom: 16,
            }}>
              {content.eyebrow || 'Investment'}
            </span>
            <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
              <h2 style={{
                fontFamily: `'${tokens.heroFont}', serif`,
                fontWeight: Number(tokens.heroWeight) || 700,
                fontSize: 'clamp(2.4rem, 5vw, 4rem)',
                lineHeight: 1.05, letterSpacing: '-0.03em',
                color: tokens.text, margin: 0,
              }}>
                {content.headline || 'Total project investment.'}
              </h2>
            </InlineEditable>
            {content.subheadline && (
              <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline ?? ''} multiline>
                <p style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: 'clamp(1rem, 1.6vw, 1.1rem)',
                  lineHeight: 1.75, color: tokens.textMuted,
                  margin: 'clamp(1rem,2vw,1.5rem) 0 0', maxWidth: 560,
                }}>
                  {content.subheadline}
                </p>
              </InlineEditable>
            )}
          </div>
        </Reveal>

        {rows.length === 0 && (
          <Reveal delay={160}>
            <div style={{
              padding: '40px', borderRadius: 16,
              border: `1px solid ${tokens.border}`,
              textAlign: 'center', color: tokens.textMuted, fontSize: '0.95rem',
            }}>
              Pricing details available on request.
            </div>
          </Reveal>
        )}

        {rows.length > 0 && (
          <>
            {/* ── Main investment card ── */}
            <Reveal delay={120}>
              <div style={{
                borderRadius: 20,
                border: `1px solid ${tokens.border}`,
                background: tokens.surfaceCard,
                overflow: 'hidden',
                boxShadow: tokens.cardShadow,
                marginBottom: paymentRows.length > 0 ? 20 : 0,
              }}>
                {/* Top accent stripe */}
                <div style={{
                  height: 3,
                  background: `linear-gradient(90deg, ${tokens.accent}, rgba(${accentRgb},0.3))`,
                }} />

                <div style={{ padding: 'clamp(28px,4vw,44px)' }}>
                  {/* Price + eyebrow row */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap' as const,
                    gap: 16,
                    marginBottom: deliverableRows.length > 0 ? 'clamp(24px,4vw,36px)' : 0,
                  }}>
                    <div>
                      <div style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.65rem', fontWeight: 700,
                        letterSpacing: '0.14em', textTransform: 'uppercase' as const,
                        color: tokens.textSubtle, marginBottom: 12,
                      }}>
                        {content.eyebrow || 'Total Investment'}
                      </div>
                      {totalLabel && (
                        <InlineEditable field="totalLabel" label="Total" value={totalLabel}>
                          <div style={{
                            fontFamily: `'${tokens.heroFont}', serif`,
                            fontWeight: Number(tokens.heroWeight) || 900,
                            fontSize: 'clamp(3rem, 7vw, 5.5rem)',
                            letterSpacing: '-0.04em', lineHeight: 1,
                            color: tokens.text,
                          }}>
                            {totalLabel}
                          </div>
                        </InlineEditable>
                      )}
                    </div>

                    {/* "What's included" pill badge */}
                    {deliverableRows.length > 0 && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '8px 14px',
                        borderRadius: 100,
                        border: `1px solid ${tokens.border}`,
                        background: tokens.surface,
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.72rem', fontWeight: 600,
                        color: tokens.textSubtle,
                        whiteSpace: 'nowrap' as const,
                        alignSelf: 'flex-start',
                        marginTop: 8,
                      }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l2.5 2.5L10 3" stroke={tokens.accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        {deliverableRows.length} items included
                      </div>
                    )}
                  </div>

                  {/* Separator */}
                  {deliverableRows.length > 0 && (
                    <div style={{ height: 1, background: tokens.border, marginBottom: 'clamp(20px,3vw,28px)' }} />
                  )}

                  {/* 2-column deliverable checklist */}
                  {deliverableRows.length > 0 && (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: colB.length > 0 ? '1fr 1fr' : '1fr',
                      gap: '10px 32px',
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {colA.map((row, ri) => (
                          <InlineArrayItem key={ri} arrayPath="rows" index={ri + (isGenericHeader ? 1 : 0)} total={rows.length}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                              <div style={{ marginTop: 2 }}>
                                <Check color={tokens.accent} />
                              </div>
                              <InlineEditable field={`rows.${ri + (isGenericHeader ? 1 : 0)}.0`} label="Item" value={row[0] ?? ''}>
                                <span style={{
                                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                  fontSize: '0.88rem',
                                  color: tokens.textMuted,
                                  lineHeight: 1.5,
                                }}>
                                  {row[0]}
                                </span>
                              </InlineEditable>
                            </div>
                          </InlineArrayItem>
                        ))}
                      </div>
                      {colB.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {colB.map((row, ri) => (
                            <InlineArrayItem key={ri} arrayPath="rows" index={mid + ri + (isGenericHeader ? 1 : 0)} total={rows.length}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                <div style={{ marginTop: 2 }}>
                                  <Check color={tokens.accent} />
                                </div>
                                <InlineEditable field={`rows.${mid + ri + (isGenericHeader ? 1 : 0)}.0`} label="Item" value={row[0] ?? ''}>
                                  <span style={{
                                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                    fontSize: '0.88rem',
                                    color: tokens.textMuted,
                                    lineHeight: 1.5,
                                  }}>
                                    {row[0]}
                                  </span>
                                </InlineEditable>
                              </div>
                            </InlineArrayItem>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Add row control */}
                <div style={{
                  display: 'flex', justifyContent: 'center',
                  padding: '10px 0',
                  borderTop: `1px solid ${tokens.border}`,
                  background: tokens.surface,
                }}>
                  <InlineAddItem arrayPath="rows" template={['', '']} label="Add item" />
                </div>
              </div>
            </Reveal>

            {/* ── Payment schedule ── */}
            {paymentRows.length > 0 && (
              <Reveal delay={220}>
                <div style={{
                  borderRadius: 16,
                  border: `1px solid ${tokens.border}`,
                  background: tokens.surface,
                  overflow: 'hidden',
                }}>
                  {/* Header */}
                  <div style={{
                    padding: '16px 28px',
                    borderBottom: `1px solid ${tokens.border}`,
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="1" y="3" width="12" height="10" rx="2" stroke={tokens.textSubtle} strokeWidth="1.2"/>
                      <path d="M1 6h12" stroke={tokens.textSubtle} strokeWidth="1.2"/>
                      <path d="M4 1v3M10 1v3" stroke={tokens.textSubtle} strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                    <span style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.68rem', fontWeight: 700,
                      letterSpacing: '0.14em', textTransform: 'uppercase' as const,
                      color: tokens.textSubtle,
                    }}>
                      Payment Schedule
                    </span>
                  </div>

                  {/* Milestone tiles */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${Math.min(paymentRows.length, 3)}, 1fr)`,
                  }}>
                    {paymentRows.map((row, ri) => {
                      const globalIdx = dataRows.indexOf(row) + (isGenericHeader ? 1 : 0);
                      return (
                        <div key={ri} style={{
                          padding: '24px 28px',
                          borderRight: ri < paymentRows.length - 1 ? `1px solid ${tokens.border}` : undefined,
                          position: 'relative',
                        }}>
                          {/* Step number */}
                          <div style={{
                            width: 22, height: 22, borderRadius: '50%',
                            border: `1.5px solid ${tokens.border}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontFamily: `'${tokens.bodyFont}', sans-serif`,
                            fontSize: '0.6rem', fontWeight: 700,
                            color: tokens.textSubtle,
                            marginBottom: 14,
                          }}>
                            {ri + 1}
                          </div>

                          <div style={{
                            fontFamily: `'${tokens.bodyFont}', sans-serif`,
                            fontSize: '0.65rem', fontWeight: 700,
                            letterSpacing: '0.12em', textTransform: 'uppercase' as const,
                            color: tokens.textSubtle, marginBottom: 8,
                          }}>
                            <InlineEditable field={`rows.${globalIdx}.0`} label="Milestone" value={row[0] ?? ''}>
                              {row[0]}
                            </InlineEditable>
                          </div>

                          <div style={{
                            fontFamily: `'${tokens.heroFont}', serif`,
                            fontWeight: 700,
                            fontSize: 'clamp(1.5rem, 3vw, 2.2rem)',
                            color: tokens.accent,
                            letterSpacing: '-0.03em',
                            lineHeight: 1, marginBottom: row[2] ? 8 : 0,
                          }}>
                            <InlineEditable field={`rows.${globalIdx}.1`} label="Amount" value={row[1] ?? ''}>
                              {row[1]}
                            </InlineEditable>
                          </div>

                          {row[2] && (
                            <div style={{
                              fontFamily: `'${tokens.bodyFont}', sans-serif`,
                              fontSize: '0.78rem', color: tokens.textSubtle,
                              lineHeight: 1.5,
                            }}>
                              <InlineEditable field={`rows.${globalIdx}.2`} label="Note" value={row[2] ?? ''}>
                                {row[2]}
                              </InlineEditable>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {content.footnote && (
                    <div style={{
                      padding: '14px 28px',
                      borderTop: `1px solid ${tokens.border}`,
                      background: tokens.surfaceAlt,
                    }}>
                      <InlineEditable field="footnote" label="Footnote" value={content.footnote ?? ''} multiline>
                        <p style={{
                          fontFamily: `'${tokens.bodyFont}', sans-serif`,
                          fontSize: '0.78rem', color: tokens.textSubtle,
                          lineHeight: 1.6, margin: 0, fontStyle: 'italic',
                        }}>
                          {content.footnote}
                        </p>
                      </InlineEditable>
                    </div>
                  )}
                </div>
              </Reveal>
            )}

            {/* Footnote when no payment rows */}
            {paymentRows.length === 0 && content.footnote && (
              <Reveal delay={280}>
                <InlineEditable field="footnote" label="Footnote" value={content.footnote ?? ''} multiline>
                  <p style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.82rem', color: tokens.textSubtle,
                    lineHeight: 1.7, marginTop: 20,
                    paddingLeft: 16,
                    borderLeft: `2px solid ${tokens.accent}40`,
                  }}>
                    {content.footnote}
                  </p>
                </InlineEditable>
              </Reveal>
            )}

            {/* CTA */}
            {content.cta && (
              <Reveal delay={340}>
                <div style={{ marginTop: 'clamp(2rem, 4vw, 3rem)', display: 'flex', justifyContent: 'center' }}>
                  <CTAButton tokens={tokens} targetSectionId={ctaTarget}>
                    {content.cta}
                  </CTAButton>
                </div>
              </Reveal>
            )}
          </>
        )}
      </div>
    </section>
  );
}
