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

function sectionCta(sections: LayoutSection[], targetId: string | undefined, fallback: string): string {
  if (!targetId) return fallback;
  const s = sections.find(sec => sec.id === targetId);
  return s ? s.heading : fallback;
}

export function NextStepsSection({ content, tokens, index, sections = [], sectionId }: Props) {
  const primarySection =
    sections.find(s => s.sectionType === 'pricing') ??
    sections.find(s => s.sectionType === 'deliverables');
  const primaryTarget = primarySection?.id;
  const secondarySection =
    sections.find(s => s.sectionType === 'approach') ??
    sections.find(s => s.sectionType === 'challenge') ??
    sections[0];
  const secondaryTarget = secondarySection?.id;
  return (
    <section
      id="nextsteps"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: tokens.bg,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 960, margin: '0 auto', textAlign: 'center' }}>
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', marginBottom: 16 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ marginBottom: 20 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        <Reveal delay={160}>
          <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
            <Body tokens={tokens} style={{ maxWidth: 580, margin: '0 auto 40px', fontSize: '1.05rem' }}>
              {content.body}
            </Body>
          </InlineEditable>
        </Reveal>

        <Reveal delay={240} style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', marginBottom: content.urgencyNote ? 32 : 0 }}>
          <CTAButton tokens={tokens} targetSectionId={primaryTarget}>
            {sectionCta(sections, primaryTarget, content.ctaPrimary)}
          </CTAButton>
          <CTAButton tokens={tokens} variant="secondary" targetSectionId={secondaryTarget}>
            {sectionCta(sections, secondaryTarget, content.ctaSecondary)}
          </CTAButton>
        </Reveal>

        {content.urgencyNote && (
          <Reveal delay={320}>
            <Body tokens={tokens} style={{ fontSize: '0.85rem', color: tokens.accent, fontWeight: 500 }}>
              {content.urgencyNote}
            </Body>
          </Reveal>
        )}
      </div>
    </section>
  );
}
