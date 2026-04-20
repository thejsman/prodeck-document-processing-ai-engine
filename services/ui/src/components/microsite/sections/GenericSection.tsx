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

// ── Variant A: Centered header + 2-col numbered card grid ────────────────────
function VariantGrid({ content, tokens, listItems, index }: {
  content: GenericContent; tokens: PluginTokens;
  listItems: Array<{ title: string; subtitle?: string }>; index: number;
}) {
  return (
    <>
      {/* Background watermark */}
      <div style={{
        position: 'absolute', bottom: '-2%', right: '2%',
        fontFamily: `'${tokens.heroFont}', serif`,
        fontSize: 'clamp(8rem, 18vw, 16rem)', fontWeight: 900,
        color: `${tokens.accent}06`, lineHeight: 1,
        pointerEvents: 'none', userSelect: 'none', zIndex: 1,
      }}>
        {String(index + 1).padStart(2, '0')}
      </div>
      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
        {/* Centered header */}
        <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center', marginBottom: listItems.length ? 'clamp(2.5rem,5vw,4rem)' : 0 }}>
          <Reveal>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: tokens.accent, marginBottom: '0.9rem' }}>
              <span style={{ width: 20, height: 1, background: tokens.accent, display: 'inline-block' }} />
              {content.eyebrow || 'Overview'}
              <span style={{ width: 20, height: 1, background: tokens.accent, display: 'inline-block' }} />
            </span>
          </Reveal>
          <Reveal delay={60}>
            <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
              <h2 style={{ fontFamily: `'${tokens.heroFont}', serif`, fontWeight: Number(tokens.heroWeight) || 700, fontSize: 'clamp(1.4rem,3.2vw,2.2rem)', lineHeight: 1.12, letterSpacing: '-0.02em', color: tokens.text, margin: '0 0 1.5rem' }}>
                {content.headline}
              </h2>
            </InlineEditable>
          </Reveal>
          {content.body && (
            <Reveal delay={100}>
              <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
                <div style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.9rem', lineHeight: 1.85, color: tokens.textMuted }}>
                  {(content.body ?? '').split('\n\n').filter(Boolean).map((p, i) => <p key={i} style={{ margin: i === 0 ? 0 : '1em 0 0' }}>{p}</p>)}
                </div>
              </InlineEditable>
            </Reveal>
          )}
        </div>
        {/* 2-col card grid */}
        {listItems.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: listItems.length === 1 ? '1fr' : 'repeat(2,1fr)', gap: 'clamp(0.75rem,2vw,1.25rem)', alignItems: 'stretch' }}>
            {listItems.map((item, i) => (
              <Reveal key={i} delay={150 + i * 60} style={{ height: '100%' }}>
                <div style={{ position: 'relative', padding: 'clamp(1.5rem,3vw,2rem)', borderRadius: tokens.borderRadius ?? '14px', background: i % 2 === 0 ? `linear-gradient(135deg,${tokens.accent}0d,${tokens.surfaceCard})` : tokens.surfaceCard, border: `1px solid ${i % 2 === 0 ? tokens.accent + '22' : tokens.border}`, boxShadow: i % 2 === 0 ? `0 4px 24px ${tokens.accent}0a` : tokens.cardShadow, overflow: 'hidden', height: '100%', boxSizing: 'border-box' }}>
                  {i % 2 === 0 && <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: `radial-gradient(circle at top right,${tokens.accent}14,transparent 70%)`, pointerEvents: 'none' }} />}
                  <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%', background: `${tokens.accent}15`, border: `1px solid ${tokens.accent}30`, marginBottom: '0.85rem' }}>
                    <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.6rem', fontWeight: 800, color: tokens.accent }}>{String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <h3 style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 700, fontSize: 'clamp(0.85rem,1.4vw,0.95rem)', color: tokens.text, margin: '0 0 0.6rem', lineHeight: 1.35 }}>{item.title}</h3>
                  {item.subtitle && <p style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.82rem', color: tokens.textMuted, margin: 0, lineHeight: 1.7 }}>{item.subtitle}</p>}
                </div>
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Variant B: Split — text left, stacked accent cards right ─────────────────
function VariantSplit({ content, tokens, listItems }: {
  content: GenericContent; tokens: PluginTokens;
  listItems: Array<{ title: string; subtitle?: string }>;
}) {
  return (
    <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'clamp(3rem,7vw,7rem)', alignItems: 'flex-start' }}>
        {/* Left: header + body */}
        <div>
          <Reveal>
            <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: tokens.accent, display: 'block', marginBottom: '0.85rem' }}>
              {content.eyebrow || 'Overview'}
            </span>
          </Reveal>
          <Reveal delay={60}>
            <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
              <h2 style={{ fontFamily: `'${tokens.heroFont}', serif`, fontWeight: Number(tokens.heroWeight) || 700, fontSize: 'clamp(1.3rem,3vw,2rem)', lineHeight: 1.12, letterSpacing: '-0.02em', color: tokens.text, margin: '0 0 clamp(1rem,2vw,1.5rem)' }}>
                {content.headline}
              </h2>
            </InlineEditable>
          </Reveal>
          {/* Accent rule */}
          <Reveal delay={90}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 'clamp(1.25rem,2.5vw,2rem)' }}>
              <div style={{ height: 2, width: 40, background: tokens.accent, borderRadius: 2 }} />
              <div style={{ height: 2, width: 18, background: `${tokens.accent}50`, borderRadius: 2 }} />
            </div>
          </Reveal>
          {content.body && (
            <Reveal delay={120}>
              <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
                <div style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.9rem', lineHeight: 1.85, color: tokens.textMuted }}>
                  {(content.body ?? '').split('\n\n').filter(Boolean).map((p, i) => <p key={i} style={{ margin: i === 0 ? 0 : '1em 0 0' }}>{p}</p>)}
                </div>
              </InlineEditable>
            </Reveal>
          )}
        </div>
        {/* Right: stacked left-bar cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {listItems.map((item, i) => (
            <Reveal key={i} delay={160 + i * 55}>
              <div style={{ display: 'flex', gap: 16, padding: '16px 20px', borderRadius: '0 12px 12px 0', borderLeft: `3px solid ${tokens.accent}`, background: `linear-gradient(90deg,${tokens.accent}08,${tokens.surfaceCard})`, boxShadow: `inset 0 0 0 1px ${tokens.border}` }}>
                <div style={{ flexShrink: 0, marginTop: 4, width: 6, height: 6, borderRadius: '50%', background: tokens.accent, boxShadow: `0 0 8px ${tokens.accent}70` }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 700, fontSize: '0.875rem', color: tokens.text, margin: 0, lineHeight: 1.4 }}>{item.title}</p>
                  {item.subtitle && <p style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.8rem', color: tokens.textMuted, margin: '5px 0 0', lineHeight: 1.6 }}>{item.subtitle}</p>}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Variant C: Stepped timeline — horizontal connector with numbered nodes ───
function VariantStepped({ content, tokens, listItems, index }: {
  content: GenericContent; tokens: PluginTokens;
  listItems: Array<{ title: string; subtitle?: string }>; index: number;
}) {
  return (
    <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 'clamp(2.5rem,5vw,4rem)', gap: '2rem', flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 560 }}>
          <Reveal>
            <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: tokens.accent, display: 'block', marginBottom: '0.75rem' }}>
              {content.eyebrow || 'Key Points'}
            </span>
          </Reveal>
          <Reveal delay={60}>
            <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
              <h2 style={{ fontFamily: `'${tokens.heroFont}', serif`, fontWeight: Number(tokens.heroWeight) || 700, fontSize: 'clamp(1.3rem,3vw,2rem)', lineHeight: 1.12, letterSpacing: '-0.02em', color: tokens.text, margin: 0 }}>
                {content.headline}
              </h2>
            </InlineEditable>
          </Reveal>
        </div>
        {content.body && (
          <Reveal delay={100}>
            <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
              <div style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.875rem', lineHeight: 1.8, color: tokens.textMuted, maxWidth: 360 }}>
                {(content.body ?? '').split('\n\n').filter(Boolean).map((p, i) => <p key={i} style={{ margin: i === 0 ? 0 : '0.75em 0 0' }}>{p}</p>)}
              </div>
            </InlineEditable>
          </Reveal>
        )}
      </div>
      {/* Stepped items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {listItems.map((item, i) => (
          <Reveal key={i} delay={160 + i * 65}>
            <div style={{ display: 'flex', gap: 0, position: 'relative' }}>
              {/* Left: number + connector line */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 56 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: `linear-gradient(135deg,${tokens.accent},${tokens.accent}99)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 0 16px ${tokens.accent}35` }}>
                  <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.7rem', fontWeight: 800, color: tokens.bg }}>{String(i + 1).padStart(2, '0')}</span>
                </div>
                {i < listItems.length - 1 && (
                  <div style={{ flex: 1, width: 1, background: `linear-gradient(to bottom,${tokens.accent}50,${tokens.accent}10)`, minHeight: 24 }} />
                )}
              </div>
              {/* Right: content */}
              <div style={{ flex: 1, paddingLeft: 20, paddingBottom: i < listItems.length - 1 ? 'clamp(1.25rem,2.5vw,2rem)' : 0 }}>
                <h3 style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 700, fontSize: 'clamp(0.9rem,1.5vw,1rem)', color: tokens.text, margin: '0.5rem 0 0.5rem', lineHeight: 1.35 }}>{item.title}</h3>
                {item.subtitle && <p style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.84rem', color: tokens.textMuted, margin: 0, lineHeight: 1.7 }}>{item.subtitle}</p>}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

// ── Variant D: Feature spotlight — large first item, rest in row ─────────────
function VariantSpotlight({ content, tokens, listItems }: {
  content: GenericContent; tokens: PluginTokens;
  listItems: Array<{ title: string; subtitle?: string }>;
}) {
  const [featured, ...rest] = listItems;
  return (
    <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ maxWidth: 640, marginBottom: 'clamp(2.5rem,5vw,4rem)' }}>
        <Reveal>
          <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: tokens.accent, display: 'block', marginBottom: '0.75rem' }}>
            {content.eyebrow || 'Highlights'}
          </span>
        </Reveal>
        <Reveal delay={60}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <h2 style={{ fontFamily: `'${tokens.heroFont}', serif`, fontWeight: Number(tokens.heroWeight) || 700, fontSize: 'clamp(1.3rem,3vw,2rem)', lineHeight: 1.12, letterSpacing: '-0.02em', color: tokens.text, margin: '0 0 1rem' }}>
              {content.headline}
            </h2>
          </InlineEditable>
        </Reveal>
        {content.body && (
          <Reveal delay={100}>
            <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
              <div style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.9rem', lineHeight: 1.85, color: tokens.textMuted }}>
                {(content.body ?? '').split('\n\n').filter(Boolean).map((p, i) => <p key={i} style={{ margin: i === 0 ? 0 : '1em 0 0' }}>{p}</p>)}
              </div>
            </InlineEditable>
          </Reveal>
        )}
      </div>
      {/* Featured card */}
      {featured && (
        <Reveal delay={140}>
          <div style={{ position: 'relative', padding: 'clamp(2rem,4vw,3rem)', borderRadius: tokens.borderRadius ?? '16px', background: `linear-gradient(135deg,${tokens.accent}12,${tokens.surfaceCard})`, border: `1px solid ${tokens.accent}28`, boxShadow: `0 8px 40px ${tokens.accent}12`, marginBottom: 'clamp(1rem,2vw,1.5rem)', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, right: 0, width: 200, height: 200, background: `radial-gradient(circle at top right,${tokens.accent}16,transparent 65%)`, pointerEvents: 'none' }} />
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 100, background: `${tokens.accent}14`, border: `1px solid ${tokens.accent}28`, marginBottom: '1rem' }}>
              <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: tokens.accent }}>01</span>
            </div>
            <h3 style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 700, fontSize: 'clamp(1rem,2vw,1.15rem)', color: tokens.text, margin: '0 0 0.75rem', lineHeight: 1.3 }}>{featured.title}</h3>
            {featured.subtitle && <p style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.875rem', color: tokens.textMuted, margin: 0, lineHeight: 1.75, maxWidth: 640 }}>{featured.subtitle}</p>}
          </div>
        </Reveal>
      )}
      {/* Remaining items in a row */}
      {rest.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(rest.length, 3)},1fr)`, gap: 'clamp(0.75rem,1.5vw,1rem)', alignItems: 'stretch' }}>
          {rest.map((item, i) => (
            <Reveal key={i} delay={200 + i * 55} style={{ height: '100%' }}>
              <div style={{ padding: 'clamp(1.25rem,2.5vw,1.75rem)', borderRadius: tokens.borderRadius ?? '12px', background: tokens.surfaceCard, border: `1px solid ${tokens.border}`, boxShadow: tokens.cardShadow, height: '100%', boxSizing: 'border-box' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: '0.75rem' }}>
                  <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.6rem', fontWeight: 800, color: tokens.accent }}>{String(i + 2).padStart(2, '0')}</span>
                  <div style={{ height: 1, width: 16, background: `${tokens.accent}50` }} />
                </div>
                <h3 style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 700, fontSize: '0.875rem', color: tokens.text, margin: '0 0 0.5rem', lineHeight: 1.35 }}>{item.title}</h3>
                {item.subtitle && <p style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.8rem', color: tokens.textMuted, margin: 0, lineHeight: 1.65 }}>{item.subtitle}</p>}
              </div>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main export — picks variant by index so consecutive generics differ ───────
export function GenericSection({ content, tokens, imageUrl, index, sectionId }: Props) {
  const listItems: Array<{ title: string; subtitle?: string }> = [
    ...(content.highlights ?? []).map(h => ({ title: h.title, subtitle: h.subtitle })),
    ...(content.items ?? []).map(i => ({ title: i.name, subtitle: i.detail })),
    ...(content.pillars ?? []).map(p => ({ title: p.name, subtitle: p.description })),
  ];

  const bgBase = index % 2 === 0 ? tokens.bg : tokens.surfaceAlt;
  // Cycle through 4 distinct variants based on index
  const variant = index % 4;

  return (
    <section
      id={sectionId}
      style={{
        position: 'relative',
        padding: 'clamp(5rem,9vw,8rem) 2rem',
        background: bgBase,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${tokens.accent}35,transparent)`, zIndex: 2 }} />

      {/* No items — image fallback shared by all variants */}
      {listItems.length === 0 ? (
        <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
          <Reveal>
            <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: tokens.accent, display: 'block', marginBottom: '0.75rem' }}>
              {content.eyebrow || 'Overview'}
            </span>
          </Reveal>
          <Reveal delay={60}>
            <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
              <h2 style={{ fontFamily: `'${tokens.heroFont}', serif`, fontWeight: Number(tokens.heroWeight) || 700, fontSize: 'clamp(1.4rem,3.2vw,2.2rem)', lineHeight: 1.12, letterSpacing: '-0.02em', color: tokens.text, margin: '0 0 1.5rem' }}>
                {content.headline}
              </h2>
            </InlineEditable>
          </Reveal>
          {content.body && (
            <Reveal delay={100}>
              <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
                <div style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.9rem', lineHeight: 1.85, color: tokens.textMuted, maxWidth: 700 }}>
                  {(content.body ?? '').split('\n\n').filter(Boolean).map((p, i) => <p key={i} style={{ margin: i === 0 ? 0 : '1em 0 0' }}>{p}</p>)}
                </div>
              </InlineEditable>
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
        <VariantGrid content={content} tokens={tokens} listItems={listItems} index={index} />
      ) : variant === 1 ? (
        <VariantSplit content={content} tokens={tokens} listItems={listItems} />
      ) : variant === 2 ? (
        <VariantStepped content={content} tokens={tokens} listItems={listItems} index={index} />
      ) : (
        <VariantSpotlight content={content} tokens={tokens} listItems={listItems} />
      )}
    </section>
  );
}
