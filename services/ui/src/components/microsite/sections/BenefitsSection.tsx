'use client';

import type { PluginTokens, BenefitsContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { GlassCard } from '../shared/GlassCard';
import { Headline, Label, Body } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';
import { InlineIconEdit } from '../editor/InlineIconEdit';

interface Props {
  content: BenefitsContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function BenefitsSection({ content, tokens }: Props) {
  const items = content.items ?? [];
  const cols = items.length <= 3 ? items.length : Math.min(items.length, 3);
  const variant = (content as unknown as Record<string, unknown>).variant as string ?? 'grid';

  return (
    <section
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: `linear-gradient(180deg, ${tokens.surface} 0%, ${tokens.bg} 100%)`,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', textAlign: 'center', marginBottom: 16 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>
        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ textAlign: 'center', marginBottom: 60 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        <div
          className={variant === 'list' ? undefined : 'ms-grid-3'}
          style={variant === 'list' ? {
            display: 'flex', flexDirection: 'column', gap: 'clamp(0.75rem, 2vw, 1rem)',
          } : {
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.max(cols, 1)}, 1fr)`,
            gap: 'clamp(1rem, 2.5vw, 2rem)',
          }}
        >
          {items.map((item, i) => (
            <Reveal key={i} delay={160 + i * 80}>
              <InlineArrayItem arrayPath="items" index={i} total={items.length}>
                {variant === 'list' ? (
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 20,
                    padding: '18px 24px',
                    borderRadius: parseInt(tokens.borderRadius ?? '12') || 12,
                    border: `1px solid ${tokens.border}`,
                    background: tokens.surfaceCard,
                  }}>
                    <InlineIconEdit
                      fieldPath={`items.${i}.iconHint`}
                      hint={item.iconHint}
                      color={tokens.accent}
                      size={22}
                      containerStyle={{
                        width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                        background: `linear-gradient(135deg, ${tokens.accent}25, ${tokens.accent}10)`,
                        border: `1px solid ${tokens.accent}30`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <InlineEditable field={`items.${i}.title`} label="Title" value={item.title ?? ''}>
                        <div style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 700, fontSize: '1rem', color: tokens.text, marginBottom: 6 }}>
                          {item.title}
                        </div>
                      </InlineEditable>
                      <InlineEditable field={`items.${i}.description`} label="Description" value={item.description ?? ''} multiline>
                        <Body tokens={tokens} style={{ fontSize: '0.9rem', lineHeight: 1.7 }}>{item.description}</Body>
                      </InlineEditable>
                    </div>
                  </div>
                ) : (
                  <GlassCard tokens={tokens}>
                    <InlineIconEdit
                      fieldPath={`items.${i}.iconHint`}
                      hint={item.iconHint}
                      color={tokens.accent}
                      size={22}
                      containerStyle={{
                        width: 52, height: 52, borderRadius: 14,
                        background: `linear-gradient(135deg, ${tokens.accent}25, ${tokens.accent}10)`,
                        border: `1px solid ${tokens.accent}30`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        marginBottom: 22,
                      }}
                    />
                    <InlineEditable field={`items.${i}.title`} label="Title" value={item.title ?? ''}>
                      <div style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 700, fontSize: '1rem', color: tokens.text, marginBottom: 10 }}>
                        {item.title}
                      </div>
                    </InlineEditable>
                    <InlineEditable field={`items.${i}.description`} label="Description" value={item.description ?? ''} multiline>
                      <Body tokens={tokens} style={{ fontSize: '0.9rem', lineHeight: 1.7 }}>{item.description}</Body>
                    </InlineEditable>
                  </GlassCard>
                )}
              </InlineArrayItem>
            </Reveal>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <InlineAddItem
            arrayPath="items"
            template={{ iconHint: 'check', title: 'New benefit', description: 'Describe this benefit…' }}
            label="Add benefit"
          />
        </div>
      </div>
    </section>
  );
}
