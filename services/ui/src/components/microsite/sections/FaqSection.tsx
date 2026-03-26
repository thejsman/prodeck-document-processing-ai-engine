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
            <Headline tokens={tokens} style={{ textAlign: 'center', marginBottom: content.subheadline ? 16 : 56 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        {content.subheadline && (
          <Reveal delay={120}>
            <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline} multiline>
              <Body tokens={tokens} style={{ textAlign: 'center', marginBottom: 56, maxWidth: 600, margin: '0 auto 56px' }}>
                {content.subheadline}
              </Body>
            </InlineEditable>
          </Reveal>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <Reveal key={i} delay={160 + i * 60}>
                <InlineArrayItem arrayPath="items" index={i} total={items.length}>
                  <div
                    style={{
                      border: `1px solid ${isOpen ? tokens.accent + '60' : tokens.border}`,
                      borderRadius: tokens.borderRadius ?? '12px',
                      overflow: 'hidden',
                      background: isOpen ? `${tokens.accent}08` : tokens.surfaceCard,
                      transition: 'border-color 0.2s, background 0.2s',
                    }}
                  >
                    {/* Question row */}
                    <button
                      onClick={() => setOpenIndex(isOpen ? null : i)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '20px 24px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        gap: 16,
                        textAlign: 'left',
                      }}
                    >
                      <InlineEditable field={`items.${i}.question`} label="Question" value={item.question ?? ''}>
                        <span style={{
                          fontFamily: `'${tokens.bodyFont}', sans-serif`,
                          fontWeight: 600,
                          fontSize: '1rem',
                          color: tokens.text,
                          flex: 1,
                        }}>
                          {item.question}
                        </span>
                      </InlineEditable>
                      {/* Chevron */}
                      <span style={{
                        flexShrink: 0,
                        width: 28, height: 28,
                        borderRadius: '50%',
                        background: isOpen ? tokens.accent : `${tokens.accent}20`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'transform 0.25s, background 0.2s',
                        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 4l4 4 4-4" stroke={isOpen ? tokens.bg : tokens.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </span>
                    </button>

                    {/* Answer */}
                    {isOpen && (
                      <div style={{ padding: '0 24px 24px', borderTop: `1px solid ${tokens.border}` }}>
                        <InlineEditable field={`items.${i}.answer`} label="Answer" value={item.answer ?? ''} multiline>
                          <Body tokens={tokens} style={{ paddingTop: 16, lineHeight: 1.75 }}>
                            {item.answer}
                          </Body>
                        </InlineEditable>
                      </div>
                    )}
                  </div>
                </InlineArrayItem>
              </Reveal>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
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
