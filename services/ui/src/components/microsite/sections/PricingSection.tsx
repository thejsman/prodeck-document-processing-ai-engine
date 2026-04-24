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


function isPaymentRow(label: string) {
  return /upon|signing|milestone|complet|launch|deposit|50%|phase\s*\d/i.test(label);
}

export function PricingSection({ content, tokens, sections = [] }: Props) {
  const rows = content.rows ?? [];
  const firstRow = rows[0] ?? [];
  const isGenericHeader = /^(service|deliverable|item|scope|description|investment)$/i.test((firstRow[0] ?? '').trim());
  const dataRows = isGenericHeader ? rows.slice(1) : rows;

  const paymentRows = dataRows.filter((r) => r.length >= 2 && isPaymentRow(r[0] ?? ''));
  const deliverableRows = dataRows.filter((r) => !isPaymentRow(r[0] ?? ''));

  const isTotalRow = (label: string) => /total/i.test(label);
  const isAnnualRow = (label: string) => /annual/i.test(label);

  const totalLabel = content.totalLabel?.trim();

  const ctaTarget = (
    sections.find((s) => s.sectionType === 'approval') ?? sections.find((s) => s.sectionType === 'nextsteps')
  )?.id;

  const accentRgb = tokens.accentRgb ?? '99,179,237';

  return (
    <section
      id="pricing"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: tokens.bg,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div
        style={{
          position: 'absolute',
          top: '10%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '60%',
          height: '50%',
          background: `radial-gradient(ellipse at center, rgba(${accentRgb},0.05) 0%, transparent 70%)`,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 880, margin: '0 auto' }}>
        {/* ── Header ── */}
        <Reveal>
          <div style={{ marginBottom: 'clamp(2rem, 4vw, 3rem)' }}>
            <span
              style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase' as const,
                color: tokens.accent,
                display: 'block',
                marginBottom: 12,
              }}
            >
              {content.eyebrow || 'Investment'}
            </span>
            <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
              <h2
                style={{
                  fontFamily: `'${tokens.heroFont}', serif`,
                  fontWeight: Number(tokens.heroWeight) || 700,
                  fontSize: 'clamp(1.6rem, 3vw, 2.4rem)',
                  lineHeight: 1.15,
                  letterSpacing: '-0.02em',
                  color: tokens.text,
                  margin: 0,
                }}
              >
                {content.headline || 'Total project investment.'}
              </h2>
            </InlineEditable>
            {content.subheadline && (
              <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline ?? ''} multiline>
                <p
                  style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.9rem',
                    lineHeight: 1.7,
                    color: tokens.textMuted,
                    margin: '10px 0 0',
                    maxWidth: 520,
                  }}
                >
                  {content.subheadline}
                </p>
              </InlineEditable>
            )}
          </div>
        </Reveal>

        <>
            {/* ── Main investment card ── */}
            <Reveal delay={100}>
              <div
                style={{
                  borderRadius: 14,
                  border: `1px solid ${tokens.border}`,
                  background: tokens.surfaceCard,
                  overflow: 'hidden',
                  boxShadow: tokens.cardShadow,
                  marginBottom: paymentRows.length > 0 ? 16 : 0,
                }}
              >
                {/* Top accent stripe */}
                <div
                  style={{
                    height: 2,
                    background: `linear-gradient(90deg, ${tokens.accent}, rgba(${accentRgb},0.2))`,
                  }}
                />

                <div style={{ padding: 'clamp(20px,3vw,32px)' }}>
                  {/* Price row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-end',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap' as const,
                      gap: 12,
                      marginBottom: deliverableRows.length > 0 ? 'clamp(16px,3vw,24px)' : 0,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontFamily: `'${tokens.bodyFont}', sans-serif`,
                          fontSize: '0.6rem',
                          fontWeight: 700,
                          letterSpacing: '0.13em',
                          textTransform: 'uppercase' as const,
                          color: tokens.textSubtle,
                          marginBottom: 6,
                        }}
                      >
                        {content.eyebrow || 'Total Investment'}
                      </div>
                      {totalLabel && (
                        <InlineEditable field="totalLabel" label="Total" value={totalLabel}>
                          <div
                            style={{
                              fontFamily: `'${tokens.heroFont}', serif`,
                              fontWeight: Number(tokens.heroWeight) || 700,
                              fontSize: 'clamp(1.8rem, 4vw, 2.8rem)',
                              letterSpacing: '-0.03em',
                              lineHeight: 1,
                              color: tokens.text,
                            }}
                          >
                            {totalLabel}
                          </div>
                        </InlineEditable>
                      )}
                    </div>

                    {deliverableRows.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '5px 12px',
                          borderRadius: 100,
                          border: `1px solid ${tokens.border}`,
                          background: tokens.surface,
                          fontFamily: `'${tokens.bodyFont}', sans-serif`,
                          fontSize: '0.68rem',
                          fontWeight: 600,
                          color: tokens.textSubtle,
                          whiteSpace: 'nowrap' as const,
                          marginBottom: 4,
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path
                            d="M1.5 5l2 2L8.5 2"
                            stroke={tokens.accent}
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        {deliverableRows.length} items included
                      </div>
                    )}
                  </div>

                  <div style={{ height: 1, background: tokens.border, marginBottom: 'clamp(14px,2.5vw,20px)' }} />

                  {/* 2-column pricing table — always rendered so user can fill in data */}
                  <table
                    data-component="pricing-line-items"
                    style={{ width: '100%', borderCollapse: 'collapse' }}
                  >
                    <tbody>
                      {deliverableRows.length === 0 ? (
                        [['', ''], ['', ''], ['', '']].map((_, pi) => (
                          <tr key={`ph-${pi}`} style={{ borderBottom: `1px solid ${tokens.border}` }}>
                            <td style={{ padding: '10px 0' }}>
                              <span style={{
                                display: 'block',
                                height: 14,
                                width: `${55 + (pi % 3) * 15}%`,
                                borderRadius: 4,
                                background: `rgba(${accentRgb},0.07)`,
                              }} />
                            </td>
                            <td style={{ padding: '10px 0', textAlign: 'right', width: '35%' }}>
                              <span style={{
                                display: 'inline-block',
                                height: 14,
                                width: 64,
                                borderRadius: 4,
                                background: `rgba(${accentRgb},0.07)`,
                              }} />
                            </td>
                          </tr>
                        ))
                      ) : deliverableRows.map((row, ri) => {
                          const globalIdx = dataRows.indexOf(row) + (isGenericHeader ? 1 : 0);
                          const label = row[0] ?? '';
                          const amount = row[1] ?? '';
                          const isTotal = isTotalRow(label);
                          const isAnnual = isAnnualRow(label);
                          return (
                            <InlineArrayItem
                              key={ri}
                              arrayPath="rows"
                              index={globalIdx}
                              total={rows.length}
                              as="tr"
                            >
                              <tr
                                style={{
                                  borderBottom: isAnnual ? 'none' : `1px solid ${tokens.border}`,
                                  background: isTotal ? `rgba(${accentRgb},0.05)` : 'transparent',
                                  borderTop: isTotal ? `2px solid ${tokens.accent}` : undefined,
                                }}
                              >
                                <td style={{ padding: '10px 0', textAlign: 'left' }}>
                                  <InlineEditable field={`rows.${globalIdx}.0`} label="Service" value={label}>
                                    <span style={{
                                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                      fontSize: isTotal ? '0.875rem' : '0.825rem',
                                      fontWeight: isTotal ? 700 : 400,
                                      color: isAnnual ? tokens.textSubtle : tokens.textMuted,
                                    }}>
                                      {label}
                                    </span>
                                  </InlineEditable>
                                </td>
                                <td style={{ padding: '10px 0', textAlign: 'right', width: '35%' }}>
                                  <InlineEditable field={`rows.${globalIdx}.1`} label="Amount" value={amount}>
                                    <span style={{
                                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                      fontSize: isTotal ? '0.9rem' : '0.825rem',
                                      fontWeight: isTotal ? 700 : 500,
                                      color: isTotal ? tokens.accent : (isAnnual ? tokens.textSubtle : tokens.text),
                                      fontVariantNumeric: 'tabular-nums',
                                    }}>
                                      {amount}
                                    </span>
                                  </InlineEditable>
                                </td>
                              </tr>
                            </InlineArrayItem>
                          );
                        })}
                    </tbody>
                  </table>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '8px 0',
                    borderTop: `1px solid ${tokens.border}`,
                    background: tokens.surface,
                  }}
                >
                  <InlineAddItem arrayPath="rows" template={['', '']} label="Add item" />
                </div>
              </div>
            </Reveal>

            {/* ── Payment schedule — premium stepper design ── */}
            <Reveal delay={200}>
              <div style={{ marginTop: 8 }}>
                {/* Section label */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: `rgba(${accentRgb},0.12)`,
                    border: `1px solid rgba(${accentRgb},0.25)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <rect x="1" y="3" width="12" height="10" rx="2" stroke={tokens.accent} strokeWidth="1.3" />
                      <path d="M1 6h12" stroke={tokens.accent} strokeWidth="1.3" />
                      <path d="M4 1v3M10 1v3" stroke={tokens.accent} strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  </div>
                  <span style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.63rem', fontWeight: 700,
                    letterSpacing: '0.14em', textTransform: 'uppercase' as const,
                    color: tokens.textSubtle,
                  }}>
                    Payment Schedule
                  </span>
                </div>

                {/* Milestone cards */}
                {(() => {
                  const milestones = paymentRows.length > 0
                    ? paymentRows
                    : [['Upon Signing', ''], ['Upon Delivery', ''], ['Upon Completion', '']];
                  const count = Math.min(milestones.length, 3);

                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${count}, 1fr)`, gap: 12 }}>
                      {milestones.slice(0, count).map((row, ri) => {
                        const isSkeleton = paymentRows.length === 0;
                        const globalIdx = isSkeleton ? -1 : dataRows.indexOf(row as string[]) + (isGenericHeader ? 1 : 0);
                        const label = row[0] ?? '';
                        const amount = row[1] ?? '';
                        const note = row[2] ?? '';
                        const isFirst = ri === 0;
                        const isLast = ri === count - 1;

                        return (
                          <div
                            key={ri}
                            style={{
                              position: 'relative',
                              borderRadius: 14,
                              overflow: 'hidden',
                              background: isFirst
                                ? `linear-gradient(135deg, rgba(${accentRgb},0.18) 0%, rgba(${accentRgb},0.06) 100%)`
                                : tokens.surfaceCard,
                              border: isFirst
                                ? `1px solid rgba(${accentRgb},0.35)`
                                : `1px solid ${tokens.border}`,
                              boxShadow: isFirst
                                ? `0 4px 24px rgba(${accentRgb},0.15), 0 1px 4px rgba(0,0,0,0.08)`
                                : tokens.cardShadow,
                              padding: 'clamp(18px,2.5vw,26px)',
                            }}
                          >
                            {/* Glow dot for first card */}
                            {isFirst && (
                              <div style={{
                                position: 'absolute', top: -20, right: -20,
                                width: 80, height: 80, borderRadius: '50%',
                                background: `radial-gradient(circle, rgba(${accentRgb},0.25) 0%, transparent 70%)`,
                                pointerEvents: 'none',
                              }} />
                            )}

                            {/* Step badge */}
                            <div style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 26, height: 26, borderRadius: '50%',
                              background: isFirst ? tokens.accent : `rgba(${accentRgb},0.1)`,
                              border: isFirst ? 'none' : `1.5px solid rgba(${accentRgb},0.25)`,
                              fontFamily: `'${tokens.bodyFont}', sans-serif`,
                              fontSize: '0.6rem', fontWeight: 800,
                              color: isFirst ? (tokens.bg || '#fff') : tokens.accent,
                              marginBottom: 14,
                              boxShadow: isFirst ? `0 2px 8px rgba(${accentRgb},0.4)` : 'none',
                            }}>
                              {ri + 1}
                            </div>

                            {/* Milestone label */}
                            <div style={{
                              fontFamily: `'${tokens.bodyFont}', sans-serif`,
                              fontSize: '0.6rem', fontWeight: 700,
                              letterSpacing: '0.13em', textTransform: 'uppercase' as const,
                              color: isFirst ? tokens.accent : tokens.textSubtle,
                              marginBottom: 8,
                            }}>
                              {isSkeleton ? label : (
                                <InlineEditable field={`rows.${globalIdx}.0`} label="Milestone" value={label}>
                                  {label}
                                </InlineEditable>
                              )}
                            </div>

                            {/* Amount */}
                            <div style={{
                              fontFamily: `'${tokens.bodyFont}', sans-serif`,
                              fontWeight: 500,
                              fontSize: '0.95rem',
                              color: isFirst ? tokens.text : tokens.accent,
                              letterSpacing: '-0.03em',
                              lineHeight: 1,
                              marginBottom: note ? 10 : 0,
                              minHeight: '1.75rem',
                            }}>
                              {isSkeleton ? (
                                <span style={{
                                  display: 'inline-block', height: 16, width: 80,
                                  borderRadius: 6, background: `rgba(${accentRgb},0.1)`,
                                  verticalAlign: 'middle',
                                }} />
                              ) : (
                                <InlineEditable field={`rows.${globalIdx}.1`} label="Amount" value={amount}>
                                  {amount || (
                                    <span style={{ opacity: 0.25, fontSize: '0.9rem', fontWeight: 400 }}>—</span>
                                  )}
                                </InlineEditable>
                              )}
                            </div>

                            {/* Note */}
                            {note && !isSkeleton && (
                              <div style={{
                                marginTop: 10,
                                paddingTop: 10,
                                borderTop: `1px solid rgba(${accentRgb},0.15)`,
                                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                fontSize: '0.72rem',
                                color: tokens.textSubtle,
                                lineHeight: 1.5,
                              }}>
                                <InlineEditable field={`rows.${globalIdx}.2`} label="Note" value={note}>
                                  {note}
                                </InlineEditable>
                              </div>
                            )}

                            {/* "First step" indicator tag */}
                            {isFirst && (
                              <div style={{
                                position: 'absolute', top: 14, right: 14,
                                padding: '2px 8px', borderRadius: 100,
                                background: `rgba(${accentRgb},0.15)`,
                                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                fontSize: '0.52rem', fontWeight: 700,
                                letterSpacing: '0.1em', textTransform: 'uppercase' as const,
                                color: tokens.accent,
                              }}>
                                First
                              </div>
                            )}
                            {isLast && count > 1 && (
                              <div style={{
                                position: 'absolute', top: 14, right: 14,
                                padding: '2px 8px', borderRadius: 100,
                                background: `rgba(${accentRgb},0.08)`,
                                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                fontSize: '0.52rem', fontWeight: 700,
                                letterSpacing: '0.1em', textTransform: 'uppercase' as const,
                                color: tokens.textSubtle,
                              }}>
                                Final
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Footnote */}
                {content.footnote && (
                  <div style={{
                    marginTop: 16,
                    padding: '12px 18px',
                    borderRadius: 10,
                    background: `rgba(${accentRgb},0.04)`,
                    border: `1px solid rgba(${accentRgb},0.12)`,
                  }}>
                    <InlineEditable field="footnote" label="Footnote" value={content.footnote ?? ''} multiline>
                      <p style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.75rem', color: tokens.textSubtle,
                        lineHeight: 1.6, margin: 0, fontStyle: 'italic',
                      }}>
                        {content.footnote}
                      </p>
                    </InlineEditable>
                  </div>
                )}
              </div>
            </Reveal>

            {content.cta && (
              <Reveal delay={320}>
                <div style={{ marginTop: 'clamp(1.5rem, 3vw, 2.5rem)', display: 'flex', justifyContent: 'center' }}>
                  <CTAButton tokens={tokens} targetSectionId={ctaTarget}>
                    {content.cta}
                  </CTAButton>
                </div>
              </Reveal>
            )}
          </>
      </div>
    </section>
  );
}
