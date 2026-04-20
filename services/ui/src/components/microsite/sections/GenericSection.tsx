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

// ── Shared micro-components ────────────────────────────────────────────────────

function Eyebrow({ text, tokens, light }: { text: string; tokens: PluginTokens; light?: boolean }) {
  return (
    <span style={{
      fontFamily: `'${tokens.bodyFont}', sans-serif`,
      fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.2em',
      textTransform: 'uppercase' as const,
      color: light ? 'rgba(255,255,255,0.65)' : tokens.accent,
      display: 'block', marginBottom: '0.9rem',
    }}>{text}</span>
  );
}

function SectionHeadline({ text, tokens, align = 'left', light }: { text: string; tokens: PluginTokens; align?: 'left' | 'center'; light?: boolean }) {
  return (
    <InlineEditable field="headline" label="Headline" value={text}>
      <h2 style={{
        fontFamily: `'${tokens.heroFont}', serif`,
        fontWeight: Number(tokens.heroWeight) || 700,
        fontSize: 'clamp(1.6rem, 3.2vw, 2.6rem)',
        lineHeight: 1.08, letterSpacing: '-0.03em',
        color: light ? '#fff' : tokens.text,
        margin: 0, textAlign: align,
      }}>{text}</h2>
    </InlineEditable>
  );
}

function SectionBody({ text, tokens, align, light, maxWidth }: { text: string; tokens: PluginTokens; align?: 'center'; light?: boolean; maxWidth?: number }) {
  return (
    <InlineEditable field="body" label="Body" value={text} multiline>
      <div style={{
        fontFamily: `'${tokens.bodyFont}', sans-serif`,
        fontSize: '0.915rem', lineHeight: 1.85,
        color: light ? 'rgba(255,255,255,0.72)' : tokens.textMuted,
        textAlign: align,
        maxWidth: maxWidth ? `${maxWidth}px` : undefined,
      }}>
        {text.split('\n\n').filter(Boolean).map((p, i) => (
          <p key={i} style={{ margin: i === 0 ? 0 : '0.85em 0 0' }}>{p}</p>
        ))}
      </div>
    </InlineEditable>
  );
}

// ── Variant A: Bento grid — asymmetric cards, first one accent ────────────────
function VariantBento({ content, tokens, listItems, imageUrl }: { content: GenericContent; tokens: PluginTokens; listItems: Item[]; imageUrl: string | null }) {
  const cols = listItems.length <= 2 ? 1 : listItems.length <= 4 ? 2 : 3;
  return (
    <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
      {/* Header row: title left + body right with optional image */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: imageUrl && listItems.length === 0 ? '1fr 1fr' : '1fr 1fr',
        gap: 'clamp(2rem, 5vw, 5rem)',
        alignItems: 'end',
        marginBottom: 'clamp(2.5rem, 5vw, 4rem)',
      }}>
        <div>
          <Reveal><Eyebrow text={content.eyebrow || 'Overview'} tokens={tokens} /></Reveal>
          <Reveal delay={60}><SectionHeadline text={content.headline ?? ''} tokens={tokens} /></Reveal>
        </div>
        {content.body && (
          <Reveal delay={100}>
            <div style={{ borderLeft: `2px solid ${tokens.accent}30`, paddingLeft: '1.5rem' }}>
              <SectionBody text={content.body} tokens={tokens} />
            </div>
          </Reveal>
        )}
      </div>

      {/* Image banner when no items */}
      {imageUrl && listItems.length === 0 && (
        <Reveal delay={120}>
          <div style={{ borderRadius: tokens.borderRadius ?? '16px', overflow: 'hidden', border: `1px solid ${tokens.border}`, boxShadow: tokens.cardShadow }}>
            <img src={imageUrl} alt="" style={{ width: '100%', height: 'clamp(220px, 35vw, 420px)', objectFit: 'cover', display: 'block' }} />
          </div>
        </Reveal>
      )}

      {/* Card grid */}
      {listItems.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 'clamp(0.75rem, 1.5vw, 1.25rem)',
          alignItems: 'stretch',
        }}>
          {listItems.map((item, i) => {
            const isAccent = i === 0;
            return (
              <Reveal key={i} delay={120 + i * 50} style={{ height: '100%' }}>
                <div style={{
                  position: 'relative', overflow: 'hidden',
                  padding: 'clamp(1.5rem, 2.5vw, 2rem)',
                  borderRadius: tokens.borderRadius ?? '16px',
                  background: isAccent
                    ? `linear-gradient(135deg, ${tokens.accent}, ${tokens.accent}bb)`
                    : tokens.surfaceCard,
                  border: `1px solid ${isAccent ? 'transparent' : tokens.border}`,
                  boxShadow: isAccent ? `0 16px 48px ${tokens.accent}38` : tokens.cardShadow,
                  height: '100%', boxSizing: 'border-box' as const,
                }}>
                  {isAccent && (
                    <>
                      <div style={{ position: 'absolute', bottom: -24, right: -24, width: 130, height: 130, borderRadius: '50%', background: 'rgba(255,255,255,0.07)', pointerEvents: 'none' }} />
                      <div style={{ position: 'absolute', top: -16, left: -16, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />
                    </>
                  )}
                  <div style={{
                    fontFamily: `'${tokens.heroFont}', serif`,
                    fontSize: '2.8rem', fontWeight: 900, lineHeight: 1,
                    color: isAccent ? 'rgba(255,255,255,0.13)' : `${tokens.accent}16`,
                    marginBottom: '0.75rem', userSelect: 'none' as const,
                  }}>{String(i + 1).padStart(2, '0')}</div>
                  <h3 style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 700, fontSize: 'clamp(0.9rem, 1.4vw, 1.05rem)',
                    color: isAccent ? '#fff' : tokens.text,
                    margin: '0 0 0.6rem', lineHeight: 1.3,
                  }}>{item.title}</h3>
                  {item.subtitle && (
                    <p style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.83rem', lineHeight: 1.75, margin: 0,
                      color: isAccent ? 'rgba(255,255,255,0.75)' : tokens.textMuted,
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

// ── Variant B: Editorial numbered rows — large list, scannable ────────────────
function VariantEditorial({ content, tokens, listItems }: { content: GenericContent; tokens: PluginTokens; listItems: Item[] }) {
  return (
    <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
      {/* Centered header */}
      <div style={{ textAlign: 'center', maxWidth: 740, margin: '0 auto', marginBottom: 'clamp(3rem, 6vw, 5rem)' }}>
        <Reveal><Eyebrow text={content.eyebrow || 'Key Points'} tokens={tokens} /></Reveal>
        <Reveal delay={60}><SectionHeadline text={content.headline ?? ''} tokens={tokens} align="center" /></Reveal>
        {content.body && (
          <Reveal delay={100}>
            <div style={{ marginTop: '1.25rem' }}>
              <SectionBody text={content.body} tokens={tokens} align="center" />
            </div>
          </Reveal>
        )}
      </div>

      {/* Numbered row list */}
      <div style={{ display: 'flex', flexDirection: 'column' as const }}>
        {listItems.map((item, i) => (
          <Reveal key={i} delay={140 + i * 45}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '72px 1fr 1.6fr',
              gap: 'clamp(1rem, 3vw, 2.5rem)',
              alignItems: 'start',
              padding: 'clamp(1.25rem, 2.5vw, 2rem) 0',
              borderTop: `1px solid ${tokens.border}`,
            }}>
              <div style={{
                fontFamily: `'${tokens.heroFont}', serif`,
                fontSize: 'clamp(2rem, 3.2vw, 2.8rem)', fontWeight: 900, lineHeight: 1,
                color: tokens.accent, paddingTop: 2,
              }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <h3 style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontWeight: 700, fontSize: 'clamp(0.95rem, 1.5vw, 1.1rem)',
                color: tokens.text, margin: 0, lineHeight: 1.35, paddingTop: '0.25rem',
              }}>{item.title}</h3>
              {item.subtitle && (
                <p style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.875rem', color: tokens.textMuted,
                  margin: 0, lineHeight: 1.8,
                }}>{item.subtitle}</p>
              )}
            </div>
          </Reveal>
        ))}
        <div style={{ borderTop: `1px solid ${tokens.border}` }} />
      </div>
    </div>
  );
}

// ── Variant C: Icon cards — 3-col grid, accent stripe, clean ─────────────────
function VariantIconCards({ content, tokens, listItems, imageUrl }: { content: GenericContent; tokens: PluginTokens; listItems: Item[]; imageUrl: string | null }) {
  const cols = Math.min(listItems.length <= 2 ? listItems.length : listItems.length <= 4 ? 2 : 3, 3);
  return (
    <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
      {/* Header row with optional image thumbnail */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: imageUrl ? '1fr auto' : '1fr',
        gap: 'clamp(2rem, 4vw, 4rem)',
        alignItems: 'end',
        marginBottom: 'clamp(2.5rem, 5vw, 4rem)',
      }}>
        <div style={{ maxWidth: 600 }}>
          <Reveal><Eyebrow text={content.eyebrow || 'Highlights'} tokens={tokens} /></Reveal>
          <Reveal delay={60}><SectionHeadline text={content.headline ?? ''} tokens={tokens} /></Reveal>
          {content.body && (
            <Reveal delay={100}>
              <div style={{ marginTop: '1rem' }}><SectionBody text={content.body} tokens={tokens} maxWidth={520} /></div>
            </Reveal>
          )}
        </div>
        {imageUrl && (
          <Reveal delay={80}>
            <div style={{
              width: 'clamp(180px, 22vw, 280px)', height: 'clamp(140px, 18vw, 220px)',
              borderRadius: tokens.borderRadius ?? '14px', overflow: 'hidden',
              border: `1px solid ${tokens.border}`, boxShadow: tokens.cardShadow,
              flexShrink: 0,
            }}>
              <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
          </Reveal>
        )}
      </div>

      {listItems.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 'clamp(1rem, 2vw, 1.5rem)',
          alignItems: 'stretch',
        }}>
          {listItems.map((item, i) => (
            <Reveal key={i} delay={120 + i * 45} style={{ height: '100%' }}>
              <div style={{
                position: 'relative', overflow: 'hidden',
                borderRadius: tokens.borderRadius ?? '14px',
                background: tokens.surfaceCard,
                border: `1px solid ${tokens.border}`,
                boxShadow: tokens.cardShadow,
                height: '100%', boxSizing: 'border-box' as const,
                display: 'flex', flexDirection: 'column' as const,
              }}>
                {/* Accent top stripe */}
                <div style={{ height: 3, background: `linear-gradient(90deg, ${tokens.accent}, ${tokens.accent}44)`, flexShrink: 0 }} />
                <div style={{ padding: 'clamp(1.5rem, 2.5vw, 2rem)', flex: 1, display: 'flex', flexDirection: 'column' as const }}>
                  {/* Number badge */}
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 36, height: 36, borderRadius: 10,
                    background: `${tokens.accent}12`, marginBottom: '1rem', flexShrink: 0,
                  }}>
                    <span style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.72rem', fontWeight: 800, color: tokens.accent,
                    }}>{String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <h3 style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 700, fontSize: 'clamp(0.9rem, 1.4vw, 1.02rem)',
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

// ── Variant D: Two-panel — accent panel left, cards right ─────────────────────
function VariantTwoPanel({ content, tokens, listItems }: { content: GenericContent; tokens: PluginTokens; listItems: Item[] }) {
  const cols = listItems.length <= 2 ? 1 : 2;
  return (
    <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 'clamp(2rem, 5vw, 5rem)', alignItems: 'start' }}>
        {/* Left accent panel */}
        <Reveal>
          <div style={{
            position: 'relative', overflow: 'hidden',
            borderRadius: tokens.borderRadius ?? '20px',
            background: `linear-gradient(145deg, ${tokens.accent}f0, ${tokens.accent}99)`,
            padding: 'clamp(2rem, 4vw, 3rem)',
            boxShadow: `0 24px 64px ${tokens.accent}28`,
          }}>
            <div style={{ position: 'absolute', bottom: -44, right: -44, width: 190, height: 190, borderRadius: '50%', background: 'rgba(255,255,255,0.07)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: -22, left: -22, width: 110, height: 110, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />
            <Eyebrow text={content.eyebrow || 'Overview'} tokens={tokens} light />
            <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
              <h2 style={{
                fontFamily: `'${tokens.heroFont}', serif`,
                fontWeight: Number(tokens.heroWeight) || 700,
                fontSize: 'clamp(1.4rem, 3vw, 2.2rem)',
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

        {/* Right card grid */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 'clamp(0.75rem, 1.5vw, 1rem)', alignItems: 'stretch' }}>
          {listItems.map((item, i) => (
            <Reveal key={i} delay={100 + i * 50} style={{ height: '100%' }}>
              <div style={{
                padding: 'clamp(1.25rem, 2vw, 1.75rem)',
                borderRadius: tokens.borderRadius ?? '14px',
                background: tokens.surfaceCard,
                border: `1px solid ${tokens.border}`,
                boxShadow: tokens.cardShadow,
                height: '100%', boxSizing: 'border-box' as const,
                display: 'flex', flexDirection: 'column' as const, gap: '0.5rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.25rem' }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                    background: `${tokens.accent}14`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.6rem', fontWeight: 800, color: tokens.accent }}>{String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <div style={{ flex: 1, height: 1, background: `${tokens.accent}16` }} />
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
                    margin: 0, lineHeight: 1.75, flex: 1,
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

// ── Variant E: Split — image full-height right, text + items left ─────────────
function VariantSplit({ content, tokens, listItems, imageUrl }: { content: GenericContent; tokens: PluginTokens; listItems: Item[]; imageUrl: string | null }) {
  return (
    <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: imageUrl ? '1fr 1fr' : '1fr', gap: 'clamp(2.5rem, 6vw, 6rem)', alignItems: 'center' }}>
        {/* Text + items */}
        <div>
          <Reveal><Eyebrow text={content.eyebrow || 'Overview'} tokens={tokens} /></Reveal>
          <Reveal delay={60}><SectionHeadline text={content.headline ?? ''} tokens={tokens} /></Reveal>
          {content.body && (
            <Reveal delay={120}>
              <div style={{ marginTop: '1.25rem', marginBottom: listItems.length > 0 ? '2rem' : 0 }}>
                <SectionBody text={content.body} tokens={tokens} maxWidth={480} />
              </div>
            </Reveal>
          )}
          {/* Inline item list */}
          {listItems.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '0.85rem' }}>
              {listItems.map((item, i) => (
                <Reveal key={i} delay={160 + i * 45}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0, marginTop: 1,
                      background: `${tokens.accent}14`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.62rem', fontWeight: 800, color: tokens.accent }}>{String(i + 1).padStart(2, '0')}</span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 700, fontSize: '0.9rem', color: tokens.text, lineHeight: 1.3, marginBottom: item.subtitle ? '0.3rem' : 0 }}>{item.title}</div>
                      {item.subtitle && (
                        <div style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.82rem', color: tokens.textMuted, lineHeight: 1.7 }}>{item.subtitle}</div>
                      )}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          )}
        </div>

        {/* Image panel */}
        {imageUrl && (
          <Reveal delay={80}>
            <div style={{
              borderRadius: tokens.borderRadius ?? '20px', overflow: 'hidden',
              border: `1px solid ${tokens.border}`,
              boxShadow: `0 24px 64px rgba(0,0,0,0.18)`,
              position: 'relative',
            }}>
              <img src={imageUrl} alt="" style={{ width: '100%', height: 'clamp(300px, 45vw, 560px)', objectFit: 'cover', display: 'block' }} />
              {/* Subtle gradient overlay at bottom */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '30%', background: `linear-gradient(to top, ${tokens.bg}60, transparent)` }} />
            </div>
          </Reveal>
        )}
      </div>
    </div>
  );
}

// ── Variant F: Timeline steps — horizontal stepper for ≤6 sequential items ────
function VariantTimelineSteps({ content, tokens, listItems }: { content: GenericContent; tokens: PluginTokens; listItems: Item[] }) {
  return (
    <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto', marginBottom: 'clamp(3rem, 6vw, 5rem)' }}>
        <Reveal><Eyebrow text={content.eyebrow || 'Process'} tokens={tokens} /></Reveal>
        <Reveal delay={60}><SectionHeadline text={content.headline ?? ''} tokens={tokens} align="center" /></Reveal>
        {content.body && (
          <Reveal delay={100}>
            <div style={{ marginTop: '1.25rem' }}><SectionBody text={content.body} tokens={tokens} align="center" /></div>
          </Reveal>
        )}
      </div>

      {/* Step cards with connector line */}
      <div style={{ position: 'relative' }}>
        {/* Horizontal connector line */}
        {listItems.length > 1 && (
          <div style={{
            position: 'absolute',
            top: 28,
            left: `calc(${100 / (listItems.length * 2)}% + 0px)`,
            right: `calc(${100 / (listItems.length * 2)}% + 0px)`,
            height: 2,
            background: `linear-gradient(90deg, ${tokens.accent}40, ${tokens.accent}80, ${tokens.accent}40)`,
            zIndex: 0,
          }} />
        )}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(listItems.length, 6)}, 1fr)`,
          gap: 'clamp(0.75rem, 2vw, 1.5rem)',
          position: 'relative', zIndex: 1,
        }}>
          {listItems.map((item, i) => (
            <Reveal key={i} delay={120 + i * 60}>
              <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', textAlign: 'center' as const }}>
                {/* Step circle */}
                <div style={{
                  width: 56, height: 56, borderRadius: '50%',
                  background: i === 0
                    ? tokens.accent
                    : `${tokens.accent}18`,
                  border: `2px solid ${i === 0 ? tokens.accent : tokens.accent + '40'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '1.25rem', flexShrink: 0,
                  boxShadow: i === 0 ? `0 8px 24px ${tokens.accent}38` : undefined,
                }}>
                  <span style={{
                    fontFamily: `'${tokens.heroFont}', serif`,
                    fontSize: '1rem', fontWeight: 900, lineHeight: 1,
                    color: i === 0 ? '#fff' : tokens.accent,
                  }}>{i + 1}</span>
                </div>
                {/* Content */}
                <div style={{
                  padding: 'clamp(1.25rem, 2vw, 1.75rem)',
                  borderRadius: tokens.borderRadius ?? '14px',
                  background: tokens.surfaceCard,
                  border: `1px solid ${tokens.border}`,
                  boxShadow: tokens.cardShadow,
                  width: '100%', boxSizing: 'border-box' as const,
                }}>
                  <h3 style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 700, fontSize: 'clamp(0.85rem, 1.3vw, 0.95rem)',
                    color: tokens.text, margin: '0 0 0.5rem', lineHeight: 1.3,
                  }}>{item.title}</h3>
                  {item.subtitle && (
                    <p style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: '0.78rem', color: tokens.textMuted,
                      margin: 0, lineHeight: 1.7,
                    }}>{item.subtitle}</p>
                  )}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Centered text-only (no items, no image) ───────────────────────────────────
function VariantCentered({ content, tokens }: { content: GenericContent; tokens: PluginTokens }) {
  return (
    <div style={{ position: 'relative', zIndex: 5, maxWidth: 820, margin: '0 auto', textAlign: 'center' as const }}>
      <Reveal><Eyebrow text={content.eyebrow || 'Overview'} tokens={tokens} /></Reveal>
      <Reveal delay={60}><SectionHeadline text={content.headline ?? ''} tokens={tokens} align="center" /></Reveal>
      {content.body && (
        <Reveal delay={100}>
          <div style={{ marginTop: '1.5rem' }}>
            <SectionBody text={content.body} tokens={tokens} align="center" />
          </div>
        </Reveal>
      )}
    </div>
  );
}

// ── Variant selection ─────────────────────────────────────────────────────────

function pickVariant(
  listItems: Item[],
  imageUrl: string | null,
  contentLayout: GenericContent['layout'] | undefined,
  index: number,
): 'bento' | 'editorial' | 'icon-cards' | 'two-panel' | 'split' | 'timeline-steps' | 'centered' {
  // Agent-specified override
  if (contentLayout) return contentLayout;

  const n = listItems.length;

  // No items
  if (n === 0) return imageUrl ? 'split' : 'centered';

  // Sequential process steps (≤6 items, no subtitle or very short subtitle) → stepper
  const hasShortSubtitles = listItems.every(item => !item.subtitle || item.subtitle.length < 80);
  if (n <= 6 && hasShortSubtitles && n >= 3) {
    // Use stepper for process/objective-style sections on alternating indices
    if (index % 3 === 2) return 'timeline-steps';
  }

  // Small item count — bento or split
  if (n <= 3) return imageUrl && index % 2 === 1 ? 'split' : 'bento';

  // Medium count — variety
  if (n <= 6) {
    const choice = index % 3;
    if (choice === 0) return 'icon-cards';
    if (choice === 1) return 'two-panel';
    return 'bento';
  }

  // Large count (7+) — editorial rows
  return 'editorial';
}

// ── Main export ───────────────────────────────────────────────────────────────
export function GenericSection({ content, tokens, imageUrl, index, sectionId }: Props) {
  const listItems: Item[] = [
    ...(content.highlights ?? []).map(h => ({ title: h.title, subtitle: h.subtitle })),
    ...(content.items ?? []).map(i => ({ title: i.name, subtitle: i.detail })),
    ...(content.pillars ?? []).map(p => ({ title: p.name, subtitle: p.description })),
  ];

  const bgBase = index % 2 === 0 ? tokens.bg : tokens.surfaceAlt;
  const variant = pickVariant(listItems, imageUrl, content.layout, index);

  return (
    <section
      id={sectionId}
      style={{
        position: 'relative',
        padding: 'clamp(5rem, 9vw, 8rem) clamp(1.5rem, 5vw, 3rem)',
        background: bgBase,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />
      {/* Subtle top accent line */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${tokens.accent}28, transparent)`, zIndex: 2 }} />

      {variant === 'centered' && <VariantCentered content={content} tokens={tokens} />}
      {variant === 'split' && <VariantSplit content={content} tokens={tokens} listItems={listItems} imageUrl={imageUrl} />}
      {variant === 'bento' && <VariantBento content={content} tokens={tokens} listItems={listItems} imageUrl={imageUrl} />}
      {variant === 'editorial' && <VariantEditorial content={content} tokens={tokens} listItems={listItems} />}
      {variant === 'icon-cards' && <VariantIconCards content={content} tokens={tokens} listItems={listItems} imageUrl={imageUrl} />}
      {variant === 'two-panel' && <VariantTwoPanel content={content} tokens={tokens} listItems={listItems} />}
      {variant === 'timeline-steps' && <VariantTimelineSteps content={content} tokens={tokens} listItems={listItems} />}
    </section>
  );
}
