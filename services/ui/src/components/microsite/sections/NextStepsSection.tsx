'use client';

import type { PluginTokens, NextStepsContent, LayoutSection } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Body, Label } from '../shared/Typography';
import { CTAButton } from '../shared/CTAButton';
import { InlineEditable } from '../editor/InlineEditable';

interface Props {
  content: NextStepsContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sections?: LayoutSection[];
  sectionId?: string;
}

// Section type names and internal anchors that must never appear as CTA labels (Rule 8)
const FORBIDDEN_CTA_PATTERNS = /^(hero|challenge|approach|deliverables|timeline|pricing|whyus|nextsteps|testimonials|showcase|benefits|problem|stats|metrics|security|techstack|testing|faq|team|comparison|casestudy|approval|generic|solution|scope|investment|overview|proposed solution|pricing & commercials|next steps?|next|continue|forward|more)$/i;

function resolveCtaLabel(label: string | undefined, fallback: string): string {
  const clean = label?.trim();
  if (!clean) return fallback;
  if (FORBIDDEN_CTA_PATTERNS.test(clean.replace(/\s*[→»>]+\s*$/, '').trim())) return fallback;
  if (clean.startsWith('#')) return fallback;
  return clean;
}

export function NextStepsSection({ content, tokens, sectionId, sections: _sections }: Props) {
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
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: tokens.bg,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      {/* Subtle radial glow */}
      <div
        style={{
          position: 'absolute',
          bottom: '0',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '70%',
          height: '50%',
          background: `radial-gradient(ellipse at center bottom, rgba(${accentRgb},0.07) 0%, transparent 70%)`,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', marginBottom: 16 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ marginBottom: 16 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        <Reveal delay={160}>
          <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
            <Body tokens={tokens} style={{ maxWidth: 520, margin: '0 auto 40px' }}>
              {content.body}
            </Body>
          </InlineEditable>
        </Reveal>

        {/* ── Numbered steps (Rule 8) ── */}
        {steps.length > 0 && (
          <Reveal delay={200}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 24,
                textAlign: 'left',
                marginBottom: 48,
                borderRadius: 12,
                border: `1px solid ${tokens.border}`,
                background: tokens.surface,
                padding: 'clamp(20px,3vw,32px)',
              }}
            >
              {steps.map((step, i) => (
                <div
                  key={i}
                  style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}
                >
                  <div
                    style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      color: tokens.accent,
                      textTransform: 'uppercase' as const,
                      flexShrink: 0,
                      paddingTop: 2,
                      minWidth: 28,
                    }}
                  >
                    {step.stepNumber}
                  </div>
                  <div>
                    <div
                      style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        color: tokens.text,
                        marginBottom: 4,
                      }}
                    >
                      {step.title}
                    </div>
                    <div
                      style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.82rem',
                        color: tokens.textMuted,
                        lineHeight: 1.6,
                      }}
                    >
                      {step.description}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        )}

        {/* ── CTA buttons — labels from content, validated (Rule 8) ── */}
        <Reveal
          delay={steps.length > 0 ? 280 : 240}
          style={{
            display: 'flex',
            gap: 16,
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginBottom: content.urgencyNote ? 32 : 0,
          }}
        >
          <CTAButton tokens={tokens}>
            {primaryLabel}
          </CTAButton>
          <CTAButton tokens={tokens} variant="secondary" onClick={handleSecondaryClick}>
            {secondaryLabel}
          </CTAButton>
        </Reveal>

        {content.urgencyNote && (
          <Reveal delay={steps.length > 0 ? 340 : 320}>
            <InlineEditable field="urgencyNote" label="Urgency note" value={content.urgencyNote ?? ''}>
              <Body tokens={tokens} style={{ fontSize: '0.85rem', color: tokens.accent, fontWeight: 500 }}>
                {content.urgencyNote}
              </Body>
            </InlineEditable>
          </Reveal>
        )}
      </div>
    </section>
  );
}
