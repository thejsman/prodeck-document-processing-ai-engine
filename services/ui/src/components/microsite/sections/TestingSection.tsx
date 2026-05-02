'use client';

import type { PluginTokens, TestingContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Body, Label, rt } from '../shared/Typography';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

interface Props {
  content: TestingContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function TestingSection({ content, tokens }: Props) {
  const sortedLayers = [...(content.layers ?? [])].sort((a, b) => a.level - b.level);
  const additionalInfo = content.additionalInfo ?? [];

  return (
    <section
      id="testing"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: getSectionGradient('testing', tokens),
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 900, margin: '0 auto' }}>

        {/* ── Centered header ── */}
        <div style={{ textAlign: 'center', marginBottom: 'clamp(2.5rem, 5vw, 4rem)' }}>
          <Reveal>
            <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
              <Label tokens={tokens} style={{ display: 'block', marginBottom: 14 }}>
                {content.eyebrow}
              </Label>
            </InlineEditable>
          </Reveal>
          <Reveal delay={80}>
            <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
              <Headline tokens={tokens}>
                {content.headline}
              </Headline>
            </InlineEditable>
          </Reveal>
        </div>

        {/* ── Testing layers as centered metric cards ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fit, minmax(200px, 1fr))`,
            gap: 'clamp(1rem, 2.5vw, 1.5rem)',
            marginBottom: 'clamp(2rem, 4vw, 3rem)',
            alignItems: 'stretch',
          }}
        >
          {sortedLayers.map((layer, li) => {
            const numericMatch = layer.coverage.match(/(\d+)/);
            const numericValue = numericMatch ? parseInt(numericMatch[1], 10) : 0;
            const originalIndex = (content.layers ?? []).findIndex(l => l === layer);
            return (
              <Reveal key={li} variant="fadeUp" delay={li * 80}>
                <InlineArrayItem arrayPath="layers" index={originalIndex} total={sortedLayers.length}>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      textAlign: 'center',
                      padding: 'clamp(1.5rem, 3vw, 2rem) 1.25rem',
                      borderRadius: 16,
                      background: `${tokens.accent}0f`,
                      border: `1px solid ${tokens.border}`,
                      gap: 12,
                      height: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    {/* Coverage number */}
                    <InlineEditable field={`layers.${originalIndex}.coverage`} label="Coverage" value={layer.coverage ?? ''}>
                      <span
                        style={{
                          fontFamily: `'${tokens.heroFont}', serif`,
                          fontWeight: tokens.heroWeight,
                          fontSize: 'clamp(2.2rem, 5vw, 3rem)',
                          lineHeight: 1,
                          color: tokens.accent,
                          letterSpacing: '-0.02em',
                        }}
                        {...rt(numericValue > 0 ? `${numericValue}%` : (layer.coverage ?? ''))}
                      />
                    </InlineEditable>

                    {/* Layer name */}
                    <InlineEditable field={`layers.${originalIndex}.name`} label="Layer name" value={layer.name ?? ''}>
                      <span
                        style={{
                          fontFamily: `'${tokens.bodyFont}', sans-serif`,
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase' as const,
                          color: tokens.text,
                        }}
                        {...rt(layer.name ?? '')}
                      />
                    </InlineEditable>

                    {/* Description */}
                    <InlineEditable field={`layers.${originalIndex}.description`} label="Description" value={layer.description ?? ''} multiline>
                      <span
                        style={{
                          fontFamily: `'${tokens.bodyFont}', sans-serif`,
                          fontSize: '0.8rem',
                          color: tokens.textMuted,
                          lineHeight: 1.55,
                        }}
                        {...rt(layer.description ?? '')}
                      />
                    </InlineEditable>

                    {/* Progress bar */}
                    <div
                      style={{
                        width: '100%',
                        height: 4,
                        borderRadius: 99,
                        background: `${tokens.accent}20`,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${numericValue}%`,
                          borderRadius: 99,
                          background: tokens.gradientText ?? tokens.accent,
                          transition: 'width 1s ease',
                        }}
                      />
                    </div>
                  </div>
                </InlineArrayItem>
              </Reveal>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'clamp(1.5rem, 3vw, 2.5rem)' }}>
          <InlineAddItem
            arrayPath="layers"
            template={{ level: sortedLayers.length + 1, name: 'New layer', coverage: '80%', description: 'Description…' }}
            label="Add layer"
          />
        </div>

        {/* ── Additional info grid ── */}
        {additionalInfo.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 'clamp(1rem, 2vw, 1.5rem)',
              alignItems: 'stretch',
            }}
          >
            {additionalInfo.map((info, ai) => (
              <Reveal key={ai} variant="fadeUp" delay={160 + sortedLayers.length * 80 + ai * 60}>
                <InlineArrayItem arrayPath="additionalInfo" index={ai} total={additionalInfo.length}>
                  <div
                    style={{
                      padding: 'clamp(1.25rem, 2vw, 1.75rem)',
                      borderRadius: 12,
                      border: `1px solid ${tokens.border}`,
                      textAlign: 'center',
                      height: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <InlineEditable field={`additionalInfo.${ai}.heading`} label="Heading" value={info.heading ?? ''}>
                      <p
                        style={{
                          fontFamily: `'${tokens.bodyFont}', sans-serif`,
                          fontWeight: 700,
                          fontSize: '0.95rem',
                          color: tokens.text,
                          marginBottom: 8,
                        }}
                        {...rt(info.heading ?? '')}
                      />
                    </InlineEditable>
                    <InlineEditable field={`additionalInfo.${ai}.body`} label="Body" value={info.body ?? ''} multiline>
                      <Body tokens={tokens} style={{ fontSize: '0.875rem' }}>
                        {info.body}
                      </Body>
                    </InlineEditable>
                  </div>
                </InlineArrayItem>
              </Reveal>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <InlineAddItem
            arrayPath="additionalInfo"
            template={{ heading: 'New section', body: 'Description…' }}
            label="Add info"
          />
        </div>
      </div>
    </section>
  );
}
