'use client';

import { useState, useLayoutEffect, useRef } from 'react';
import type { PluginTokens, TestimonialsContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { GlassCard } from '../shared/GlassCard';
import { Headline, Label, Body, inlineMarkdownToHtml, hasMarkdown, rt } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

interface Props {
  content: TestimonialsContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

// ~4 lines at 0.875rem font-size / 1.75 line-height
const COLLAPSED_MAX_H = '6.125rem';
// Must be a px value (not 'none') so CSS max-height transition works
const EXPANDED_MAX_H = '1000px';

interface ExpandableQuoteProps {
  quote: string;
  tokens: PluginTokens;
  index: number;
}

function ExpandableQuote({ quote, tokens, index }: ExpandableQuoteProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // useLayoutEffect: fires before paint so 'overflows' is correct on first visible frame
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [quote]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ position: 'relative' }}>
        {/* Text container — clamped when collapsed */}
        <div
          ref={containerRef}
          style={{
            maxHeight: expanded ? EXPANDED_MAX_H : COLLAPSED_MAX_H,
            overflow: 'hidden',
            transition: 'max-height 0.35s ease',
          }}
        >
          <InlineEditable field={`items.${index}.quote`} label="Quote" value={quote} multiline>
            <p
              style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.875rem',
                lineHeight: 1.75,
                color: tokens.text,
                fontStyle: 'italic',
                margin: 0,
              }}
              {...(hasMarkdown(quote)
                ? { dangerouslySetInnerHTML: { __html: inlineMarkdownToHtml(quote) } }
                : { children: quote })}
            />
          </InlineEditable>
        </div>

        {/* Fade gradient — only visible when collapsed and content overflows */}
        {!expanded && overflows && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '2.5rem',
              background: `linear-gradient(to bottom, transparent, ${tokens.surfaceCard})`,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {/* Toggle — only rendered when text actually overflows the collapsed height */}
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontFamily: `'${tokens.bodyFont}', sans-serif`,
            fontSize: '0.8rem',
            fontWeight: 600,
            color: tokens.accent,
            textAlign: 'left',
          }}
        >
          {expanded ? 'See Less' : 'See More'}
        </button>
      )}
    </div>
  );
}

export function TestimonialsSection({ content, tokens, sectionId }: Props) {
  const items = content.items ?? [];

  // Suppress section entirely when no real testimonials exist
  if (items.length === 0) return null;

  return (
    <section
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: `linear-gradient(180deg, ${tokens.surfaceCard} 0%, ${tokens.surface} 100%)`,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      {/* Decorative quote mark */}
      <div style={{
        position: 'absolute',
        top: '5%',
        left: '3%',
        fontSize: 'clamp(12rem, 25vw, 22rem)',
        fontWeight: 600,
        color: tokens.accent,
        opacity: 0.05,
        lineHeight: 1,
        pointerEvents: 'none',
        zIndex: 1,
        userSelect: 'none',
      }}>
        &ldquo;
      </div>

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
            <Headline tokens={tokens} style={{ textAlign: 'center', marginBottom: 56 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        <div
          className="ms-grid-auto"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(items.length, 3)}, minmax(0, 1fr))`,
            gap: 'clamp(1rem, 2vw, 1.5rem)',
            alignItems: 'stretch',
          }}
        >
          {items.map((item, i) => (
            <Reveal key={i} delay={160 + i * 80}>
              <InlineArrayItem arrayPath="items" index={i} total={items.length}>
                <GlassCard tokens={tokens} style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%' }}>
                  {/* Decorative opening quote mark */}
                  <div style={{ fontFamily: 'Georgia, serif', fontSize: '3rem', lineHeight: 0.8, color: tokens.accent, fontWeight: 700 }}>
                    &ldquo;
                  </div>

                  {/* Quote text — clamped with per-card expand/collapse */}
                  <ExpandableQuote quote={item.quote ?? ''} tokens={tokens} index={i} />

                  {/* Attribution — marginTop auto anchors it to the card bottom */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 20, borderTop: `1px solid ${tokens.border}`, marginTop: 'auto' }}>
                    {/* Avatar initials */}
                    <div style={{
                      width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                      background: `linear-gradient(135deg, ${tokens.accent}30, ${tokens.accent}60)`,
                      border: `1px solid ${tokens.accent}50`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 700,
                      fontSize: '0.85rem', color: tokens.accent,
                    }}>
                      {(item.name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <InlineEditable field={`items.${i}.name`} label="Name" value={item.name ?? ''}>
                        <div style={{
                          fontFamily: `'${tokens.bodyFont}', sans-serif`,
                          fontWeight: 600, fontSize: '0.875rem', color: tokens.text,
                        }}
                          {...rt(item.name ?? '')} />
                      </InlineEditable>
                      <InlineEditable field={`items.${i}.title`} label="Title" value={item.title ?? ''}>
                        <Body tokens={tokens} style={{ fontSize: '0.75rem', marginTop: 2 }}>
                          {item.title}
                        </Body>
                      </InlineEditable>
                      <InlineEditable field={`items.${i}.company`} label="Company" value={item.company ?? ''}>
                        <Body tokens={tokens} style={{ fontSize: '0.75rem' }}>
                          {item.company}
                        </Body>
                      </InlineEditable>
                    </div>
                  </div>
                </GlassCard>
              </InlineArrayItem>
            </Reveal>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <InlineAddItem
            arrayPath="items"
            template={{ quote: 'Share your experience here…', name: 'Full Name', title: 'Job Title', company: 'Company' }}
            label="Add testimonial"
          />
        </div>
      </div>
    </section>
  );
}
