'use client';

import type { PluginTokens, TestingContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, SubHeadline, Body, Label } from '../shared/Typography';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { CircularProgress } from '../shared/CircularProgress';
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
            <Headline tokens={tokens} style={{ marginBottom: 48 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        {/* Circular progress rings — Gamma-style coverage indicators */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap' as const,
            justifyContent: 'center',
            gap: 'clamp(2rem, 5vw, 4rem)',
            marginBottom: 'clamp(2.5rem, 5vw, 4rem)',
          }}
        >
          {sortedLayers.map((layer, li) => {
            const numericMatch = layer.coverage.match(/(\d+)/);
            const numericValue = numericMatch ? parseInt(numericMatch[1], 10) : 0;
            const originalIndex = (content.layers ?? []).findIndex(l => l === layer);
            return (
              <InlineArrayItem key={li} arrayPath="layers" index={originalIndex} total={sortedLayers.length}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <CircularProgress
                    value={numericValue}
                    label={layer.name}
                    description={layer.description}
                    labelNode={
                      <InlineEditable field={`layers.${originalIndex}.name`} label="Layer name" value={layer.name ?? ''}>
                        <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: tokens.text }}>
                          {layer.name}
                        </span>
                      </InlineEditable>
                    }
                    descriptionNode={
                      <InlineEditable field={`layers.${originalIndex}.description`} label="Description" value={layer.description ?? ''} multiline>
                        <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 300, fontSize: '0.8rem', color: tokens.textMuted, lineHeight: 1.5 }}>
                          {layer.description}
                        </span>
                      </InlineEditable>
                    }
                    size={140}
                    strokeWidth={10}
                    tokens={tokens}
                    delay={li * 120}
                  />
                  <InlineEditable field={`layers.${originalIndex}.coverage`} label="Coverage" value={layer.coverage ?? ''}>
                    <span style={{ fontSize: '0.75rem', color: tokens.textMuted, fontFamily: `'${tokens.bodyFont}', sans-serif` }}>
                      {layer.coverage}
                    </span>
                  </InlineEditable>
                </div>
              </InlineArrayItem>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <InlineAddItem
            arrayPath="layers"
            template={{ level: sortedLayers.length + 1, name: 'New layer', coverage: '80%', description: 'Description…' }}
            label="Add layer"
          />
        </div>


        {/* Additional info grid */}
        {additionalInfo.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 'clamp(1.5rem, 3vw, 2rem)',
            }}
          >
            {additionalInfo.map((info, ai) => (
              <Reveal key={ai} variant="fadeUp" delay={160 + sortedLayers.length * 100 + ai * 80}>
                <InlineArrayItem arrayPath="additionalInfo" index={ai} total={additionalInfo.length}>
                  <div>
                    <InlineEditable field={`additionalInfo.${ai}.heading`} label="Heading" value={info.heading ?? ''}>
                      <SubHeadline tokens={tokens} style={{ marginBottom: 10, fontSize: '1.1rem' }}>
                        {info.heading}
                      </SubHeadline>
                    </InlineEditable>
                    <InlineEditable field={`additionalInfo.${ai}.body`} label="Body" value={info.body ?? ''} multiline>
                      <Body tokens={tokens} style={{ fontSize: '0.9rem' }}>
                        {info.body}
                      </Body>
                    </InlineEditable>
                  </div>
                </InlineArrayItem>
              </Reveal>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
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
