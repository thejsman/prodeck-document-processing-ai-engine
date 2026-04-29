'use client';

import { useEffect } from 'react';
import type { PluginTokens, PricingContent, LayoutSection } from '../../../types/presentation';
import { rt } from '../shared/Typography';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';
import { CTAButton } from '../shared/CTAButton';
import { useEditContext } from '../editor/EditContext';
import { useSectionId } from '../editor/SectionIdContext';

/** Parse a raw amount string → number. Returns 0 if not a plain one-time figure. */
function parseAmount(raw: string): number {
  if (!raw?.trim()) return 0;
  // Skip periodic rates — can't sum monthly fees with one-time costs
  if (/\/\s*(mo|month|yr|year|week|day)/i.test(raw)) return 0;
  // Remove currency symbols, spaces, commas (thousands separator)
  const cleaned = raw.replace(/[$€£¥₹,\s]/g, '').replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/** Format a number as a currency string with comma thousands separator. */
function formatCurrency(currency: string, total: number): string {
  const isWhole = Number.isInteger(total);
  const formatted = isWhole
    ? total.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : total.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency}${formatted}`;
}

/** Detect the currency symbol from the first amount that has one. */
function detectCurrency(rows: string[][]): string {
  for (const row of rows) {
    const m = (row[1] ?? '').match(/([$€£¥₹])/);
    if (m) return m[1];
  }
  return '$';
}

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
  const ctx = useEditContext();
  const sectionId = useSectionId();

  const rows = content.rows ?? [];
  const firstRow = rows[0] ?? [];
  const isGenericHeader = /^(service|deliverable|item|scope|description|investment)$/i.test((firstRow[0] ?? '').trim());
  const dataRows = isGenericHeader ? rows.slice(1) : rows;

  const paymentRows = dataRows.filter((r) => r.length >= 2 && isPaymentRow(r[0] ?? ''));
  const deliverableRows = dataRows.filter((r) => !isPaymentRow(r[0] ?? ''));

  const isTotalRow = (label: string) => /total|subtotal/i.test(label);
  const isAnnualRow = (label: string) => /annual/i.test(label);

  const totalLabel = content.totalLabel?.trim();

  // Auto-recalculate totalLabel + propagate to other sections whenever rows change
  useEffect(() => {
    if (!ctx || !sectionId) return;
    const allRows = content.rows ?? [];
    const firstR = allRows[0] ?? [];
    const hasHeader = /^(service|deliverable|item|scope|description|investment)$/i.test((firstR[0] ?? '').trim());
    const dataR = hasHeader ? allRows.slice(1) : allRows;
    const pricedRows = dataR.filter(r =>
      !isPaymentRow(r[0] ?? '') &&
      !/total|subtotal/i.test(r[0] ?? '') &&
      !/annual/i.test(r[0] ?? ''),
    );
    const validAmounts = pricedRows.map(r => parseAmount(r[1] ?? '')).filter(a => a > 0);
    if (validAmounts.length === 0) return;
    const total = validAmounts.reduce((a, b) => a + b, 0);
    const currency = detectCurrency(pricedRows);
    const newTotal = formatCurrency(currency, total);

    // 1. Update pricing section totalLabel
    if (newTotal !== content.totalLabel) {
      ctx.updateField(sectionId, 'totalLabel', newTotal);
    }

    // 2. Propagate to any other section that has a highlight/stat with an
    //    investment-related label (e.g. "Total Investment", "Project Cost", "Budget")
    const INVESTMENT_LABEL = /total\s*invest|project\s*cost|budget|investment|total\s*cost|engagement\s*value/i;
    for (const sec of ctx.ast.sections) {
      if (sec.id === sectionId) continue;
      const c = sec.content as unknown as Record<string, unknown>;

      // Overview / WhyUs / Stats — highlights array: [{value, label}]
      const highlights = c.highlights as Array<{value?: string; label?: string}> | undefined;
      if (Array.isArray(highlights)) {
        highlights.forEach((h, i) => {
          if (INVESTMENT_LABEL.test(h.label ?? '') && h.value !== newTotal) {
            ctx.updateField(sec.id, `highlights.${i}.value`, newTotal);
          }
        });
      }

      // Stats section — items array: [{value, label}]
      const items = c.items as Array<{value?: string; label?: string}> | undefined;
      if (Array.isArray(items)) {
        items.forEach((item, i) => {
          if (INVESTMENT_LABEL.test(item.label ?? '') && item.value !== newTotal) {
            ctx.updateField(sec.id, `items.${i}.value`, newTotal);
          }
        });
      }

      // Hero / Challenge / Generic — standalone totalLabel field
      if (typeof c.totalLabel === 'string' && INVESTMENT_LABEL.test('total invest') && c.totalLabel !== newTotal) {
        ctx.updateField(sec.id, 'totalLabel', newTotal);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.rows]);

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
            <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
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
                {...rt(content.eyebrow || 'Investment')}
              />
            </InlineEditable>
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
                {...rt(content.headline || 'Total project investment.')}
              />
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
                  {...rt(content.subheadline ?? '')}
                />
              </InlineEditable>
            )}
          </div>
        </Reveal>

        {rows.length === 0 && (
          <Reveal delay={160}>
            <div
              style={{
                padding: '32px',
                borderRadius: 12,
                border: `1px solid ${tokens.border}`,
                textAlign: 'center',
                color: tokens.textMuted,
                fontSize: '0.875rem',
              }}
            >
              Pricing details available on request.
            </div>
          </Reveal>
        )}

        {rows.length > 0 && (
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

                  {deliverableRows.length > 0 && (
                    <div style={{ height: 1, background: tokens.border, marginBottom: 'clamp(14px,2.5vw,20px)' }} />
                  )}

                  {/* 2-column pricing table — Rule 3: NEVER render as checklist */}
                  {deliverableRows.length > 0 && (
                    <table
                      data-component="pricing-line-items"
                      style={{ width: '100%', borderCollapse: 'collapse' }}
                    >
                      <tbody>
                        {deliverableRows.map((row, ri) => {
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
                                    }} {...rt(label ?? '')} />
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
                                    }} {...rt(amount ?? '')} />
                                  </InlineEditable>
                                </td>
                              </tr>
                            </InlineArrayItem>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
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

            {/* ── Payment schedule ── */}
            {paymentRows.length > 0 && (
              <Reveal delay={200}>
                <div
                  style={{
                    borderRadius: 12,
                    border: `1px solid ${tokens.border}`,
                    background: tokens.surface,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      padding: '12px 24px',
                      borderBottom: `1px solid ${tokens.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <rect x="1" y="3" width="12" height="10" rx="2" stroke={tokens.textSubtle} strokeWidth="1.2" />
                      <path d="M1 6h12" stroke={tokens.textSubtle} strokeWidth="1.2" />
                      <path d="M4 1v3M10 1v3" stroke={tokens.textSubtle} strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                    <span
                      style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        letterSpacing: '0.13em',
                        textTransform: 'uppercase' as const,
                        color: tokens.textSubtle,
                      }}
                    >
                      Payment Schedule
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${Math.min(paymentRows.length, 3)}, 1fr)`,
                    }}
                  >
                    {paymentRows.map((row, ri) => {
                      const globalIdx = dataRows.indexOf(row) + (isGenericHeader ? 1 : 0);
                      return (
                        <div
                          key={ri}
                          style={{
                            padding: '18px 22px',
                            borderRight: ri < paymentRows.length - 1 ? `1px solid ${tokens.border}` : undefined,
                          }}
                        >
                          <div
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              border: `1.5px solid ${tokens.border}`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontFamily: `'${tokens.bodyFont}', sans-serif`,
                              fontSize: '0.58rem',
                              fontWeight: 700,
                              color: tokens.textSubtle,
                              marginBottom: 10,
                            }}
                          >
                            {ri + 1}
                          </div>

                          <div
                            style={{
                              fontFamily: `'${tokens.bodyFont}', sans-serif`,
                              fontSize: '0.62rem',
                              fontWeight: 700,
                              letterSpacing: '0.11em',
                              textTransform: 'uppercase' as const,
                              color: tokens.textSubtle,
                              marginBottom: 6,
                            }}
                          >
                            <InlineEditable field={`rows.${globalIdx}.0`} label="Milestone" value={row[0] ?? ''}>
                              {row[0]}
                            </InlineEditable>
                          </div>

                          <div
                            style={{
                              fontFamily: `'${tokens.heroFont}', serif`,
                              fontWeight: 700,
                              fontSize: 'clamp(1.1rem, 2vw, 1.5rem)',
                              color: tokens.accent,
                              letterSpacing: '-0.02em',
                              lineHeight: 1,
                              marginBottom: row[2] ? 6 : 0,
                            }}
                          >
                            <InlineEditable field={`rows.${globalIdx}.1`} label="Amount" value={row[1] ?? ''}>
                              {row[1]}
                            </InlineEditable>
                          </div>

                          {row[2] && (
                            <div
                              style={{
                                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                fontSize: '0.75rem',
                                color: tokens.textSubtle,
                                lineHeight: 1.5,
                              }}
                            >
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
                    <div
                      style={{
                        padding: '12px 24px',
                        borderTop: `1px solid ${tokens.border}`,
                        background: tokens.surfaceAlt,
                      }}
                    >
                      <InlineEditable field="footnote" label="Footnote" value={content.footnote ?? ''} multiline>
                        <p
                          style={{
                            fontFamily: `'${tokens.bodyFont}', sans-serif`,
                            fontSize: '0.75rem',
                            color: tokens.textSubtle,
                            lineHeight: 1.6,
                            margin: 0,
                            fontStyle: 'italic',
                          }}
                          {...rt(content.footnote ?? '')}
                        />
                      </InlineEditable>
                    </div>
                  )}
                </div>
              </Reveal>
            )}

            {paymentRows.length === 0 && content.footnote && (
              <Reveal delay={260}>
                <InlineEditable field="footnote" label="Footnote" value={content.footnote ?? ''} multiline>
                  <p
                    style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.78rem',
                      color: tokens.textSubtle,
                      lineHeight: 1.7,
                      marginTop: 16,
                      paddingLeft: 14,
                      borderLeft: `2px solid ${tokens.accent}40`,
                    }}
                    {...rt(content.footnote ?? '')}
                  />
                </InlineEditable>
              </Reveal>
            )}

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
        )}
      </div>
    </section>
  );
}
