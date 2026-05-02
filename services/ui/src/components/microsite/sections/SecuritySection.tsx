'use client';

import type { PluginTokens, SecurityContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';
import { InlineIconEdit } from '../editor/InlineIconEdit';
import { rt } from '../shared/Typography';

interface Props {
  content: SecurityContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function SecuritySection({ content, tokens }: Props) {
  const items = content.items ?? [];
  const accentRgb = tokens.accentRgb ?? '99,179,237';

  return (
    <section
      id="security"
      style={{
        position: 'relative',
        padding: 'clamp(5rem, 10vw, 8rem) 2rem',
        background: getSectionGradient('security', tokens),
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 880, margin: '0 auto' }}>

        {/* Section header */}
        <Reveal>
          <div style={{ marginBottom: 'clamp(3rem, 6vw, 5rem)' }}>
            <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
              <span {...rt(content.eyebrow ?? '')} style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.62rem', fontWeight: 700,
                letterSpacing: '0.18em', textTransform: 'uppercase' as const,
                color: tokens.accent, display: 'block', marginBottom: 20,
              }} />
            </InlineEditable>
            <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
              <h2 {...rt(content.headline ?? '')} style={{
                fontFamily: `'${tokens.heroFont}', serif`,
                fontWeight: Number(tokens.heroWeight) || 700,
                fontSize: 'clamp(2rem, 4vw, 3.2rem)',
                lineHeight: 1.1, letterSpacing: '-0.03em',
                color: tokens.text, margin: 0,
                maxWidth: 640,
              }} />
            </InlineEditable>
          </div>
        </Reveal>

        {/* Divider */}
        <div style={{ height: 1, background: tokens.border, marginBottom: 'clamp(2.5rem, 5vw, 4rem)' }} />

        {/* Items — open numbered list, #heard style */}
        <div>
          {items.map((item, si) => (
            <Reveal key={si} delay={100 + si * 70}>
              <InlineArrayItem arrayPath="items" index={si} total={items.length}>
                <div style={{
                  position: 'relative',
                  display: 'grid',
                  gridTemplateColumns: '72px 40px 1fr',
                  gap: 'clamp(0.75rem, 2vw, 1.5rem)',
                  alignItems: 'start',
                  paddingBottom: 'clamp(1.5rem, 3vw, 2.5rem)',
                  marginBottom: si < items.length - 1 ? 'clamp(1.5rem, 3vw, 2.5rem)' : 0,
                  borderBottom: si < items.length - 1 ? `1px solid ${tokens.border}` : 'none',
                }}>
                  {/* Ordinal number */}
                  <div style={{
                    fontFamily: `'${tokens.heroFont}', serif`,
                    fontSize: 'clamp(1.1rem, 2vw, 1.4rem)',
                    fontWeight: 700,
                    color: si === 0 ? tokens.accent : `rgba(${accentRgb},0.3)`,
                    letterSpacing: '-0.02em',
                    lineHeight: 1,
                    paddingTop: 3,
                  }}>
                    {String(si + 1).padStart(2, '0')}
                  </div>

                  {/* Icon */}
                  <div style={{ paddingTop: 2 }}>
                    <InlineIconEdit
                      fieldPath={`items.${si}.iconHint`}
                      hint={item.iconHint}
                      color={tokens.accent}
                      size={24}
                      containerStyle={{ display: 'inline-flex' }}
                    />
                  </div>

                  {/* Text */}
                  <div>
                    <InlineEditable field={`items.${si}.name`} label="Name" value={item.name ?? ''}>
                      <h4 {...rt(item.name ?? '')} style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontWeight: 700, fontSize: '1rem',
                        color: tokens.text, margin: '0 0 8px', lineHeight: 1.3,
                      }} />
                    </InlineEditable>
                    <InlineEditable field={`items.${si}.description`} label="Description" value={item.description ?? ''} multiline>
                      <p {...rt(item.description ?? '')} style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.95rem', lineHeight: 1.75,
                        color: tokens.textMuted, margin: 0,
                      }} />
                    </InlineEditable>
                  </div>
                </div>
              </InlineArrayItem>
            </Reveal>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          <InlineAddItem
            arrayPath="items"
            template={{ iconHint: 'shield', name: 'New item', description: 'Describe this…' }}
            label="Add item"
          />
        </div>
      </div>
    </section>
  );
}
