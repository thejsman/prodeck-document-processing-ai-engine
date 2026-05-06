'use client';

import type { PluginTokens, BenefitsContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { GlassCard } from '../shared/GlassCard';
import { Headline, Label, Body, rt } from '../shared/Typography';
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
            <Headline tokens={tokens} style={{ textAlign: 'center', marginBottom: 8 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        {/* Decorative divider */}
        <Reveal delay={100}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 52 }}>
            <div style={{ height: 1, width: 40, background: `linear-gradient(90deg, transparent, ${tokens.accent}40)` }} />
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: tokens.accent }} />
            <div style={{ height: 1, width: 40, background: `linear-gradient(270deg, transparent, ${tokens.accent}40)` }} />
          </div>
        </Reveal>

        {/* Decorative orb */}
        <div style={{
          position: 'absolute', top: '5%', right: '-5%',
          width: 350, height: 350, borderRadius: '50%',
          background: `radial-gradient(circle, ${tokens.accent}09 0%, transparent 70%)`,
          pointerEvents: 'none', zIndex: 1,
        }} />

        <div
          className={variant === 'list' ? undefined : 'ms-grid-3'}
          style={variant === 'list' ? {
            display: 'flex', flexDirection: 'column', gap: 'clamp(0.5rem, 1.5vw, 0.75rem)',
          } : {
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.max(cols, 1)}, minmax(0, 1fr))`,
            gap: 'clamp(1rem, 2.5vw, 2rem)',
          }}
        >
          {items.map((item, i) => (
            <Reveal key={i} delay={160 + i * 80}>
              <InlineArrayItem arrayPath="items" index={i} total={items.length}>
                {variant === 'list' ? (
                  <div className="ms-card" style={{
                    display: 'flex', alignItems: 'flex-start', gap: 20,
                    padding: '18px 24px',
                    borderRadius: parseInt(tokens.borderRadius ?? '12') || 12,
                    border: `1px solid ${tokens.border}`,
                    background: tokens.surfaceCard,
                    position: 'relative', overflow: 'hidden',
                  }}>
                    <div style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                      background: `linear-gradient(180deg, ${tokens.accent}, ${tokens.accent}30)`,
                    }} />
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
                        <div style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 700, fontSize: '0.875rem', color: tokens.text, marginBottom: 6 }}
                          {...rt(item.title ?? '')} />
                      </InlineEditable>
                      <InlineEditable field={`items.${i}.description`} label="Description" value={item.description ?? ''} multiline>
                        <Body tokens={tokens} style={{ fontSize: '0.825rem', lineHeight: 1.7 }}>{item.description}</Body>
                      </InlineEditable>
                    </div>
                  </div>
                ) : (
                  <div className="ms-card" style={{
                    position: 'relative',
                    padding: 'clamp(1.25rem, 2.5vw, 1.75rem)',
                    borderRadius: tokens.borderRadius ?? '16px',
                    border: `1px solid ${tokens.border}`,
                    background: `linear-gradient(145deg, ${tokens.surfaceCard}, ${tokens.surface})`,
                    boxShadow: tokens.cardShadow,
                    overflow: 'hidden',
                    height: '100%',
                  }}>
                    {/* Top accent bar */}
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                      background: `linear-gradient(90deg, ${tokens.accent}80, transparent)`,
                    }} />
                    {/* Corner glow */}
                    <div style={{
                      position: 'absolute', top: 0, left: 0,
                      width: 80, height: 80,
                      background: `radial-gradient(circle at top left, ${tokens.accent}12, transparent 70%)`,
                    }} />
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
                        marginBottom: 18,
                      }}
                    />
                    <InlineEditable field={`items.${i}.title`} label="Title" value={item.title ?? ''}>
                      <div style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 700, fontSize: '0.9rem', color: tokens.text, marginBottom: 10 }}
                        {...rt(item.title ?? '')} />
                    </InlineEditable>
                    <div style={{ height: 1, background: `${tokens.accent}20`, marginBottom: 12 }} />
                    <InlineEditable field={`items.${i}.description`} label="Description" value={item.description ?? ''} multiline>
                      <Body tokens={tokens} style={{ fontSize: '0.825rem', lineHeight: 1.7 }}>{item.description}</Body>
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
            template={{ iconHint: 'check', title: 'New benefit', description: 'Describe this benefit…' }}
            label="Add benefit"
          />
        </div>
      </div>
    </section>
  );
}
