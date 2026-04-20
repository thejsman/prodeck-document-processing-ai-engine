'use client';

import type { PluginTokens, SecurityContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { CircularIconBadge } from '../shared/CircularIconBadge';
import { Headline, Body, Label } from '../shared/Typography';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';
import { InlineIconEdit } from '../editor/InlineIconEdit';

interface Props {
  content: SecurityContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function SecuritySection({ content, tokens }: Props) {
  const items = content.items ?? [];
  const variant = (content as unknown as Record<string, unknown>).variant as string ?? 'grid';

  return (
    <section
      id="security"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: getSectionGradient('security', tokens),
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

        <div
          style={variant === 'list' ? {
            display: 'flex', flexDirection: 'column', gap: 'clamp(0.75rem, 2vw, 1rem)',
          } : {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 'clamp(2rem, 4vw, 3rem)',
          }}
        >
          {items.map((item, si) => (
            <Reveal key={si} variant="fadeUp" delay={160 + si * 80}>
              <InlineArrayItem arrayPath="items" index={si} total={items.length}>
                {variant === 'list' ? (
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 20,
                    padding: '18px 24px',
                    borderRadius: parseInt(tokens.borderRadius ?? '12') || 12,
                    border: `1px solid ${tokens.border}`,
                    background: tokens.surfaceCard,
                  }}>
                    <InlineIconEdit
                      fieldPath={`items.${si}.iconHint`}
                      hint={item.iconHint}
                      color={tokens.accent}
                      size={36}
                      containerStyle={{ flexShrink: 0, display: 'inline-flex', marginTop: 2 }}
                    />
                    <div style={{ flex: 1 }}>
                      <InlineEditable field={`items.${si}.name`} label="Name" value={item.name ?? ''}>
                        <h4 style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 600, fontSize: '0.875rem', color: tokens.text, margin: '0 0 6px', lineHeight: 1.3 }}>
                          {item.name}
                        </h4>
                      </InlineEditable>
                      <InlineEditable field={`items.${si}.description`} label="Description" value={item.description ?? ''} multiline>
                        <Body tokens={tokens} style={{ fontSize: '0.825rem' }}>{item.description}</Body>
                      </InlineEditable>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
                    <InlineIconEdit
                      fieldPath={`items.${si}.iconHint`}
                      hint={item.iconHint}
                      color={tokens.accent}
                      size={44}
                      containerStyle={{ display: 'inline-flex' }}
                    />
                    <InlineEditable field={`items.${si}.name`} label="Name" value={item.name ?? ''}>
                      <h4 style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 600, fontSize: '1.05rem', color: tokens.text, margin: 0, lineHeight: 1.3 }}>
                        {item.name}
                      </h4>
                    </InlineEditable>
                    <InlineEditable field={`items.${si}.description`} label="Description" value={item.description ?? ''} multiline>
                      <Body tokens={tokens} style={{ fontSize: '0.825rem' }}>{item.description}</Body>
                    </InlineEditable>
                  </div>
                )}
              </InlineArrayItem>
            </Reveal>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <InlineAddItem
            arrayPath="items"
            template={{ iconHint: 'shield', name: 'New security item', description: 'Describe this…' }}
            label="Add item"
          />
        </div>

      </div>
    </section>
  );
}
