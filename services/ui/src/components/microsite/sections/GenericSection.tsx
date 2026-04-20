'use client';

import type { PluginTokens, GenericContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { InlineEditable } from '../editor/InlineEditable';

interface Props {
  content: GenericContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

type Item = { title: string; subtitle?: string };

function Eyebrow({ text, tokens }: { text: string; tokens: PluginTokens }) {
  return (
    <span style={{
      fontFamily: `'${tokens.bodyFont}', sans-serif`,
      fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.2em',
      textTransform: 'uppercase' as const, color: tokens.accent,
      display: 'block', marginBottom: '0.9rem',
    }}>{text}</span>
  );
}

function Headline({ text, tokens, align = 'left' }: { text: string; tokens: PluginTokens; align?: 'left' | 'center' }) {
  return (
    <InlineEditable field="headline" label="Headline" value={text}>
      <h2 style={{
        fontFamily: `'${tokens.heroFont}', serif`,
        fontWeight: Number(tokens.heroWeight) || 700,
        fontSize: 'clamp(1.5rem,3.2vw,2.4rem)',
        lineHeight: 1.1, letterSpacing: '-0.025em',
        color: tokens.text, margin: 0,
        textAlign: align,
      }}>{text}</h2>
    </InlineEditable>
  );
}

function Body({ text, tokens, maxWidth }: { text: string; tokens: PluginTokens; maxWidth?: number }) {
  return (
    <InlineEditable field="body" label="Body" value={text} multiline>
      <div style={{
        fontFamily: `'${tokens.bodyFont}', sans-serif`,
        fontSize: '0.9rem', lineHeight: 1.85,
        color: tokens.textMuted,
        maxWidth: maxWidth ? `${maxWidth}px` : undefined,
      }}>
        {text.split('\n\n').filter(Boolean).map((p, i) => (
          <p key={i} style={{ margin: i === 0 ? 0 : '0.9em 0 0' }}>{p}</p>
        ))}
      </div>
    </InlineEditable>
  );
}

// ── Variant A: Bento — asymmetric grid, large first card + grid ───────────────
function VariantBento({ content, tokens, listItems }: { content: GenericContent; tokens: PluginTokens; listItems: Item[] }) {
  const cols = listItems.length <= 2 ? 1 : listItems.length <= 4 ? 2 : 3;
  return (
    <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
      {/* Header row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'clamp(2rem,5vw,5rem)', alignItems: 'end', marginBottom: 'clamp(2.5rem,5vw,4rem)' }}>
        <div>
          <Reveal><Eyebrow text={content.eyebrow || 'Overview'} tokens={tokens} /></Reveal>
          <Reveal delay={60}><Headline text={content.headline ?? ''} tokens={tokens} /></Reveal>
        </div>
        {content.body && (
          <Reveal delay={100}>
            <div style={{ borderLeft: `2px solid ${tokens.accent}30`, paddingLeft: '1.5rem' }}>
              <Body text={content.body} tokens={tokens} />
            </div>
          </Reveal>
        )}
      </div>

      {/* Card grid */}
      {listItems.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 'clamp(0.75rem,1.5vw,1.25rem)', alignItems: 'stretch' }}>
          {listItems.map((item, i) => {
            const isAccent = i === 0;
            return (
              <Reveal key={i} delay={120 + i * 50} style={{ height: '100%' }}>
                <div style={{
                  position: 'relative', overflow: 'hidden',
                  padding: 'clamp(1.5rem,2.5vw,2rem)',
                  borderRadius: tokens.borderRadius ?? '16px',
                  background: isAccent
                    ? `linear-gradient(135deg, ${tokens.accent}, ${tokens.accent}cc)`
                    : tokens.surfaceCard,
                  border: `1px solid ${isAccent ? 'transparent' : tokens.border}`,
                  boxShadow: isAccent ? `0 12px 40px ${tokens.accent}35` : tokens.cardShadow,
                  height: '100%', boxSizing: 'border-box',
                }}>
                  {isAccent && (
                    <div style={{ position: 'absolute', bottom: -20, right: -20, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', pointerEvents: 'none' }} />
                  )}
                  <div style={{
                    fontFamily: `'${tokens.heroFont}', serif`,
                    fontSize: '2.5rem', fontWeight: 900, lineHeight: 1,
                    color: isAccent ? 'rgba(255,255,255,0.15)' : `${tokens.accent}18`,
                    marginBottom: '0.75rem', userSelect: 'none',
                  }}>{String(i + 1).padStart(2, '0')}</div>
                  <h3 style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 700, fontSize: 'clamp(0.9rem,1.4vw,1rem)',
                    color: isAccent ? '#fff' : tokens.text,
                    margin: '0 0 0.6rem', lineHeight: 1.3,
                  }}>{item.title}</h3>
                  {item.subtitle && (
                    <p style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.83rem', lineHeight: 1.7, margin: 0,
                      color: isAccent ? 'rgba(255,255,255,0.78)' : tokens.textMuted,
                    }}>{item.subtitle}</p>
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Variant B: Editorial rows — numbered full-width items with dividers ────────
function VariantEditorial({ content, tokens, listItems }: { content: GenericContent; tokens: PluginTokens; listItems: Item[] }) {
  return (
    <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
      {/* Hero header — large and centered */}
      <div style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto', marginBottom: 'clamp(3rem,6vw,5rem)' }}>
        <Reveal><Eyebrow text={content.eyebrow || 'Key Points'} tokens={tokens} /></Reveal>
        <Reveal delay={60}><Headline text={content.headline ?? ''} tokens={tokens} align="center" /></Reveal>
        {content.body && (
          <Reveal delay={100}>
            <div style={{ marginTop: '1.25rem' }}><Body text={content.body} tokens={tokens} /></div>
          </Reveal>
        )}
      </div>

      {/* Editorial list rows */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {listItems.map((item, i) => (
          <Reveal key={i} delay={140 + i * 55}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '64px 1fr 1.6fr',
              gap: 'clamp(1rem,3vw,2.5rem)',
              alignItems: 'start',
              padding: 'clamp(1.25rem,2.5vw,2rem) 0',
              borderTop: `1px solid ${tokens.border}`,
            }}>
              {/* Number */}
              <div style={{
                fontFamily: `'${tokens.heroFont}', serif`,
                fontSize: 'clamp(1.8rem,3vw,2.5rem)', fontWeight: 900, lineHeight: 1,
                color: tokens.accent, paddingTop: 2,
              }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              {/* Title */}
              <h3 style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontWeight: 700, fontSize: 'clamp(0.95rem,1.5vw,1.1rem)',
                color: tokens.text, margin: 0, lineHeight: 1.35, paddingTop: '0.2rem',
              }}>{item.title}</h3>
              {/* Subtitle */}
              {item.subtitle && (
                <p style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.875rem', color: tokens.textMuted,
                  margin: 0, lineHeight: 1.75,
                }}>{item.subtitle}</p>
              )}
            </div>
          </Reveal>
        ))}
        {/* Bottom border */}
        <div style={{ borderTop: `1px solid ${tokens.border}` }} />
      </div>
    </div>
  );
}

// ── Variant C: Icon cards — 3-col grid, accent top stripe, clean cards ────────
function VariantIconCards({ content, tokens, listItems }: { content: GenericContent; tokens: PluginTokens; listItems: Item[] }) {
  const cols = Math.min(listItems.length, 3);
  return (
    <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 'clamp(2.5rem,5vw,4rem)', maxWidth: 600 }}>
        <Reveal><Eyebrow text={content.eyebrow || 'Highlights'} tokens={tokens} /></Reveal>
        <Reveal delay={60}><Headline text={content.headline ?? ''} tokens={tokens} /></Reveal>
        {content.body && (
          <Reveal delay={100}>
            <div style={{ marginTop: '1rem' }}><Body text={content.body} tokens={tokens} maxWidth={520} /></div>
          </Reveal>
        )}
      </div>

      {/* 3-col cards */}
      {listItems.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 'clamp(1rem,2vw,1.5rem)', alignItems: 'stretch' }}>
          {listItems.map((item, i) => (
            <Reveal key={i} delay={120 + i * 45} style={{ height: '100%' }}>
              <div style={{
                position: 'relative', overflow: 'hidden',
                borderRadius: tokens.borderRadius ?? '14px',
                background: tokens.surfaceCard,
                border: `1px solid ${tokens.border}`,
                boxShadow: tokens.cardShadow,
                height: '100%', boxSizing: 'border-box',
                display: 'flex', flexDirection: 'column',
              }}>
                {/* Accent top stripe */}
                <div style={{ height: 3, background: `linear-gradient(90deg, ${tokens.accent}, ${tokens.accent}44)`, flexShrink: 0 }} />
                <div style={{ padding: 'clamp(1.5rem,2.5vw,2rem)', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  {/* Number badge */}
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 36, height: 36, borderRadius: 10,
                    background: `${tokens.accent}12`, marginBottom: '1rem', flexShrink: 0,
                  }}>
                    <span style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.75rem', fontWeight: 800, color: tokens.accent,
                    }}>{String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <h3 style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 700, fontSize: 'clamp(0.9rem,1.4vw,1rem)',
                    color: tokens.text, margin: '0 0 0.65rem', lineHeight: 1.35,
                  }}>{item.title}</h3>
                  {item.subtitle && (
                    <p style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.83rem', color: tokens.textMuted,
                      margin: 0, lineHeight: 1.75, flex: 1,
                    }}>{item.subtitle}</p>
                  )}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Variant D: Two-panel — dark accent left + card grid right ─────────────────
function VariantTwoPanel({ content, tokens, listItems }: { content: GenericContent; tokens: PluginTokens; listItems: Item[] }) {
  const cols = listItems.length <= 2 ? 1 : 2;
  return (
    <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 'clamp(2rem,5vw,5rem)', alignItems: 'start' }}>

        {/* Left: accent panel */}
        <Reveal>
          <div style={{
            position: 'relative', overflow: 'hidden',
            borderRadius: tokens.borderRadius ?? '20px',
            background: `linear-gradient(145deg, ${tokens.accent}ee, ${tokens.accent}99)`,
            padding: 'clamp(2rem,4vw,3rem)',
            boxShadow: `0 20px 60px ${tokens.accent}30`,
          }}>
            <div style={{ position: 'absolute', bottom: -40, right: -40, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.07)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: -20, left: -20, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />
            <span style={{
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.2em',
              textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.65)',
              display: 'block', marginBottom: '1rem',
            }}>{content.eyebrow || 'Overview'}</span>
            <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
              <h2 style={{
                fontFamily: `'${tokens.heroFont}', serif`,
                fontWeight: Number(tokens.heroWeight) || 700,
                fontSize: 'clamp(1.4rem,3vw,2.2rem)',
                lineHeight: 1.1, letterSpacing: '-0.02em',
                color: '#fff', margin: '0 0 1.25rem',
              }}>{content.headline}</h2>
            </InlineEditable>
            {content.body && (
              <InlineEditable field="body" label="Body" value={content.body} multiline>
                <p style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.875rem', lineHeight: 1.8,
                  color: 'rgba(255,255,255,0.72)', margin: 0,
                }}>{content.body}</p>
              </InlineEditable>
            )}
            {/* Item count pill */}
            {listItems.length > 0 && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                marginTop: '2rem', padding: '8px 16px',
                borderRadius: 100, background: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.2)',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
                <span style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.75rem', fontWeight: 700, color: '#fff',
                }}>{listItems.length} key point{listItems.length !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        </Reveal>

        {/* Right: card grid */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 'clamp(0.75rem,1.5vw,1rem)', alignItems: 'stretch' }}>
          {listItems.map((item, i) => (
            <Reveal key={i} delay={100 + i * 50} style={{ height: '100%' }}>
              <div style={{
                padding: 'clamp(1.25rem,2vw,1.75rem)',
                borderRadius: tokens.borderRadius ?? '14px',
                background: tokens.surfaceCard,
                border: `1px solid ${tokens.border}`,
                boxShadow: tokens.cardShadow,
                height: '100%', boxSizing: 'border-box',
                display: 'flex', flexDirection: 'column', gap: '0.5rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.25rem' }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                    background: `${tokens.accent}15`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.58rem', fontWeight: 800, color: tokens.accent }}>{String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <div style={{ flex: 1, height: 1, background: `${tokens.accent}18` }} />
                </div>
                <h3 style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontWeight: 700, fontSize: '0.9rem',
                  color: tokens.text, margin: 0, lineHeight: 1.35,
                }}>{item.title}</h3>
                {item.subtitle && (
                  <p style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.8rem', color: tokens.textMuted,
                    margin: 0, lineHeight: 1.7, flex: 1,
                  }}>{item.subtitle}</p>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export function GenericSection({ content, tokens, imageUrl, index, sectionId }: Props) {
  const listItems: Item[] = [
    ...(content.highlights ?? []).map(h => ({ title: h.title, subtitle: h.subtitle })),
    ...(content.items ?? []).map(i => ({ title: i.name, subtitle: i.detail })),
    ...(content.pillars ?? []).map(p => ({ title: p.name, subtitle: p.description })),
  ];

  const bgBase = index % 2 === 0 ? tokens.bg : tokens.surfaceAlt;
  const variant = index % 4;

  return (
    <section
      id={sectionId}
      style={{ position: 'relative', padding: 'clamp(5rem,9vw,8rem) clamp(1.5rem,5vw,3rem)', background: bgBase, overflow: 'hidden' }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${tokens.accent}30,transparent)`, zIndex: 2 }} />

      {listItems.length === 0 ? (
        // No items — text + optional image
        <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
          <Reveal><Eyebrow text={content.eyebrow || 'Overview'} tokens={tokens} /></Reveal>
          <Reveal delay={60}><Headline text={content.headline ?? ''} tokens={tokens} /></Reveal>
          {content.body && (
            <Reveal delay={100}>
              <div style={{ marginTop: '1.25rem' }}><Body text={content.body} tokens={tokens} maxWidth={700} /></div>
            </Reveal>
          )}
          {imageUrl && (
            <Reveal delay={160}>
              <div style={{ marginTop: 'clamp(2rem,4vw,3rem)', borderRadius: tokens.borderRadius ?? '14px', overflow: 'hidden', border: `1px solid ${tokens.border}`, boxShadow: tokens.cardShadow }}>
                <img src={imageUrl} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>
            </Reveal>
          )}
        </div>
      ) : variant === 0 ? (
        <VariantBento content={content} tokens={tokens} listItems={listItems} />
      ) : variant === 1 ? (
        <VariantEditorial content={content} tokens={tokens} listItems={listItems} />
      ) : variant === 2 ? (
        <VariantIconCards content={content} tokens={tokens} listItems={listItems} />
      ) : (
        <VariantTwoPanel content={content} tokens={tokens} listItems={listItems} />
      )}
    </section>
  );
}
