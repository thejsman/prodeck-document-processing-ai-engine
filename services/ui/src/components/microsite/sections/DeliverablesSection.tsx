'use client';

import type { PluginTokens, DeliverablesContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Body, Label } from '../shared/Typography';
import { GlassCard } from '../shared/GlassCard';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';
import { InlineIconEdit } from '../editor/InlineIconEdit';

interface Props {
  content: DeliverablesContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function DeliverablesSection({ content, tokens }: Props) {
  const items = content.items ?? [];
  const variant = (content as unknown as Record<string, unknown>).variant as string ?? 'grid';

  return (
    <section
      id="deliverables"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: tokens.surface,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
        <Reveal>
          <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: tokens.accent, display: 'block', marginBottom: 'clamp(1rem, 2vw, 1.5rem)' }}>
            {content.eyebrow || 'Deliverables'}
          </span>
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ marginBottom: 48 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        <div
          className={variant === 'list' ? undefined : 'ms-grid-auto'}
          style={variant === 'list' ? {
            display: 'flex', flexDirection: 'column', gap: 'clamp(0.75rem, 2vw, 1rem)',
          } : {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 'clamp(1rem, 2vw, 1.5rem)',
          }}
        >
          {items.map((item, ii) => (
            <Reveal key={ii} delay={160 + ii * 80}>
              <InlineArrayItem arrayPath="items" index={ii} total={items.length}>
                {variant === 'list' ? (
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 20,
                    padding: '18px 24px',
                    borderRadius: parseInt(tokens.borderRadius ?? '12') || 12,
                    border: `1px solid ${tokens.border}`,
                    background: tokens.surfaceCard,
                  }}>
                    <InlineIconEdit
                      fieldPath={`items.${ii}.iconHint`}
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
                      <InlineEditable field={`items.${ii}.name`} label="Name" value={item.name ?? ''}>
                        <h4 style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 700, fontSize: '0.875rem', color: tokens.text, margin: '0 0 6px' }}>
                          {item.name}
                        </h4>
                      </InlineEditable>
                      <InlineEditable field={`items.${ii}.detail`} label="Detail" value={item.detail ?? ''} multiline>
                        <Body tokens={tokens} style={{ fontSize: '0.875rem', lineHeight: 1.65 }}>{item.detail}</Body>
                      </InlineEditable>
                    </div>
                  </div>
                ) : (
                  <GlassCard tokens={tokens} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <InlineIconEdit
                      fieldPath={`items.${ii}.iconHint`}
                      hint={item.iconHint}
                      color={tokens.accent}
                      size={22}
                      containerStyle={{
                        width: 48, height: 48, borderRadius: 12,
                        background: `linear-gradient(135deg, ${tokens.accent}25, ${tokens.accent}10)`,
                        border: `1px solid ${tokens.accent}30`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    />
                    <InlineEditable field={`items.${ii}.name`} label="Name" value={item.name ?? ''}>
                      <h4 style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 700, fontSize: '0.875rem', color: tokens.text, margin: 0 }}>
                        {item.name}
                      </h4>
                    </InlineEditable>
                    <InlineEditable field={`items.${ii}.detail`} label="Detail" value={item.detail ?? ''} multiline>
                      <Body tokens={tokens} style={{ fontSize: '0.875rem', lineHeight: 1.65 }}>{item.detail}</Body>
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
            template={{ iconHint: 'document', name: 'New deliverable', detail: 'Describe this deliverable…' }}
            label="Add deliverable"
          />
        </div>
      </div>
    </section>
  );
}
