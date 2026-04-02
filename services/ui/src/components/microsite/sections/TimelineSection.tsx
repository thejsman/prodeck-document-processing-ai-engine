'use client';

import type { PluginTokens, TimelineContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Body, Label } from '../shared/Typography';
import { ClickableDiagram } from '../editor/ClickableDiagram';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

interface Props {
  content: TimelineContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function TimelineSection({ content, tokens }: Props) {
  const phases = content.phases ?? [];
  const variant = (content as unknown as Record<string, unknown>).variant as string ?? 'vertical';

  return (
    <section
      id="timeline"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: tokens.surfaceAlt,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 960, margin: '0 auto' }}>
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', marginBottom: 16 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ marginBottom: 12 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        {content.subheadline && (
          <Reveal delay={160}>
            <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline ?? ''} multiline>
              <Body tokens={tokens} style={{ maxWidth: 600, marginBottom: 48 }}>
                {content.subheadline}
              </Body>
            </InlineEditable>
          </Reveal>
        )}

        <ClickableDiagram
          diagram={content.diagram ?? ''}
          tokens={tokens}
          delay={240}
          caption="Project schedule"
        />

        {/* Timeline track */}
        {variant === 'horizontal' ? (
          <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
            <div style={{ display: 'flex', gap: 0, minWidth: `${phases.length * 220}px`, position: 'relative' }}>
              {/* Horizontal connector line */}
              <div style={{
                position: 'absolute',
                top: 18,
                left: 24,
                right: 24,
                height: 2,
                background: `linear-gradient(to right, ${tokens.accent}, ${tokens.border})`,
                zIndex: 0,
              }} />
              {phases.map((phase, pi) => (
                <Reveal key={pi} delay={240 + pi * 80} style={{ flex: 1, minWidth: 200 }}>
                  <InlineArrayItem arrayPath="phases" index={pi} total={phases.length}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 12px' }}>
                      {/* Dot */}
                      <div style={{
                        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                        background: tokens.bg, border: `2px solid ${tokens.accent}`,
                        zIndex: 2, marginBottom: 16, position: 'relative',
                      }}>
                        <div style={{ position: 'absolute', inset: 4, borderRadius: '50%', background: tokens.accent }} />
                      </div>
                      <div style={{ padding: '16px 18px', borderRadius: 8, border: `1px solid ${tokens.border}`, background: tokens.surfaceCard, width: '100%' }}>
                        <InlineEditable field={`phases.${pi}.duration`} label="Duration" value={phase.duration ?? ''}>
                          <span style={{
                            fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.72rem', fontWeight: 600,
                            color: tokens.accent, padding: '2px 8px', borderRadius: 20,
                            background: `${tokens.accent}15`, border: `1px solid ${tokens.accent}30`,
                            display: 'inline-block', marginBottom: 8,
                          }}>{phase.duration}</span>
                        </InlineEditable>
                        <InlineEditable field={`phases.${pi}.name`} label="Phase Name" value={phase.name ?? ''}>
                          <h4 style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 600, fontSize: '0.95rem', color: tokens.text, margin: '0 0 6px' }}>
                            {phase.name}
                          </h4>
                        </InlineEditable>
                        <InlineEditable field={`phases.${pi}.description`} label="Description" value={phase.description ?? ''} multiline>
                          <Body tokens={tokens} style={{ fontSize: '0.82rem' }}>{phase.description}</Body>
                        </InlineEditable>
                      </div>
                    </div>
                  </InlineArrayItem>
                </Reveal>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ position: 'relative', paddingLeft: 40 }}>
            {/* Vertical line */}
            <div style={{
              position: 'absolute', left: 11, top: 0, bottom: 0, width: 2,
              background: `linear-gradient(to bottom, ${tokens.accent}, ${tokens.border})`,
            }} />
            {phases.map((phase, pi) => (
              <Reveal key={pi} delay={240 + pi * 80}>
                <InlineArrayItem arrayPath="phases" index={pi} total={phases.length}>
                  <div style={{ position: 'relative', paddingBottom: pi < phases.length - 1 ? 40 : 0 }}>
                    {/* Dot */}
                    <div style={{
                      position: 'absolute', left: -40 + 3, top: 4,
                      width: 18, height: 18, borderRadius: '50%',
                      background: tokens.bg, border: `2px solid ${tokens.accent}`, zIndex: 2,
                    }}>
                      <div style={{ position: 'absolute', inset: 4, borderRadius: '50%', background: tokens.accent }} />
                    </div>
                    <div style={{ padding: '20px 24px', borderRadius: 8, border: `1px solid ${tokens.border}`, background: tokens.surfaceCard }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                        <InlineEditable field={`phases.${pi}.name`} label="Phase Name" value={phase.name ?? ''}>
                          <h4 style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 600, fontSize: '1rem', color: tokens.text, margin: 0 }}>
                            {phase.name}
                          </h4>
                        </InlineEditable>
                        <InlineEditable field={`phases.${pi}.duration`} label="Duration" value={phase.duration ?? ''}>
                          <span style={{
                            fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.75rem', fontWeight: 600,
                            color: tokens.accent, padding: '2px 10px', borderRadius: 20,
                            background: `${tokens.accent}15`, border: `1px solid ${tokens.accent}30`,
                          }}>{phase.duration}</span>
                        </InlineEditable>
                      </div>
                      <InlineEditable field={`phases.${pi}.description`} label="Description" value={phase.description ?? ''} multiline>
                        <Body tokens={tokens} style={{ fontSize: '0.9rem' }}>{phase.description}</Body>
                      </InlineEditable>
                    </div>
                  </div>
                </InlineArrayItem>
              </Reveal>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <InlineAddItem
            arrayPath="phases"
            template={{ name: 'New phase', duration: '2 weeks', description: 'Describe this phase…' }}
            label="Add phase"
          />
        </div>
      </div>
    </section>
  );
}
