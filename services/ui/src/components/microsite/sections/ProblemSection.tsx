'use client';

import type { PluginTokens, ProblemContent } from '../../../types/presentation';
import { X } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Label, Body, inlineMarkdownToHtml, hasMarkdown } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

interface Props {
  content: ProblemContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function ProblemSection({ content, tokens, sectionId }: Props) {
  const painPoints = content.painPoints ?? [];
  const variant = (content as unknown as Record<string, unknown>).variant as string ?? 'list';

  return (
    <section
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        overflow: 'hidden',
        background: tokens.bg,
      }}
    >
      {/* Mesh gradient background at low opacity */}
      {tokens.meshGradient && (
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: tokens.meshGradient,
          opacity: 0.15,
          zIndex: 1,
          pointerEvents: 'none',
        }} />
      )}

      <NoiseOverlay opacity={tokens.noiseOpacity} />

      {/* Decorative side border */}
      <div style={{
        position: 'absolute',
        left: 0,
        top: '10%',
        bottom: '10%',
        width: 4,
        background: `linear-gradient(180deg, transparent, ${tokens.accent}, transparent)`,
        zIndex: 3,
      }} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 880, margin: '0 auto' }}>
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', marginBottom: 20 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          {/* Gradient headline */}
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <h2 style={{
              fontFamily: `'${tokens.heroFont}', serif`,
              fontWeight: tokens.heroWeight,
              fontSize: 'clamp(1.8rem, 4vw, 3rem)',
              lineHeight: 1.2,
              letterSpacing: '-0.01em',
              margin: '0 0 28px',
              backgroundImage: tokens.gradientText,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              color: 'transparent',
            }}
              {...(hasMarkdown(content.headline ?? '')
                ? { dangerouslySetInnerHTML: { __html: inlineMarkdownToHtml(content.headline ?? '') } }
                : { children: content.headline })}
            />
          </InlineEditable>
        </Reveal>

        <Reveal delay={160}>
          <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
            <Body tokens={tokens} style={{ fontSize: '1.05rem', lineHeight: 1.5, letterSpacing: '0em', marginBottom: 44 }}>
              {content.body}
            </Body>
          </InlineEditable>
        </Reveal>

        {/* Pain points */}
        <div style={variant === 'grid' ? {
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16,
        } : {
          display: 'flex', flexDirection: 'column', gap: 18,
        }}>
          {painPoints.map((point, i) => (
            <Reveal key={i} delay={220 + i * 60}>
              <InlineArrayItem arrayPath="painPoints" index={i} total={painPoints.length}>
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 18,
                  padding: '18px 24px', borderRadius: 12,
                  background: `${tokens.accent}08`, border: `1px solid ${tokens.accent}20`,
                  height: variant === 'grid' ? '100%' : undefined,
                  boxSizing: 'border-box',
                }}>
                  <Icon icon={X} size="sm" />
                </div>
              </InlineArrayItem>
            </Reveal>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <InlineAddItem
            arrayPath="painPoints"
            template="New pain point…"
            label="Add pain point"
          />
        </div>
      </div>
    </section>
  );
}
