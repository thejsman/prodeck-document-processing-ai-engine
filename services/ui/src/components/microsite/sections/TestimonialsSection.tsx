'use client';

import type { PluginTokens, TestimonialsContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { GlassCard } from '../shared/GlassCard';
import { Headline, Label, Body, inlineMarkdownToHtml, hasMarkdown } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

interface Props {
  content: TestimonialsContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function TestimonialsSection({ content, tokens, sectionId }: Props) {
  const items = content.items ?? [];

  // Suppress section entirely when no real testimonials exist (agent returns [] when no source quotes)
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
        fontFamily: 'Georgia, serif',
        fontSize: 'clamp(12rem, 25vw, 22rem)',
        fontWeight: 700,
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
          }}
        >
          {items.map((item, i) => (
            <Reveal key={i} delay={160 + i * 80}>
              <InlineArrayItem arrayPath="items" index={i} total={items.length}>
                <GlassCard tokens={tokens} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  {/* Quote mark */}
                  <div style={{ fontFamily: 'Georgia, serif', fontSize: '3rem', lineHeight: 0.8, color: tokens.accent, fontWeight: 700 }}>
                    &ldquo;
                  </div>

                  {/* Quote text */}
                  <InlineEditable field={`items.${i}.quote`} label="Quote" value={item.quote ?? ''} multiline>
                    <p
                      style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.875rem',
                        lineHeight: 1.75,
                        color: tokens.text,
                        fontStyle: 'italic',
                        margin: 0,
                        flex: 1,
                      }}
                      {...(hasMarkdown(item.quote ?? '')
                        ? { dangerouslySetInnerHTML: { __html: inlineMarkdownToHtml(item.quote ?? '') } }
                        : { children: item.quote })}
                    />
                  </InlineEditable>

                  {/* Attribution */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 20, borderTop: `1px solid ${tokens.border}` }}>
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
                        }}>
                          {item.name}
                        </div>
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
