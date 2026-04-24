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

// Split a row into [phase+desc, amount, range, paymentStructure]
// Rows can be 2-col [name, amount] or 4-col [name, amount, range, structure]
function parseRow(row: string[]) {
  const raw = row[0] ?? '';
  // Some rows encode description after a newline or " - "
  const [name, ...descParts] = raw.split(/\n| - /);
  const desc = descParts.join(' - ').trim();
  return {
    name: name.trim(),
    desc,
    amount: row[1] ?? '',
    range: row[2] ?? '',
    structure: row[3] ?? '',
  };
}

const AMOUNT_OPACITIES = [1, 0.7, 0.5];

// Returns true if value is a real monetary/percentage figure, not a descriptive sentence
function isMonetaryValue(v: string) {
  return /[$%\d]/.test(v) && v.trim().length < 30;
}

export function PricingSection({ content, tokens, sections = [] }: Props) {
  const rows = content.rows ?? [];
  const firstRow = rows[0] ?? [];
  const isGenericHeader = (
    /^(service|deliverable|item|scope|description|investment|phase)$/i.test((firstRow[0] ?? '').trim()) ||
    /^(investment|price|amount|cost|fee)$/i.test((firstRow[1] ?? '').trim()) ||
    /^(payment structure|payment|structure|terms)$/i.test((firstRow[2] ?? '').trim())
  );
  const dataRows = isGenericHeader ? rows.slice(1) : rows;

  const paymentRows = dataRows.filter((r) => r.length >= 2 && isPaymentRow(r[0] ?? ''));
  const deliverableRows = dataRows.filter((r) => !isPaymentRow(r[0] ?? ''));

  const isTotalRow = (label: string) => /total/i.test(label);

  const totalLabel = content.totalLabel?.trim();

  const ctaTarget = (
    sections.find((s) => s.sectionType === 'approval') ?? sections.find((s) => s.sectionType === 'nextsteps')
  )?.id;

  const accentRgb = tokens.accentRgb ?? '99,179,237';

  const milestones = paymentRows.length > 0
    ? paymentRows
    : [['Upon Signing', ''], ['Upon Delivery', ''], ['Upon Completion', '']];
  const isSkeleton = paymentRows.length === 0;
  const milestoneCount = Math.min(milestones.length, 4);

  // Show Payment Structure column when any row has data in col[2]
  const hasPaymentStructure = deliverableRows.some((r) => r[2]);

  const colStyle: React.CSSProperties = {
    fontFamily: `'${tokens.bodyFont}', sans-serif`,
    fontSize: '0.58rem',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: tokens.textSubtle,
    padding: '14px 16px',
    borderBottom: `1px solid ${tokens.border}`,
    whiteSpace: 'nowrap',
  };

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
          top: '10%', left: '50%',
          transform: 'translateX(-50%)',
          width: '60%', height: '50%',
          background: `radial-gradient(ellipse at center, rgba(${accentRgb},0.05) 0%, transparent 70%)`,
          pointerEvents: 'none', zIndex: 0,
        }}
      />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1060, margin: '0 auto' }}>

        {/* ── Header ── */}
        <Reveal>
          <div style={{ marginBottom: 'clamp(2rem, 4vw, 3rem)' }}>
            <span style={{
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: '0.65rem', fontWeight: 700,
              letterSpacing: '0.14em', textTransform: 'uppercase' as const,
              color: tokens.accent, display: 'block', marginBottom: 12,
            }}>
              {content.eyebrow || 'Investment'}
            </span>
            <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
              <h2 style={{
                fontFamily: `'${tokens.heroFont}', serif`,
                fontWeight: Number(tokens.heroWeight) || 700,
                fontSize: 'clamp(1.6rem, 3vw, 2.4rem)',
                lineHeight: 1.15, letterSpacing: '-0.02em',
                color: tokens.text, margin: 0,
              }}>
                {content.headline || 'Total project investment.'}
              </h2>
            </InlineEditable>
            {content.subheadline && (
              <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline ?? ''} multiline>
                <p style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.9rem', lineHeight: 1.7,
                  color: tokens.textMuted, margin: '10px 0 0', maxWidth: 520,
                }}>
                  {content.subheadline}
                </p>
              </InlineEditable>
            )}
            {totalLabel && (
              <div style={{ marginTop: 16 }}>
                <InlineEditable field="totalLabel" label="Total" value={totalLabel}>
                  <span style={{
                    fontFamily: `'${tokens.heroFont}', serif`,
                    fontWeight: Number(tokens.heroWeight) || 700,
                    fontSize: 'clamp(1.4rem, 3vw, 2rem)',
                    letterSpacing: '-0.03em', lineHeight: 1,
                    color: tokens.accent,
                  }}>
                    {totalLabel}
                  </span>
                </InlineEditable>
              </div>
            )}
          </div>
        </Reveal>

        {/* ── Main investment table ── */}
        <Reveal delay={100}>
          <div style={{
            border: `1px solid ${tokens.border}`,
            borderRadius: 6,
            overflow: 'hidden',
            background: tokens.surfaceCard,
            boxShadow: tokens.cardShadow,
            marginBottom: 40,
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: tokens.surface }}>
                  <th style={{ ...colStyle, textAlign: 'left', paddingLeft: 28, width: '35%' }}>Phase</th>
                  <th style={{ ...colStyle, textAlign: 'left', width: '22%' }}>Starting Investment</th>
                  {hasPaymentStructure && <th style={{ ...colStyle, textAlign: 'left' }}>Payment Structure</th>}
                </tr>
              </thead>
              <tbody>
                {deliverableRows.length === 0 ? (
                  // Skeleton rows
                  [0, 1, 2].map((pi) => (
                    <tr key={`ph-${pi}`} style={{ borderBottom: `1px solid ${tokens.border}` }}>
                      <td style={{ padding: '22px 28px' }}>
                        <span style={{ display: 'block', height: 14, width: '60%', borderRadius: 3, background: `rgba(${accentRgb},0.07)`, marginBottom: 8 }} />
                        <span style={{ display: 'block', height: 11, width: '45%', borderRadius: 3, background: `rgba(${accentRgb},0.05)` }} />
                      </td>
                      <td style={{ padding: '22px 16px' }}>
                        <span style={{ display: 'block', height: 28, width: 80, borderRadius: 3, background: `rgba(${accentRgb},0.09)` }} />
                      </td>
                      {hasPaymentStructure && (
                        <td style={{ padding: '22px 16px' }}>
                          <span style={{ display: 'block', height: 14, width: '70%', borderRadius: 3, background: `rgba(${accentRgb},0.06)` }} />
                        </td>
                      )}
                    </tr>
                  ))
                ) : deliverableRows.map((row, ri) => {
                  const globalIdx = dataRows.indexOf(row) + (isGenericHeader ? 1 : 0);
                  const isTotal = isTotalRow(row[0] ?? '');
                  const parsed = parseRow(row);
                  const amountOpacity = AMOUNT_OPACITIES[ri % AMOUNT_OPACITIES.length];
                  const isLast = ri === deliverableRows.length - 1;

                  return (
                    <InlineArrayItem key={ri} arrayPath="rows" index={globalIdx} total={rows.length} as="tr">
                      <tr style={{
                        borderBottom: isLast ? 'none' : `1px solid ${tokens.border}`,
                        background: isTotal ? `rgba(${accentRgb},0.04)` : 'transparent',
                      }}>
                        {/* Phase name + description */}
                        <td style={{ padding: '22px 28px', verticalAlign: 'top' }}>
                          <InlineEditable field={`rows.${globalIdx}.0`} label="Phase" value={row[0] ?? ''}>
                            <div>
                              <div style={{
                                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                fontSize: '0.88rem', fontWeight: 700,
                                color: tokens.text, marginBottom: parsed.desc ? 5 : 0,
                                textTransform: 'uppercase' as const,
                                letterSpacing: '0.02em',
                              }}>
                                {parsed.name}
                              </div>
                              {parsed.desc && (
                                <div style={{
                                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                  fontSize: '0.78rem', color: tokens.textSubtle, lineHeight: 1.5,
                                }}>
                                  {parsed.desc}
                                </div>
                              )}
                            </div>
                          </InlineEditable>
                        </td>

                        {/* Starting investment — large colored amount */}
                        <td style={{ padding: '22px 16px', verticalAlign: 'top' }}>
                          <InlineEditable field={`rows.${globalIdx}.1`} label="Amount" value={row[1] ?? ''}>
                            <span style={{
                              fontFamily: `'${tokens.heroFont}', serif`,
                              fontSize: 'clamp(1.3rem, 2.5vw, 1.8rem)',
                              fontWeight: 700,
                              color: tokens.accent,
                              opacity: isTotal ? 1 : amountOpacity,
                              letterSpacing: '-0.03em',
                              lineHeight: 1,
                              fontVariantNumeric: 'tabular-nums',
                            }}>
                              {parsed.amount || '—'}
                            </span>
                          </InlineEditable>
                        </td>

                        {/* Payment structure */}
                        {hasPaymentStructure && (
                          <td style={{ padding: '22px 16px', verticalAlign: 'top' }}>
                            <InlineEditable field={`rows.${globalIdx}.2`} label="Payment Structure" value={row[2] ?? ''}>
                              <span style={{
                                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                                fontSize: '0.82rem', color: tokens.textMuted, lineHeight: 1.5,
                              }}>
                                {row[2] || '—'}
                              </span>
                            </InlineEditable>
                          </td>
                        )}
                      </tr>
                    </InlineArrayItem>
                  );
                })}
              </tbody>

              {/* Footer note row */}
              {(content.footnote || content.footnote) && (
                <tfoot>
                  <tr>
                    <td
                      colSpan={hasPaymentStructure ? 3 : 2}
                      style={{
                        padding: '14px 28px',
                        background: `rgba(${accentRgb},0.04)`,
                        borderTop: `1px solid ${tokens.border}`,
                      }}
                    >
                      <InlineEditable field="footnote" label="Footnote" value={(content.footnote ?? content.footnote) ?? ''} multiline>
                        <span style={{
                          fontFamily: `'${tokens.bodyFont}', sans-serif`,
                          fontSize: '0.78rem', color: tokens.textSubtle,
                          fontStyle: 'italic', lineHeight: 1.6,
                        }}>
                          {content.footnote ?? content.footnote}
                        </span>
                      </InlineEditable>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>

            <div style={{
              display: 'flex', justifyContent: 'center', padding: '8px 0',
              borderTop: `1px solid ${tokens.border}`, background: tokens.surface,
            }}>
              <InlineAddItem arrayPath="rows" template={['', '', '']} label="Add item" />
            </div>
          </div>
        </Reveal>

        {/* ── Payment schedule ── */}
        <Reveal delay={200}>
          <div>
            {/* Label + rule */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
              <span style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.58rem', fontWeight: 700,
                letterSpacing: '0.18em', textTransform: 'uppercase' as const,
                color: tokens.textSubtle, whiteSpace: 'nowrap' as const,
              }}>
                Payment Schedule
              </span>
              <div style={{ flex: 1, height: 1, background: tokens.border }} />
            </div>

            {/* Milestone row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${milestoneCount}, 1fr)`,
              border: `1px solid ${tokens.border}`,
              borderRadius: 6,
              overflow: 'hidden',
              background: tokens.surfaceCard,
            }}>
              {milestones.slice(0, milestoneCount).map((row, ri) => {
                const globalIdx = isSkeleton ? -1 : dataRows.indexOf(row as string[]) + (isGenericHeader ? 1 : 0);
                const label = (row[0] ?? '') as string;
                const rawAmount = (row[1] ?? '') as string;
                // If the LLM put a sentence in the amount field, demote it to a note
                const amount = isMonetaryValue(rawAmount) ? rawAmount : '';
                const note = (row[2] ?? '') as string || (!isMonetaryValue(rawAmount) ? rawAmount : '');
                const isFirst = ri === 0;
                const isLast = ri === milestoneCount - 1;

                return (
                  <div
                    key={ri}
                    style={{
                      padding: 'clamp(20px, 3vw, 28px)',
                      borderRight: isLast ? 'none' : `1px solid ${tokens.border}`,
                      borderTop: isFirst ? `3px solid ${tokens.accent}` : `3px solid transparent`,
                      position: 'relative',
                    }}
                  >
                    {/* Ordinal pill */}
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 28, borderRadius: '50%',
                      background: isFirst ? tokens.accent : `rgba(${accentRgb},0.08)`,
                      border: isFirst ? 'none' : `1px solid rgba(${accentRgb},0.2)`,
                      marginBottom: 16,
                    }}>
                      <span style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.58rem', fontWeight: 700,
                        color: isFirst ? (tokens.bg || '#fff') : tokens.textSubtle,
                        letterSpacing: '0.02em',
                      }}>
                        {String(ri + 1).padStart(2, '0')}
                      </span>
                    </div>

                    {/* Trigger label */}
                    <div style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.72rem', fontWeight: 700,
                      letterSpacing: '0.06em', textTransform: 'uppercase' as const,
                      color: tokens.textSubtle, marginBottom: 10,
                    }}>
                      {isSkeleton ? label : (
                        <InlineEditable field={`rows.${globalIdx}.0`} label="Milestone" value={label}>
                          {label}
                        </InlineEditable>
                      )}
                    </div>

                    {/* Amount — large */}
                    <div style={{
                      fontFamily: `'${tokens.heroFont}', serif`,
                      fontSize: 'clamp(1.4rem, 2.8vw, 2rem)',
                      fontWeight: 700, lineHeight: 1,
                      letterSpacing: '-0.03em',
                      color: isFirst ? tokens.accent : tokens.text,
                      marginBottom: 10,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {isSkeleton ? (
                        <span style={{
                          display: 'inline-block', height: 28, width: 80,
                          borderRadius: 3, background: `rgba(${accentRgb},0.09)`,
                        }} />
                      ) : (
                        <InlineEditable field={`rows.${globalIdx}.1`} label="Amount" value={amount}>
                          {amount || <span style={{ opacity: 0.2, fontSize: '1rem' }}>TBD</span>}
                        </InlineEditable>
                      )}
                    </div>

                    {/* Note */}
                    {(note || isSkeleton) && (
                      <div style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.75rem', color: tokens.textSubtle, lineHeight: 1.55,
                      }}>
                        {isSkeleton ? (
                          <span style={{
                            display: 'block', height: 11, width: '70%',
                            borderRadius: 3, background: `rgba(${accentRgb},0.06)`,
                          }} />
                        ) : (
                          <InlineEditable field={`rows.${globalIdx}.2`} label="Note" value={note}>
                            {note}
                          </InlineEditable>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footnote */}
            {content.footnote && (
              <div style={{ marginTop: 20 }}>
                <InlineEditable field="footnote" label="Footnote" value={content.footnote ?? ''} multiline>
                  <p style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.75rem', color: tokens.textSubtle,
                    lineHeight: 1.7, margin: 0, fontStyle: 'italic',
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
      </div>
    </section>
  );
}
