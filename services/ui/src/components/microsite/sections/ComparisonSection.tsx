'use client';

import type { PluginTokens, ComparisonContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Label, Body } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

interface Props {
  content: ComparisonContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

const CheckIcon = ({ color }: { color: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <circle cx="8" cy="8" r="8" fill={color} fillOpacity="0.15" />
    <path d="M4.5 8l2.5 2.5 4.5-5" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CrossIcon = ({ color }: { color: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <circle cx="8" cy="8" r="8" fill={color} fillOpacity="0.1" />
    <path d="M5 5l6 6M11 5l-6 6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

function isPositive(val: string): boolean {
  if (!val) return false;
  const v = val.trim().toLowerCase();
  if (v === '✓' || v === '✔' || v === 'yes' || v === 'true') return true;
  if (v === '✗' || v === '✘' || v === 'no' || v === 'false' || v === '—' || v === '-') return false;
  return true; // default to positive for non-boolean values
}

function isNegative(val: string): boolean {
  if (!val) return false;
  const v = val.trim().toLowerCase();
  return v === '✗' || v === '✘' || v === 'no' || v === 'false' || v === '—' || v === '-';
}

export function ComparisonSection({ content, tokens }: Props) {
  const rows = content.rows ?? [];

  return (
    <section
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: `linear-gradient(180deg, ${tokens.surface} 0%, ${tokens.bg} 100%)`,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 860, margin: '0 auto' }}>
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', textAlign: 'center', marginBottom: 16 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ textAlign: 'center', marginBottom: content.subheadline ? 16 : 48 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        {content.subheadline && (
          <Reveal delay={120}>
            <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline} multiline>
              <Body tokens={tokens} style={{ textAlign: 'center', marginBottom: 48, maxWidth: 560, margin: '0 auto 48px' }}>
                {content.subheadline}
              </Body>
            </InlineEditable>
          </Reveal>
        )}

        <Reveal delay={160}>
          <div style={{
            borderRadius: tokens.borderRadius ?? '16px',
            overflow: 'hidden',
            border: `1px solid ${tokens.border}`,
            boxShadow: tokens.cardShadow,
          }}>
            {/* Header row */}
            <div style={{
              display: 'grid', gridTemplateColumns: '2fr 1fr 1fr',
              background: tokens.surfaceAlt ?? tokens.surface,
              borderBottom: `1px solid ${tokens.border}`,
            }}>
              <div style={{ padding: '16px 24px' }} />
              <div style={{
                padding: '16px 24px', textAlign: 'center',
                background: `linear-gradient(135deg, ${tokens.accent}20, ${tokens.accent}10)`,
                borderLeft: `1px solid ${tokens.border}`,
                borderRight: `1px solid ${tokens.border}`,
              }}>
                <InlineEditable field="usLabel" label="Our Label" value={content.usLabel ?? 'Us'}>
                  <span style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 700, fontSize: '0.875rem',
                    color: tokens.accent, letterSpacing: '0.05em',
                  }}>
                    {content.usLabel || 'Us'}
                  </span>
                </InlineEditable>
              </div>
              <div style={{ padding: '16px 24px', textAlign: 'center' }}>
                <InlineEditable field="themLabel" label="Their Label" value={content.themLabel ?? 'Others'}>
                  <span style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 600, fontSize: '0.875rem',
                    color: tokens.textMuted, letterSpacing: '0.05em',
                  }}>
                    {content.themLabel || 'Others'}
                  </span>
                </InlineEditable>
              </div>
            </div>

            {/* Data rows */}
            {rows.map((row, i) => (
              <InlineArrayItem key={i} arrayPath="rows" index={i} total={rows.length}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '2fr 1fr 1fr',
                  borderBottom: i < rows.length - 1 ? `1px solid ${tokens.borderSubtle ?? tokens.border}` : 'none',
                  background: i % 2 === 0 ? tokens.surfaceCard : 'transparent',
                }}>
                  <div style={{ padding: '14px 24px', display: 'flex', alignItems: 'center' }}>
                    <InlineEditable field={`rows.${i}.feature`} label="Feature" value={row.feature ?? ''}>
                      <span style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.9rem', color: tokens.text, fontWeight: 500,
                      }}>
                        {row.feature}
                      </span>
                    </InlineEditable>
                  </div>

                  {/* Us column */}
                  <div style={{
                    padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    background: `${tokens.accent}06`,
                    borderLeft: `1px solid ${tokens.border}`, borderRight: `1px solid ${tokens.border}`,
                  }}>
                    {isNegative(row.us)
                      ? <CrossIcon color={tokens.textMuted} />
                      : <CheckIcon color={tokens.accent} />}
                    <InlineEditable field={`rows.${i}.us`} label="Our value" value={row.us ?? ''}>
                      <span style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.85rem',
                        color: isNegative(row.us) ? tokens.textMuted : tokens.text,
                        fontWeight: isPositive(row.us) ? 600 : 400,
                      }}>
                        {row.us}
                      </span>
                    </InlineEditable>
                  </div>

                  {/* Them column */}
                  <div style={{ padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    {isNegative(row.them)
                      ? <CrossIcon color={tokens.textMuted} />
                      : <CheckIcon color={tokens.textMuted} />}
                    <InlineEditable field={`rows.${i}.them`} label="Their value" value={row.them ?? ''}>
                      <span style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.85rem', color: tokens.textMuted,
                      }}>
                        {row.them}
                      </span>
                    </InlineEditable>
                  </div>
                </div>
              </InlineArrayItem>
            ))}
          </div>
        </Reveal>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <InlineAddItem
            arrayPath="rows"
            template={{ feature: 'Feature', us: '✓', them: '✗' }}
            label="Add row"
          />
        </div>
      </div>
    </section>
  );
}
