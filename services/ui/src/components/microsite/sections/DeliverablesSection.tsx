'use client';

import type { PluginTokens, DeliverablesContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Body, Label } from '../shared/Typography';
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

      {/* Decorative orbs */}
      <div style={{
        position: 'absolute', top: '-10%', left: '-5%',
        width: 400, height: 400, borderRadius: '50%',
        background: `radial-gradient(circle, ${tokens.accent}10 0%, transparent 70%)`,
        pointerEvents: 'none', zIndex: 1,
      }} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>

        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', marginBottom: 16 }}>
              {content.eyebrow || 'Deliverables'}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ marginBottom: 8 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        {/* Decorative divider */}
        <Reveal delay={100}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 52 }}>
            <div style={{ height: 1, width: 40, background: `linear-gradient(90deg, ${tokens.accent}50, transparent)` }} />
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: tokens.accent }} />
          </div>
        </Reveal>

        <div
          style={variant === 'list' ? {
            display: 'flex', flexDirection: 'column', gap: 'clamp(0.5rem, 1.5vw, 0.75rem)',
          } : {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 'clamp(1rem, 2vw, 1.5rem)',
          }}
        >
          {items.map((item, ii) => (
            <Reveal key={ii} delay={160 + ii * 70}>
              <InlineArrayItem arrayPath="items" index={ii} total={items.length}>
                {variant === 'list' ? (
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 20,
                    padding: '18px 24px',
                    borderRadius: tokens.borderRadius ?? '12px',
                    border: `1px solid ${tokens.border}`,
                    background: tokens.surfaceCard,
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                    position: 'relative',
                    overflow: 'hidden',
                  }}>
                    {/* Left accent bar */}
                    <div style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                      background: `linear-gradient(180deg, ${tokens.accent}, ${tokens.accent}40)`,
                      borderRadius: '3px 0 0 3px',
                    }} />

                    {/* Number badge */}
                    <div style={{
                      flexShrink: 0, width: 36, height: 36, borderRadius: 10,
                      background: `linear-gradient(135deg, ${tokens.accent}25, ${tokens.accent}10)`,
                      border: `1px solid ${tokens.accent}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{
                        fontFamily: `'${tokens.heroFont}', sans-serif`,
                        fontWeight: 800, fontSize: '0.75rem',
                        color: tokens.accent,
                      }}>
                        {String(ii + 1).padStart(2, '0')}
                      </span>
                    </div>

                    <InlineIconEdit
                      fieldPath={`items.${ii}.iconHint`}
                      hint={item.iconHint}
                      color={tokens.accent}
                      size={0}
                      containerStyle={{ display: 'none' }}
                    />

                    <div style={{ flex: 1 }}>
                      <InlineEditable field={`items.${ii}.name`} label="Name" value={item.name ?? ''}>
                        <h4 style={{
                          fontFamily: `'${tokens.bodyFont}', sans-serif`,
                          fontWeight: 700, fontSize: '0.875rem',
                          color: tokens.text, margin: '0 0 6px',
                        }}>
                          {item.name}
                        </h4>
                      </InlineEditable>
                      <InlineEditable field={`items.${ii}.detail`} label="Detail" value={item.detail ?? ''} multiline>
                        <Body tokens={tokens} style={{ fontSize: '0.825rem', lineHeight: 1.65 }}>{item.detail}</Body>
                      </InlineEditable>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    position: 'relative',
                    padding: 'clamp(1.25rem, 2.5vw, 1.75rem)',
                    borderRadius: tokens.borderRadius ?? '16px',
                    border: `1px solid ${tokens.border}`,
                    background: `linear-gradient(145deg, ${tokens.surfaceCard}, ${tokens.surface})`,
                    boxShadow: tokens.cardShadow,
                    display: 'flex', flexDirection: 'column', gap: 14,
                    overflow: 'hidden',
                  }}>
                    {/* Corner accent */}
                    <div style={{
                      position: 'absolute', top: 0, right: 0,
                      width: 60, height: 60,
                      background: `radial-gradient(circle at top right, ${tokens.accent}15, transparent 70%)`,
                    }} />

                    {/* Icon + number row */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <InlineIconEdit
                        fieldPath={`items.${ii}.iconHint`}
                        hint={item.iconHint}
                        color={tokens.accent}
                        size={22}
                        containerStyle={{
                          width: 48, height: 48, borderRadius: 14,
                          background: `linear-gradient(135deg, ${tokens.accent}25, ${tokens.accent}10)`,
                          border: `1px solid ${tokens.accent}30`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      />
                      <span style={{
                        fontFamily: `'${tokens.heroFont}', sans-serif`,
                        fontWeight: 800, fontSize: '1.1rem',
                        color: `${tokens.accent}30`,
                        letterSpacing: '-0.02em',
                      }}>
                        {String(ii + 1).padStart(2, '0')}
                      </span>
                    </div>

                    <InlineEditable field={`items.${ii}.name`} label="Name" value={item.name ?? ''}>
                      <h4 style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontWeight: 700, fontSize: '0.875rem',
                        color: tokens.text, margin: 0,
                      }}>
                        {item.name}
                      </h4>
                    </InlineEditable>

                    {/* Divider */}
                    <div style={{ height: 1, background: `${tokens.accent}20` }} />

                    <InlineEditable field={`items.${ii}.detail`} label="Detail" value={item.detail ?? ''} multiline>
                      <Body tokens={tokens} style={{ fontSize: '0.825rem', lineHeight: 1.65 }}>{item.detail}</Body>
                    </InlineEditable>
                  </div>
                )}
              </InlineArrayItem>
            </Reveal>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
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
