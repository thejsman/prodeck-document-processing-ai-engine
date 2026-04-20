'use client';

import type { PluginTokens } from '../../../types/presentation';
import { ArrowRight } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { Reveal } from './Reveal';

interface Step {
  number: string;
  title: string;
  description: string;
}

interface Props {
  steps: Step[];
  tokens: PluginTokens;
  heading?: string;
  baseDelay?: number;
}

export function ProcessSteps({ steps, tokens, heading, baseDelay = 0 }: Props) {
  if (!steps.length) return null;

  return (
    <div style={{ marginTop: 'clamp(2.5rem, 5vw, 4rem)' }}>
      {heading && (
        <Reveal delay={baseDelay}>
          <h3
            style={{
              fontFamily: `'${tokens.heroFont}', serif`,
              fontWeight: tokens.heroWeight,
              fontSize: 'clamp(1.1rem, 2.5vw, 1.4rem)',
              color: tokens.text,
              marginBottom: 'clamp(1.5rem, 3vw, 2rem)',
              letterSpacing: '-0.005em',
              lineHeight: 1.3,
            }}
          >
            {heading}
          </h3>
        </Reveal>
      )}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap' as const,
          gap: 0,
          alignItems: 'stretch',
        }}
      >
        {steps.map((step, i) => (
          <Reveal key={i} delay={baseDelay + 80 + i * 80} variant="fadeIn">
            <div style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 180px' }}>
              {/* Step card */}
              <div
                style={{
                  flex: 1,
                  background: tokens.surfaceCard,
                  border: `1px solid ${tokens.border}`,
                  borderRadius: 10,
                  padding: 'clamp(1.2rem, 2.5vw, 1.8rem)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Step number badge */}
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: tokens.accent,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: `'${tokens.heroFont}', serif`,
                    fontWeight: tokens.heroWeight,
                    fontSize: '1rem',
                    color: tokens.bg,
                    marginBottom: 14,
                    flexShrink: 0,
                    lineHeight: 1.5,
                    letterSpacing: '0em',
                  }}
                >
                  {step.number}
                </div>

                <div
                  style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 400,
                    fontSize: '0.95rem',
                    color: tokens.text,
                    marginBottom: 8,
                    lineHeight: 1.5,
                    letterSpacing: '0em',
                  }}
                >
                  {step.title}
                </div>

                <div
                  style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 300,
                    fontSize: '0.82rem',
                    color: tokens.textMuted,
                    lineHeight: 1.4,
                    letterSpacing: '0.01em',
                  }}
                >
                  {step.description}
                </div>
              </div>

              {/* Arrow connector (not after last) */}
              {i < steps.length - 1 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 8px',
                    color: tokens.accent,
                    fontSize: '1.2rem',
                    flexShrink: 0,
                  }}
                >
                  <Icon icon={ArrowRight} size="md" style={{ color: tokens.accent }} />
                </div>
              )}
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
