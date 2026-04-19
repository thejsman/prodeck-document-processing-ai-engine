'use client';

import { useState } from 'react';
import type { PluginTokens, FaqContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Headline, Label, Body } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

interface Props {
  content: FaqContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function FaqSection({ content, tokens }: Props) {
  const items = content.items ?? [];
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const variant = (content as unknown as Record<string, unknown>).variant as string ?? 'accordion';

  return (
    <section
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: `linear-gradient(180deg, ${tokens.bg} 0%, ${tokens.surface} 100%)`,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      {/* Decorative orbs */}
      <div style={{
        position: 'absolute', bottom: '-5%', right: '-5%',
        width: 400, height: 400, borderRadius: '50%',
        background: `radial-gradient(circle, ${tokens.accent}10 0%, transparent 70%)`,
        pointerEvents: 'none', zIndex: 1,
      }} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 860, margin: '0 auto' }}>

        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', textAlign: 'center', marginBottom: 16 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ textAlign: 'center', marginBottom: content.subheadline ? 16 : 8 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        {/* Decorative divider */}
        <Reveal delay={100}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: content.subheadline ? 20 : 52 }}>
            <div style={{ height: 1, width: 40, background: `linear-gradient(90deg, transparent, ${tokens.accent}40)` }} />
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: tokens.accent }} />
            <div style={{ height: 1, width: 40, background: `linear-gradient(270deg, transparent, ${tokens.accent}40)` }} />
          </div>
        </Reveal>

        {content.subheadline && (
          <Reveal delay={120}>
            <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline} multiline>
              <Body tokens={tokens} style={{ textAlign: 'center', marginBottom: 52, maxWidth: 600, margin: '0 auto 52px' }}>
                {content.subheadline}
              </Body>
            </InlineEditable>
          </Reveal>
        )}

        {variant === 'two-column' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'clamp(1rem, 2vw, 1.5rem)' }}>
            {items.map((item, i) => (
              <Reveal key={i} delay={160 + i * 60}>
                <InlineArrayItem arrayPath="items" index={i} total={items.length}>
                  <div style={{
                    position: 'relative',
                    padding: '24px',
                    borderRadius: tokens.borderRadius ?? '12px',
                    border: `1px solid ${tokens.border}`,
                    background: `linear-gradient(145deg, ${tokens.surfaceCard}, ${tokens.surface})`,
                    boxShadow: tokens.cardShadow,
                    overflow: 'hidden',
                  }}>
                    {/* Number badge */}
                    <div style={{
                      position: 'absolute', top: 16, right: 16,
                      width: 28, height: 28, borderRadius: '50%',
                      background: `${tokens.accent}12`,
                      border: `1px solid ${tokens.accent}25`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{
                        fontFamily: `'${tokens.heroFont}', sans-serif`,
                        fontWeight: 700, fontSize: '0.65rem',
                        color: tokens.accent,
                      }}>{String(i + 1).padStart(2, '0')}</span>
                    </div>

                    <InlineEditable field={`items.${i}.question`} label="Question" value={item.question ?? ''}>
                      <div style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 700,
                        fontSize: '0.875rem', color: tokens.text, marginBottom: 12,
                        lineHeight: 1.4, paddingRight: 36,
                      }}>{item.question}</div>
                    </InlineEditable>
                    <div style={{ width: 28, height: 2, background: `linear-gradient(90deg, ${tokens.accent}, transparent)`, borderRadius: 2, marginBottom: 14 }} />
                    <InlineEditable field={`items.${i}.answer`} label="Answer" value={item.answer ?? ''} multiline>
                      <Body tokens={tokens} style={{ fontSize: '0.825rem', lineHeight: 1.7 }}>{item.answer}</Body>
                    </InlineEditable>
                  </div>
                </InlineArrayItem>
              </Reveal>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((item, i) => {
              const isOpen = openIndex === i;
              return (
                <Reveal key={i} delay={160 + i * 50}>
                  <InlineArrayItem arrayPath="items" index={i} total={items.length}>
                    <div style={{
                      border: `1px solid ${isOpen ? tokens.accent + '50' : tokens.border}`,
                      borderRadius: tokens.borderRadius ?? '12px',
                      overflow: 'hidden',
                      background: isOpen
                        ? `linear-gradient(135deg, ${tokens.accent}08, ${tokens.surfaceCard})`
                        : tokens.surfaceCard,
                      boxShadow: isOpen ? `0 4px 20px ${tokens.accent}12` : 'none',
                      transition: 'border-color 0.25s, background 0.25s, box-shadow 0.25s',
                    }}>
                      <button
                        onClick={() => setOpenIndex(isOpen ? null : i)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '18px 24px',
                          background: 'none', border: 'none', cursor: 'pointer',
                          gap: 16, textAlign: 'left',
                        }}
                      >
                        {/* Number + question */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
                          <span style={{
                            flexShrink: 0,
                            fontFamily: `'${tokens.heroFont}', sans-serif`,
                            fontWeight: 800, fontSize: '0.75rem',
                            color: isOpen ? tokens.accent : tokens.textMuted,
                            letterSpacing: '-0.01em',
                            transition: 'color 0.2s',
                            minWidth: 24,
                          }}>
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <InlineEditable field={`items.${i}.question`} label="Question" value={item.question ?? ''}>
                            <span style={{
                              fontFamily: `'${tokens.bodyFont}', sans-serif`,
                              fontWeight: 600, fontSize: '0.875rem',
                              color: isOpen ? tokens.text : tokens.text,
                              flex: 1, lineHeight: 1.4,
                            }}>
                              {item.question}
                            </span>
                          </InlineEditable>
                        </div>

                        {/* Chevron */}
                        <span style={{
                          flexShrink: 0, width: 30, height: 30, borderRadius: '50%',
                          background: isOpen ? tokens.accent : `${tokens.accent}15`,
                          border: `1px solid ${isOpen ? tokens.accent : tokens.accent + '25'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'transform 0.25s, background 0.2s',
                          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                        }}>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M2 4l4 4 4-4" stroke={isOpen ? tokens.bg : tokens.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </button>

                      {isOpen && (
                        <div style={{ padding: '0 24px 22px', paddingLeft: 62 }}>
                          <div style={{ height: 1, background: `${tokens.accent}20`, marginBottom: 16 }} />
                          <InlineEditable field={`items.${i}.answer`} label="Answer" value={item.answer ?? ''} multiline>
                            <Body tokens={tokens} style={{ lineHeight: 1.78, fontSize: '0.875rem' }}>{item.answer}</Body>
                          </InlineEditable>
                        </div>
                      )}
                    </div>
                  </InlineArrayItem>
                </Reveal>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <InlineAddItem
            arrayPath="items"
            template={{ question: 'New question?', answer: 'Answer goes here…' }}
            label="Add question"
          />
        </div>
      </div>
    </section>
  );
}
