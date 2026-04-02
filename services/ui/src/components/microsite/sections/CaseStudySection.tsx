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
  { key: 'challenge' as const, label: 'Challenge', icon: '⚡' },
  { key: 'solution' as const, label: 'Solution', icon: '💡' },
  { key: 'outcome' as const, label: 'Outcome', icon: '🎯' },
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

      {/* Background image overlay */}
      {imageUrl && (
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `url(${imageUrl})`,
          backgroundSize: 'cover', backgroundPosition: 'center',
          opacity: 0.06, zIndex: 1,
        }} />
      )}

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', textAlign: 'center', marginBottom: 16 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ textAlign: 'center', marginBottom: 56 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        <div className="ms-split" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'clamp(2rem, 5vw, 5rem)', alignItems: 'start' }}>
          {/* Story column */}
          <Reveal delay={160}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {STEPS.map((step, si) => (
                <div key={step.key} style={{ display: 'flex', gap: 20 }}>
                  {/* Timeline spine */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: `linear-gradient(135deg, ${tokens.accent}30, ${tokens.accent}60)`,
                      border: `2px solid ${tokens.accent}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1rem', flexShrink: 0,
                    }}>
                      {step.icon}
                    </div>
                    {si < STEPS.length - 1 && (
                      <div style={{
                        width: 2, flex: 1, minHeight: 32,
                        background: `linear-gradient(180deg, ${tokens.accent}50, ${tokens.border})`,
                        margin: '4px 0',
                      }} />
                    )}
                  </div>

                  <div style={{ paddingBottom: si < STEPS.length - 1 ? 32 : 0, paddingTop: 8 }}>
                    <div style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontWeight: 700, fontSize: '0.75rem',
                      color: tokens.accent, letterSpacing: '0.1em',
                      textTransform: 'uppercase', marginBottom: 8,
                    }}>
                      {step.label}
                    </div>
                    <InlineEditable field={step.key} label={step.label} value={(content[step.key] as string) ?? ''} multiline>
                      <Body tokens={tokens} style={{ lineHeight: 1.75 }}>
                        {content[step.key] as string}
                      </Body>
                    </InlineEditable>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>

          {/* Metrics column */}
          <Reveal delay={240}>
            <div style={{
              background: `linear-gradient(135deg, ${tokens.surfaceCard}, ${tokens.surface})`,
              border: `1px solid ${tokens.border}`,
              borderRadius: tokens.borderRadius ?? '16px',
              padding: 'clamp(1.5rem, 3vw, 2.5rem)',
              boxShadow: tokens.cardShadow,
            }}>
              <div style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontWeight: 700, fontSize: '0.7rem',
                color: tokens.accent, letterSpacing: '0.12em',
                textTransform: 'uppercase', marginBottom: 28,
              }}>
                Results
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {metrics.map((m, i) => (
                  <InlineArrayItem key={i} arrayPath="metrics" index={i} total={metrics.length}>
                    <div style={{ borderBottom: i < metrics.length - 1 ? `1px solid ${tokens.borderSubtle ?? tokens.border}` : 'none', paddingBottom: i < metrics.length - 1 ? 20 : 0 }}>
                      <InlineEditable field={`metrics.${i}.value`} label="Value" value={m.value ?? ''}>
                        <div style={{
                          fontFamily: `'${tokens.heroFont}', sans-serif`,
                          fontWeight: 800, fontSize: 'clamp(2rem, 4vw, 2.8rem)',
                          color: tokens.accent, lineHeight: 1, marginBottom: 6,
                        }}>
                          {m.value}
                        </div>
                      </InlineEditable>
                      <InlineEditable field={`metrics.${i}.label`} label="Label" value={m.label ?? ''}>
                        <Body tokens={tokens} style={{ fontSize: '0.875rem' }}>
                          {m.label}
                        </Body>
                      </InlineEditable>
                    </div>
                  </InlineArrayItem>
                ))}
              </div>

              <div style={{ marginTop: 16 }}>
                <InlineAddItem
                  arrayPath="metrics"
                  template={{ value: '0%', label: 'Result metric' }}
                  label="Add metric"
                />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
