'use client';

import type { PluginTokens, CaseStudyContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Label, Body } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

interface Props {
  content: CaseStudyContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

const STEPS = [
  { key: 'challenge' as const, label: 'Challenge', icon: '⚡', color: 'F59E0B' },
  { key: 'solution' as const, label: 'Solution', icon: '💡', color: '10B981' },
  { key: 'outcome' as const, label: 'Outcome', icon: '🎯', color: '6366F1' },
];

export function CaseStudySection({ content, tokens, imageUrl }: Props) {
  const metrics = content.metrics ?? [];

  return (
    <section
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: tokens.bg,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      {/* Decorative orbs */}
      <div style={{
        position: 'absolute', top: '-10%', right: '-5%',
        width: 500, height: 500, borderRadius: '50%',
        background: `radial-gradient(circle, ${tokens.accent}12 0%, transparent 70%)`,
        pointerEvents: 'none', zIndex: 1,
      }} />
      <div style={{
        position: 'absolute', bottom: '-5%', left: '-5%',
        width: 350, height: 350, borderRadius: '50%',
        background: `radial-gradient(circle, ${tokens.accent}08 0%, transparent 70%)`,
        pointerEvents: 'none', zIndex: 1,
      }} />

      {/* Background image overlay */}
      {imageUrl && (
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `url(${imageUrl})`,
          backgroundSize: 'cover', backgroundPosition: 'center',
          opacity: 0.04, zIndex: 1,
        }} />
      )}

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', textAlign: 'center', marginBottom: 16 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ textAlign: 'center', marginBottom: 16 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        {/* Decorative divider */}
        <Reveal delay={100}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 52 }}>
            <div style={{ height: 1, width: 48, background: `linear-gradient(90deg, transparent, ${tokens.accent}50)` }} />
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: tokens.accent, boxShadow: `0 0 8px ${tokens.accent}80` }} />
            <div style={{ height: 1, width: 48, background: `linear-gradient(270deg, transparent, ${tokens.accent}50)` }} />
          </div>
        </Reveal>

        {/* Metrics banner — prominent strip at top */}
        {metrics.length > 0 && (
          <Reveal delay={140}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(metrics.length, 4)}, 1fr)`,
              gap: 1,
              borderRadius: tokens.borderRadius ?? '16px',
              overflow: 'hidden',
              border: `1px solid ${tokens.accent}30`,
              marginBottom: 52,
              boxShadow: `0 0 40px ${tokens.accent}12`,
            }}>
              {metrics.map((m, i) => (
                <InlineArrayItem key={i} arrayPath="metrics" index={i} total={metrics.length}>
                  <div style={{
                    padding: 'clamp(1.2rem, 2.5vw, 1.8rem) clamp(1rem, 2vw, 1.5rem)',
                    background: i === 0
                      ? `linear-gradient(135deg, ${tokens.accent}20, ${tokens.accent}08)`
                      : tokens.surfaceCard,
                    borderRight: i < metrics.length - 1 ? `1px solid ${tokens.border}` : 'none',
                    textAlign: 'center',
                  }}>
                    <InlineEditable field={`metrics.${i}.value`} label="Value" value={m.value ?? ''}>
                      <div style={{
                        fontFamily: `'${tokens.heroFont}', sans-serif`,
                        fontWeight: 800,
                        fontSize: 'clamp(1.6rem, 3.5vw, 2.4rem)',
                        color: i === 0 ? tokens.accent : tokens.text,
                        lineHeight: 1,
                        marginBottom: 6,
                        letterSpacing: '-0.02em',
                      }}>
                        {m.value}
                      </div>
                    </InlineEditable>
                    <InlineEditable field={`metrics.${i}.label`} label="Label" value={m.label ?? ''}>
                      <div style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase' as const,
                        color: tokens.textMuted,
                      }}>
                        {m.label}
                      </div>
                    </InlineEditable>
                  </div>
                </InlineArrayItem>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: -36, marginBottom: 36 }}>
              <InlineAddItem arrayPath="metrics" template={{ value: '0%', label: 'Result metric' }} label="Add metric" />
            </div>
          </Reveal>
        )}

        {/* Story cards */}
        <div className="ms-split" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'clamp(1rem, 2vw, 1.5rem)' }}>
          {STEPS.map((step, si) => (
            <Reveal key={step.key} delay={200 + si * 80}>
              <div style={{
                position: 'relative',
                padding: 'clamp(1.5rem, 3vw, 2rem)',
                borderRadius: tokens.borderRadius ?? '16px',
                border: `1px solid ${tokens.border}`,
                background: `linear-gradient(145deg, ${tokens.surfaceCard}, ${tokens.surface})`,
                boxShadow: tokens.cardShadow,
                overflow: 'hidden',
                height: '100%',
              }}>
                {/* Top accent bar */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                  background: `linear-gradient(90deg, ${tokens.accent}80, ${tokens.accent}20)`,
                }} />

                {/* Step badge */}
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '5px 12px',
                  borderRadius: 100,
                  background: `${tokens.accent}14`,
                  border: `1px solid ${tokens.accent}30`,
                  marginBottom: 16,
                }}>
                  <span style={{ fontSize: '0.85rem' }}>{step.icon}</span>
                  <span style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 700, fontSize: '0.65rem',
                    color: tokens.accent, letterSpacing: '0.1em',
                    textTransform: 'uppercase' as const,
                  }}>
                    {step.label}
                  </span>
                </div>

                <InlineEditable field={step.key} label={step.label} value={(content[step.key] as string) ?? ''} multiline>
                  <Body tokens={tokens} style={{ lineHeight: 1.78, fontSize: '0.875rem' }}>
                    {content[step.key] as string}
                  </Body>
                </InlineEditable>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Add metrics if none yet */}
        {metrics.length === 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
            <InlineAddItem arrayPath="metrics" template={{ value: '0%', label: 'Result metric' }} label="Add metric" />
          </div>
        )}
      </div>
    </section>
  );
}
