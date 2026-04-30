'use client';

import type { PluginTokens, ComparisonContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Label, Body, rt } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

interface Props {
  content: ComparisonContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

const CheckIcon = ({ color, size = 18 }: { color: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
    <circle cx="9" cy="9" r="9" fill={color} fillOpacity="0.15" />
    <path d="M5 9l3 3 5-6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CrossIcon = ({ color, size = 18 }: { color: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
    <circle cx="9" cy="9" r="9" fill={color} fillOpacity="0.08" />
    <path d="M6 6l6 6M12 6l-6 6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

function isNegative(val: string): boolean {
  if (!val) return false;
  const v = val.trim().toLowerCase();
  return v === '✗' || v === '✘' || v === 'no' || v === 'false' || v === '—' || v === '-';
}

function isPositive(val: string): boolean {
  if (!val) return false;
  const v = val.trim().toLowerCase();
  if (v === '✓' || v === '✔' || v === 'yes' || v === 'true') return true;
  if (isNegative(v)) return false;
  return true;
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

      {/* Decorative orb behind "us" column */}
      <div style={{
        position: 'absolute', top: '30%', right: '10%',
        width: 350, height: 350, borderRadius: '50%',
        background: `radial-gradient(circle, ${tokens.accent}10 0%, transparent 70%)`,
        pointerEvents: 'none', zIndex: 1,
      }} />

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
            <Headline tokens={tokens} style={{ textAlign: 'center', marginBottom: content.subheadline ? 16 : 8 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        {/* Decorative divider */}
        <Reveal delay={100}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: content.subheadline ? 20 : 52 }}>
            <div style={{ height: 1, width: 40, background: `linear-gradient(90deg, transparent, ${tokens.accent}40)` }} />
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: tokens.accent }} />
            <div style={{ height: 1, width: 40, background: `linear-gradient(270deg, transparent, ${tokens.accent}40)` }} />
          </div>
        </Reveal>

        {content.subheadline && (
          <Reveal delay={120}>
            <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline} multiline>
              <Body tokens={tokens} style={{ textAlign: 'center', marginBottom: 52, maxWidth: 560, margin: '0 auto 52px' }}>
                {content.subheadline}
              </Body>
            </InlineEditable>
          </Reveal>
        )}

        <Reveal delay={160}>
          <div style={{
            borderRadius: tokens.borderRadius ?? '16px',
            overflow: 'hidden',
            boxShadow: `0 8px 40px ${tokens.accent}12, 0 2px 8px rgba(0,0,0,0.12)`,
            border: `1px solid ${tokens.border}`,
          }}>
            {/* Column header row */}
            <div style={{
              display: 'grid', gridTemplateColumns: '2fr 1fr 1fr',
              background: tokens.surfaceAlt ?? tokens.surface,
              borderBottom: `1px solid ${tokens.border}`,
            }}>
              <div style={{ padding: '18px 24px' }}>
                <span style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.65rem', fontWeight: 600,
                  letterSpacing: '0.12em', textTransform: 'uppercase' as const,
                  color: tokens.textMuted,
                }}>Feature</span>
              </div>

              {/* Us column — highlighted */}
              <div style={{
                padding: '14px 24px', textAlign: 'center',
                background: `linear-gradient(180deg, ${tokens.accent}22, ${tokens.accent}10)`,
                borderLeft: `1px solid ${tokens.accent}30`,
                borderRight: `1px solid ${tokens.accent}30`,
                position: 'relative',
              }}>
                {/* Recommended badge */}
                <div style={{
                  position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
                  background: tokens.accent,
                  color: tokens.bg,
                  padding: '2px 12px',
                  borderRadius: '0 0 8px 8px',
                  fontSize: '0.6rem', fontWeight: 700,
                  letterSpacing: '0.08em', textTransform: 'uppercase' as const,
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  whiteSpace: 'nowrap' as const,
                }}>
                  Recommended
                </div>
                <InlineEditable field="usLabel" label="Our Label" value={content.usLabel ?? 'Us'}>
                  <span style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 700, fontSize: '0.9rem',
                    color: tokens.accent,
                    display: 'block', marginTop: 8,
                  }} {...rt(content.usLabel || 'Us')} />
                </InlineEditable>
              </div>

              <div style={{ padding: '18px 24px', textAlign: 'center' }}>
                <InlineEditable field="themLabel" label="Their Label" value={content.themLabel ?? 'Others'}>
                  <span style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 600, fontSize: '0.875rem',
                    color: tokens.textMuted,
                  }} {...rt(content.themLabel || 'Others')} />
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
                  transition: 'background 0.15s',
                }}>
                  {/* Feature label */}
                  <div style={{ padding: '14px 24px', display: 'flex', alignItems: 'center' }}>
                    <InlineEditable field={`rows.${i}.feature`} label="Feature" value={row.feature ?? ''}>
                      <span style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.825rem', color: tokens.text, fontWeight: 500,
                      }} {...rt(row.feature ?? '')} />
                    </InlineEditable>
                  </div>

                  {/* Us column */}
                  <div style={{
                    padding: '14px 20px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                    background: `${tokens.accent}06`,
                    borderLeft: `1px solid ${tokens.accent}20`,
                    borderRight: `1px solid ${tokens.accent}20`,
                  }}>
                    {isNegative(row.us)
                      ? <CrossIcon color={tokens.textMuted} />
                      : <CheckIcon color={tokens.accent} />}
                    <InlineEditable field={`rows.${i}.us`} label="Our value" value={row.us ?? ''}>
                      <span style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.825rem',
                        color: isNegative(row.us) ? tokens.textMuted : tokens.text,
                        fontWeight: isPositive(row.us) ? 600 : 400,
                      }} {...rt(row.us ?? '')} />
                    </InlineEditable>
                  </div>

                  {/* Them column */}
                  <div style={{
                    padding: '14px 20px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                    opacity: 0.75,
                  }}>
                    {isNegative(row.them)
                      ? <CrossIcon color={tokens.textMuted} />
                      : <CheckIcon color={tokens.textMuted} />}
                    <InlineEditable field={`rows.${i}.them`} label="Their value" value={row.them ?? ''}>
                      <span style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.825rem', color: tokens.textMuted,
                      }} {...rt(row.them ?? '')} />
                    </InlineEditable>
                  </div>
                </div>
              </InlineArrayItem>
            ))}
          </div>
        </Reveal>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
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
