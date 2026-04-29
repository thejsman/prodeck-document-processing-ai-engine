'use client';

import type { PluginTokens, NextStepsContent, LayoutSection } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { CTAButton } from '../shared/CTAButton';
import { rt } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';

interface Props {
  content: NextStepsContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sections?: LayoutSection[];
  sectionId?: string;
}

const FORBIDDEN_CTA_PATTERNS = /^(hero|challenge|approach|deliverables|timeline|pricing|whyus|nextsteps|testimonials|showcase|benefits|problem|stats|metrics|security|techstack|testing|faq|team|comparison|casestudy|approval|generic|solution|scope|investment|overview|proposed solution|pricing & commercials|next steps?|next|continue|forward|more)$/i;

function resolveCtaLabel(label: string | undefined, fallback: string): string {
  const clean = label?.trim();
  if (!clean) return fallback;
  if (FORBIDDEN_CTA_PATTERNS.test(clean.replace(/\s*[→»>]+\s*$/, '').trim())) return fallback;
  if (clean.startsWith('#')) return fallback;
  return clean;
}

export function NextStepsSection({ content, tokens, sectionId }: Props) {
  const accentRgb = tokens.accentRgb ?? '99,179,237';
  const steps = content.steps ?? [];
  const primaryLabel = resolveCtaLabel(content.ctaPrimary, 'Schedule a Call →');
  const secondaryLabel = resolveCtaLabel(content.ctaSecondary, 'Download This Proposal →');

  const handleSecondaryClick = secondaryLabel.toLowerCase().includes('download')
    ? () => window.dispatchEvent(new CustomEvent('microsite:download-pdf'))
    : undefined;

  return (
    <section
      id={sectionId ?? 'nextsteps'}
      style={{
        position: 'relative',
        padding: 'clamp(5rem, 10vw, 8rem) 2rem',
        background: tokens.bg,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      {/* Ambient bottom glow */}
      <div style={{
        position: 'absolute', bottom: 0, left: '50%',
        transform: 'translateX(-50%)',
        width: '80%', height: '60%',
        background: `radial-gradient(ellipse at center bottom, rgba(${accentRgb},0.07) 0%, transparent 70%)`,
        pointerEvents: 'none', zIndex: 0,
      }} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 960, margin: '0 auto' }}>

        {/* Two-column split: left = headline block, right = steps + CTAs */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: steps.length > 0 ? '5fr 4fr' : '1fr',
          gap: 'clamp(3rem, 6vw, 6rem)',
          alignItems: 'start',
        }}>

          {/* Left — headline, body, CTAs */}
          <div>
            <Reveal>
              <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
                <span style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.62rem', fontWeight: 700,
                  letterSpacing: '0.18em', textTransform: 'uppercase' as const,
                  color: tokens.accent, display: 'block', marginBottom: 20,
                }}
                  {...rt(content.eyebrow ?? '')} />
              </InlineEditable>
            </Reveal>

            <Reveal delay={80}>
              <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
                <h2 style={{
                  fontFamily: `'${tokens.heroFont}', serif`,
                  fontWeight: Number(tokens.heroWeight) || 700,
                  fontSize: 'clamp(2rem, 4vw, 3.2rem)',
                  lineHeight: 1.1, letterSpacing: '-0.03em',
                  color: tokens.text, margin: '0 0 24px',
                }}
                  {...rt(content.headline ?? '')} />
              </InlineEditable>
            </Reveal>

            <Reveal delay={160}>
              <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
                <p style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '1rem', lineHeight: 1.8,
                  color: tokens.textMuted, margin: '0 0 40px',
                }}
                  {...rt(content.body ?? '')} />
              </InlineEditable>
            </Reveal>

            <Reveal delay={220}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <CTAButton tokens={tokens}>{primaryLabel}</CTAButton>
                <CTAButton tokens={tokens} variant="secondary" onClick={handleSecondaryClick}>
                  {secondaryLabel}
                </CTAButton>
              </div>
            </Reveal>

            {content.urgencyNote && (
              <Reveal delay={280}>
                <InlineEditable field="urgencyNote" label="Urgency note" value={content.urgencyNote ?? ''}>
                  <p style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.82rem', color: tokens.accent,
                    fontWeight: 500, margin: '20px 0 0', lineHeight: 1.5,
                  }}
                    {...rt(content.urgencyNote ?? '')} />
                </InlineEditable>
              </Reveal>
            )}
          </div>

          {/* Right — numbered steps, open list style */}
          {steps.length > 0 && (
            <div>
              <div style={{
                height: 1, background: tokens.border,
                marginBottom: 'clamp(1.5rem, 3vw, 2.5rem)',
              }} />
              {steps.map((step, i) => (
                <Reveal key={i} delay={160 + i * 80}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '44px 1fr',
                    gap: '0 12px',
                    paddingBottom: 'clamp(1.25rem, 2.5vw, 2rem)',
                    marginBottom: i < steps.length - 1 ? 'clamp(1.25rem, 2.5vw, 2rem)' : 0,
                    borderBottom: i < steps.length - 1 ? `1px solid ${tokens.border}` : 'none',
                  }}>
                    {/* Step number */}
                    <div style={{
                      fontFamily: `'${tokens.heroFont}', serif`,
                      fontSize: '1.3rem', fontWeight: 800,
                      letterSpacing: '-0.03em', lineHeight: 1,
                      color: i === 0 ? tokens.accent : `rgba(${accentRgb},0.25)`,
                      paddingTop: 2,
                    }}>
                      {String(i + 1).padStart(2, '0')}
                    </div>
                    <div>
                      <div style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.9rem', fontWeight: 700,
                        color: tokens.text, marginBottom: 5, lineHeight: 1.3,
                      }}
                        {...rt(step.title ?? '')} />
                      <div style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.85rem', color: tokens.textMuted,
                        lineHeight: 1.7,
                      }}
                        {...rt(step.description ?? '')} />
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
