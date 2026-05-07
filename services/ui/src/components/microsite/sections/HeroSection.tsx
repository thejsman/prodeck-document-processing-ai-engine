'use client';

import { useEffect, useRef, useState, useContext, useCallback } from 'react';
import { Check } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import type { PluginTokens, HeroContent, BrandConfig, LayoutSection } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { Display, Body, Label } from '../shared/Typography';
import { CTAButton } from '../shared/CTAButton';
import { InlineEditable } from '../editor/InlineEditable';
import { parseMarkup } from '../editor/Editable';
import { useEditContext } from '../editor/EditContext';
import { useSectionId } from '../editor/SectionIdContext';
import { TypewriterStateContext } from '../TypewriterSection';
import { TypingCursor } from '../TypingCursor';

interface HeroUI {
  showCTA?: boolean;
  layout?: string;
  mediaPosition?: string;
}

interface HeroBehavior {
  hasParallax?: boolean;
  animation?: string;
}

interface ImageOverlay {
  type: 'gradient' | 'duotone' | 'vignette' | 'tint';
  color?: string;
  opacity?: number;
}

interface Props {
  content: HeroContent;
  tokens: PluginTokens;
  brand: BrandConfig;
  imageUrl: string | null;
  index: number;
  sections?: LayoutSection[];
  brief?: { keyOutcomes?: string[] };
  variant?: string;
  ui?: HeroUI;
  behavior?: HeroBehavior;
  /** Optional image overlay effect (from ast.sections[].imageOverlay) */
  imageOverlay?: ImageOverlay;
  /** Section id — provided by MicrositeEditor to enable element-level click-to-edit */
  sectionId?: string;
  /** Proposal metadata for the bottom metadata bar (Prepared For / Prepared By / Date) */
  meta?: { client?: string; author?: string; date?: string };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveRevealVariant(animation: string | undefined): 'blurUp' | 'fadeUp' | 'fadeIn' | 'scale' | 'slideLeft' {
  if (animation === 'scale') return 'scale';
  if (animation === 'none') return 'fadeIn';
  if (animation === 'fadeUp') return 'fadeUp';
  return 'blurUp';
}

// ── Main component ────────────────────────────────────────────────────────────

function buildOverlayBackground(overlay: ImageOverlay | undefined): string {
  if (!overlay) return 'transparent';
  const color = overlay.color ?? '#000000';
  const opacity = overlay.opacity ?? 0.35;
  switch (overlay.type) {
    case 'vignette':
      return `radial-gradient(ellipse at center, transparent 30%, ${color}${Math.round(opacity * 255)
        .toString(16)
        .padStart(2, '0')} 100%)`;
    case 'duotone':
      return `linear-gradient(135deg, ${color}${Math.round(opacity * 255)
        .toString(16)
        .padStart(2, '0')} 0%, ${color}${Math.round(opacity * 0.5 * 255)
        .toString(16)
        .padStart(2, '0')} 100%)`;
    case 'tint':
      return `${color}${Math.round(opacity * 255)
        .toString(16)
        .padStart(2, '0')}`;
    default: // gradient
      return `linear-gradient(180deg, transparent 0%, ${color}${Math.round(opacity * 255)
        .toString(16)
        .padStart(2, '0')} 100%)`;
  }
}

export function HeroSection({
  content,
  tokens,
  imageUrl,
  sections = [],
  brief,
  variant,
  ui,
  behavior,
  imageOverlay,
  meta,
}: Props) {
  // Typewriter context — present only during active streaming animation
  const twCtx = useContext(TypewriterStateContext);
  const editCtx = useEditContext();
  const sectionId = useSectionId();

  // Track image URL with error fallback — DALL-E URLs expire after 2h, drop them gracefully
  const [activeImageUrl, setActiveImageUrl] = useState<string | null>(imageUrl);
  useEffect(() => {
    setActiveImageUrl(imageUrl);
  }, [imageUrl]);

  // Hoist hasBgImage early — used to suppress gradient text when an image fills the background
  // (URL-extracted tokens.text is more readable on image+scrim than a color gradient)
  const hasBgImage = !!activeImageUrl;

  const resolvedVariant = variant ?? 'centered';
  const showCTA = ui?.showCTA !== false && !!(content.ctaPrimary?.trim() || content.ctaSecondary?.trim());
  const mediaPos = ui?.mediaPosition ?? 'right';
  const animation = behavior?.animation;
  // During typewriter animation, disable Reveal to prevent its IntersectionObserver
  // from resetting visible state on every character update (causing flicker).
  const noAnimation = animation === 'none' || !!twCtx?.showCursor;
  const revealVariant = resolveRevealVariant(animation);

  const pillRadius = tokens.buttonStyle === 'sharp' ? 4 : tokens.buttonStyle === 'pill' ? 100 : 50;
  const cardRadius = parseInt(tokens.borderRadius ?? '8') || 8;

  // Parallax ref
  const parallaxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!behavior?.hasParallax || !parallaxRef.current) return;
    const el = parallaxRef.current;
    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      el.style.transform = `translateY(${rect.top * 0.08}px)`;
    };
    const container = document.getElementById('ms-fullscreen-scroll') ?? window;
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [behavior?.hasParallax]);

  // CTA targets
  const nonHero = sections.filter((s) => s.sectionType !== 'hero');
  const findSection = (hint: string | undefined) =>
    hint ? sections.find((s) => s.sectionType === hint || s.id === hint) : undefined;
  const primaryTarget = (
    findSection(content.ctaTarget) ??
    sections.find((s) => s.sectionType === 'pricing') ??
    sections.find((s) => s.sectionType === 'approach') ??
    nonHero[0]
  )?.id;
  const secondaryTarget = (
    findSection(content.ctaSecondaryTarget) ??
    sections.find((s) => s.sectionType === 'nextsteps') ??
    nonHero[nonHero.length - 1]
  )?.id;

  const outcomes = brief?.keyOutcomes ?? [];

  // Reveal wrapper — useCallback keeps the reference stable across re-renders
  // so React doesn't unmount/remount InlineEditable children when context updates.
  const R = useCallback(
    function R({
      children,
      delay = 0,
      style,
    }: {
      children: React.ReactNode;
      delay?: number;
      style?: React.CSSProperties;
    }) {
      if (noAnimation) return <div style={style}>{children}</div>;
      return (
        <Reveal delay={delay} variant={revealVariant} style={style}>
          {children}
        </Reveal>
      );
    },
    [noAnimation, revealVariant],
  );

  // When image is present, always use white text for contrast — ignore theme text color
  const heroText = hasBgImage ? '#ffffff' : tokens.text;
  const heroTextMuted = hasBgImage ? 'rgba(255,255,255,0.78)' : tokens.textMuted;
  const heroTextSubtle = hasBgImage ? 'rgba(255,255,255,0.55)' : tokens.textSubtle;

  // ── Shared blocks ─────────────────────────────────────────────────────────

  const eyebrow = content.eyebrow?.trim() && (
    <R>
      <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow}>
        <Label
          tokens={tokens}
          style={{ display: 'block', marginBottom: 14, ...(hasBgImage ? { color: heroTextSubtle } : {}) }}
        >
          {content.eyebrow}
          <TypingCursor visible={twCtx?.activeField === 'eyebrow' && (twCtx?.showCursor ?? false)} />
        </Label>
      </InlineEditable>
    </R>
  );

  // When the hero has a background image, suppress gradient text so the URL-extracted
  // tokens.text color (e.g. #f6f3f0 from jackwatkins.co) is used instead of the
  // plugin default or brand-setup gradient.
  const headline = (
    <R delay={60}>
      <InlineEditable field="headline" label="Headline" value={content.headline}>
        <Display
          tokens={tokens}
          gradient={!hasBgImage}
          style={{ marginBottom: 18, ...(hasBgImage ? { color: heroText } : {}) }}
        >
          {content.headline}
          <TypingCursor visible={twCtx?.activeField === 'headline' && (twCtx?.showCursor ?? false)} />
        </Display>
      </InlineEditable>
    </R>
  );

  const subBody = (
    <>
      {content.subheadline?.trim() && (
        <R delay={120}>
          <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline} multiline>
            <Body
              tokens={tokens}
              style={{
                fontSize: '0.95rem',
                maxWidth: 560,
                marginBottom: 10,
                lineHeight: 1.7,
                ...(hasBgImage ? { color: heroTextMuted } : {}),
              }}
            >
              {content.subheadline}
              <TypingCursor visible={twCtx?.activeField === 'subheadline' && (twCtx?.showCursor ?? false)} />
            </Body>
          </InlineEditable>
        </R>
      )}
      {content.body?.trim() && (
        <R delay={180}>
          <InlineEditable field="body" label="Body" value={content.body} multiline>
            <Body
              tokens={tokens}
              style={{ maxWidth: 520, marginBottom: 28, ...(hasBgImage ? { color: heroTextMuted } : {}) }}
            >
              {content.body}
              <TypingCursor visible={twCtx?.activeField === 'body' && (twCtx?.showCursor ?? false)} />
            </Body>
          </InlineEditable>
        </R>
      )}
    </>
  );

  const outcomePills = outcomes.length > 0 && (
    <R delay={220} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
      {outcomes.map((o, i) => (
        <span
          key={i}
          style={{
            padding: '4px 12px',
            borderRadius: pillRadius,
            background: hasBgImage ? 'rgba(255,255,255,0.12)' : tokens.surfaceCard,
            border: `1px solid ${hasBgImage ? 'rgba(255,255,255,0.25)' : tokens.border}`,
            fontFamily: `'${tokens.bodyFont}', sans-serif`,
            fontSize: '0.75rem',
            fontWeight: 500,
            color: hasBgImage ? heroTextMuted : tokens.textMuted,
          }}
        >
          <Icon icon={Check} size="xs" /> {o}
        </span>
      ))}
    </R>
  );

  const ctaRow = showCTA && (
    <R delay={280} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      {content.ctaPrimary?.trim() && (
        <InlineEditable field="ctaPrimary" label="Primary CTA" display="inline-block" value={content.ctaPrimary}>
          <CTAButton tokens={tokens} targetSectionId={primaryTarget}>
            {content.ctaPrimary}
          </CTAButton>
        </InlineEditable>
      )}
      {content.ctaSecondary?.trim() && (
        <InlineEditable field="ctaSecondary" label="Secondary CTA" display="inline-block" value={content.ctaSecondary}>
          <CTAButton tokens={tokens} variant="secondary" targetSectionId={secondaryTarget} showArrow={false} onDarkBg={hasBgImage}>
            {content.ctaSecondary}
          </CTAButton>
        </InlineEditable>
      )}
    </R>
  );

  // Metadata bar — Prepared For / Prepared By / Date
  const metaItems = [
    meta?.client ? { label: 'Prepared For', value: meta.client } : null,
    meta?.author ? { label: 'Prepared By', value: meta.author } : null,
    meta?.date   ? { label: 'Date',         value: meta.date   } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const metadataBar = metaItems.length > 0 && (
    <div
      style={{
        borderTop: `1px solid ${hasBgImage ? 'rgba(255,255,255,0.15)' : tokens.border}`,
        paddingTop: 20,
        marginTop: 32,
        display: 'flex',
        gap: 'clamp(1.5rem, 4vw, 3rem)',
        flexWrap: 'wrap',
      }}
    >
      {metaItems.map(({ label, value }) => (
        <div key={label}>
          <div
            style={{
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: '0.6rem',
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase' as const,
              color: hasBgImage ? heroTextSubtle : tokens.textSubtle,
              marginBottom: 4,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: '0.875rem',
              fontWeight: 500,
              color: hasBgImage ? 'rgba(255,255,255,0.88)' : tokens.text,
            }}
          >
            {value}
          </div>
        </div>
      ))}
    </div>
  );

  // Glassmorphic side card — used by split/asymmetric when bg image is present
  const glassCard = (
    <Reveal delay={100} variant="fadeIn">
      <div
        ref={parallaxRef}
        style={{
          borderRadius: cardRadius,
          padding: 'clamp(1.5rem, 3vw, 2.5rem)',
          background: tokens.dark ? 'rgba(0,0,0,0.40)' : 'rgba(255,255,255,0.35)',
          backdropFilter: 'blur(18px)',
          border: `1px solid ${tokens.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)'}`,
          boxShadow: `0 8px 40px rgba(0,0,0,0.25)`,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {outcomes.length > 0 ? (
          <>
            <div
              style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.65rem',
                fontWeight: 600,
                letterSpacing: tokens.labelTracking,
                textTransform: 'uppercase',
                color: tokens.dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)',
                marginBottom: 4,
              }}
            >
              Key Outcomes
            </div>
            {outcomes.map((o, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.85rem',
                  lineHeight: 1.4,
                  color: tokens.dark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.82)',
                  letterSpacing: '0.01em',
                }}
              >
                <Icon icon={Check} size="sm" style={{ color: tokens.accent, flexShrink: 0, marginTop: 2 }} />
                <InlineEditable
                  field={`__brief.keyOutcomes.${i}`}
                  label={`Outcome ${i + 1}`}
                  value={o}
                  display="inline"
                >
                  <span>{parseMarkup(o)}</span>
                </InlineEditable>
              </div>
            ))}
            {editCtx && sectionId && (
              <button
                onClick={() => {
                  editCtx.updateField(
                    sectionId,
                    `__brief.keyOutcomes.${outcomes.length}`,
                    'New outcome',
                  );
                }}
                style={{
                  marginTop: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'none',
                  border: `1px dashed ${tokens.dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)'}`,
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: '0.75rem',
                  color: tokens.dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)',
                  cursor: 'pointer',
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  width: '100%',
                }}
              >
                + Add outcome
              </button>
            )}
          </>
        ) : (
          <div
            style={{
              aspectRatio: '4/3',
              borderRadius: cardRadius,
              background: tokens.gradientHero || `${tokens.accent}22`,
              border: `1px solid ${tokens.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
            }}
          />
        )}
      </div>
    </Reveal>
  );

  // ── Shared section shell ──────────────────────────────────────────────────

  // bgScrim — always a strong dark overlay so white text is readable over ANY image
  // regardless of the theme's color scheme (custom prompts may produce light tokens.text)
  const bgScrim = 'rgba(5,8,20,0.68)';

  const sectionStyle: React.CSSProperties = {
    position: 'relative',
    padding: 'clamp(4rem, 8vw, 7rem) 2rem',
    // No gradient on the hero background — solid fill only.
    // The gradient moves to the heading text instead (Display gradient={!hasBgImage}).
    background: hasBgImage ? `url(${activeImageUrl}) center center / cover no-repeat` : tokens.bg,
    overflow: 'hidden',
  };

  const container: React.CSSProperties = {
    position: 'relative',
    zIndex: 5,
    maxWidth: 960,
    margin: '0 auto',
  };

  // Hidden probe image — fires onError when the URL is expired or broken (e.g. DALL-E SAS token),
  // clearing the broken background across ALL variants, not just centered.
  const imageProbeFallback = activeImageUrl ? (
    <img src={activeImageUrl} onError={() => setActiveImageUrl(null)} style={{ display: 'none' }} aria-hidden alt="" />
  ) : null;

  // ════════════════════════════════════════════════════════════════════════════
  // SPLIT — text left, image right (or reversed by mediaPos)
  // ════════════════════════════════════════════════════════════════════════════
  if (resolvedVariant === 'split') {
    const imgLeft = mediaPos === 'left';
    return (
      <section style={sectionStyle}>
        {imageProbeFallback}
        {hasBgImage && <div style={{ position: 'absolute', inset: 0, background: bgScrim, zIndex: 1 }} />}
        {hasBgImage && imageOverlay && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: buildOverlayBackground(imageOverlay),
              zIndex: 2,
              pointerEvents: 'none',
            }}
          />
        )}
        <NoiseOverlay opacity={tokens.noiseOpacity} />
        <div style={container}>
          <div
            className="ms-split"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'clamp(2.5rem, 5vw, 4rem)',
              alignItems: 'center',
            }}
          >
            <div style={{ order: imgLeft ? 2 : 1 }}>
              {eyebrow}
              {headline}
              {subBody}
              {ctaRow}
              {metadataBar}
            </div>
            <div style={{ order: imgLeft ? 1 : 2 }}>{glassCard}</div>
          </div>
        </div>
      </section>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ASYMMETRIC — wider text (3fr), narrower image (2fr)
  // ════════════════════════════════════════════════════════════════════════════
  if (resolvedVariant === 'asymmetric') {
    return (
      <section style={sectionStyle}>
        {imageProbeFallback}
        {hasBgImage && <div style={{ position: 'absolute', inset: 0, background: bgScrim, zIndex: 1 }} />}
        {hasBgImage && imageOverlay && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: buildOverlayBackground(imageOverlay),
              zIndex: 2,
              pointerEvents: 'none',
            }}
          />
        )}
        <NoiseOverlay opacity={tokens.noiseOpacity} />
        {/* Left accent bar matching other sections */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: '15%',
            bottom: '15%',
            width: 3,
            background: `linear-gradient(to bottom, transparent, ${tokens.accent}, transparent)`,
            zIndex: 4,
          }}
        />
        <div style={container}>
          <div
            className="ms-split"
            style={{
              display: 'grid',
              gridTemplateColumns: '3fr 2fr',
              gap: 'clamp(2.5rem, 5vw, 4rem)',
              alignItems: 'center',
            }}
          >
            <div>
              {/* Short tick above eyebrow — same as other asymmetric sections */}
              <R>
                <div style={{ width: 32, height: 2, background: tokens.accent, marginBottom: 18 }} />
              </R>
              {eyebrow}
              {headline}
              {subBody}
              {ctaRow}
              {metadataBar}
            </div>
            <div>{glassCard}</div>
          </div>
        </div>
      </section>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EDITORIAL — full-width typography column, no image
  // ════════════════════════════════════════════════════════════════════════════
  if (resolvedVariant === 'editorial') {
    return (
      <section
        style={{
          ...sectionStyle,
          background: hasBgImage ? sectionStyle.background : tokens.bg,
          borderBottom: `1px solid ${tokens.border}`,
        }}
      >
        {imageProbeFallback}
        {hasBgImage && <div style={{ position: 'absolute', inset: 0, background: bgScrim, zIndex: 1 }} />}
        {hasBgImage && imageOverlay && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: buildOverlayBackground(imageOverlay),
              zIndex: 2,
              pointerEvents: 'none',
            }}
          />
        )}
        <NoiseOverlay opacity={Math.min(tokens.noiseOpacity, 0.015)} />
        {/* Top accent rule */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: `linear-gradient(to right, ${tokens.accent}, transparent 60%)`,
          }}
        />
        <div style={{ ...container, maxWidth: 720 }}>
          {/* Eyebrow as plain label — no pill */}
          {content.eyebrow?.trim() && (
            <R>
              <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow}>
                <Label tokens={tokens} style={{ display: 'block', marginBottom: 20 }}>
                  {content.eyebrow}
                </Label>
              </InlineEditable>
            </R>
          )}
          <R delay={60}>
            <InlineEditable field="headline" label="Headline" value={content.headline}>
              <Display
                tokens={tokens}
                gradient
                style={{
                  fontSize: 'clamp(1.5rem, 6cqi, 4rem)',
                  lineHeight: 1.15,
                  marginBottom: 32,
                }}
              >
                {content.headline}
              </Display>
            </InlineEditable>
          </R>
          {content.subheadline?.trim() && (
            <R delay={120}>
              <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline} multiline>
                <Body tokens={tokens} style={{ fontSize: '0.95rem', maxWidth: 540, lineHeight: 1.8, marginBottom: 12 }}>
                  {content.subheadline}
                </Body>
              </InlineEditable>
            </R>
          )}
          {content.body?.trim() && (
            <R delay={180}>
              <InlineEditable field="body" label="Body" value={content.body} multiline>
                <Body
                  tokens={tokens}
                  style={{
                    maxWidth: 520,
                    lineHeight: 2,
                    marginBottom: outcomePills ? 24 : showCTA ? 36 : 0,
                    borderLeft: `2px solid ${tokens.border}`,
                    paddingLeft: 18,
                  }}
                >
                  {content.body}
                </Body>
              </InlineEditable>
            </R>
          )}
          {outcomePills}
          {ctaRow}
          {metadataBar}
        </div>
      </section>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CARD-GRID — headline + row of outcome cards
  // ════════════════════════════════════════════════════════════════════════════
  if (resolvedVariant === 'card-grid') {
    const cards: string[] =
      outcomes.length >= 2 ? outcomes : ([content.subheadline, content.body].filter(Boolean).slice(0, 3) as string[]);

    return (
      <section style={sectionStyle}>
        {imageProbeFallback}
        {hasBgImage && <div style={{ position: 'absolute', inset: 0, background: bgScrim, zIndex: 1 }} />}
        {hasBgImage && imageOverlay && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: buildOverlayBackground(imageOverlay),
              zIndex: 2,
              pointerEvents: 'none',
            }}
          />
        )}
        <NoiseOverlay opacity={tokens.noiseOpacity} />
        {/* Dot texture — same as other card-heavy sections */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `radial-gradient(${tokens.border} 1px, transparent 1px)`,
            backgroundSize: '28px 28px',
            opacity: 0.5,
            zIndex: 0,
            pointerEvents: 'none',
          }}
        />
        <div style={{ ...container, textAlign: 'center' }}>
          {eyebrow}
          {headline}
          {content.subheadline?.trim() && (
            <R delay={120}>
              <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline} multiline>
                <Body tokens={tokens} style={{ maxWidth: 540, margin: '0 auto 36px', lineHeight: 1.7 }}>
                  {content.subheadline}
                </Body>
              </InlineEditable>
            </R>
          )}
          {cards.length > 0 && (
            <R delay={180}>
              <div
                className="ms-grid-3"
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${Math.min(cards.length, 3)}, minmax(0, 1fr))`,
                  gap: 'clamp(1rem, 2.5vw, 1.5rem)',
                  marginBottom: 36,
                }}
              >
                {cards.map((card, i) => (
                  <div
                    key={i}
                    style={{
                      padding: 'clamp(1.2rem, 2.5vw, 1.75rem)',
                      borderRadius: cardRadius,
                      background: tokens.surfaceCard,
                      border: `1px solid ${tokens.border}`,
                      boxShadow: tokens.cardShadow,
                      textAlign: 'left',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 2,
                        background: `linear-gradient(to right, ${tokens.accent}, transparent)`,
                      }}
                    />
                    <div
                      style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        letterSpacing: tokens.labelTracking,
                        textTransform: 'uppercase',
                        color: tokens.accent,
                        marginBottom: 10,
                      }}
                    >
                      0{i + 1}
                    </div>
                    <Body tokens={tokens} style={{ fontSize: '0.88rem', margin: 0 }}>
                      {card}
                    </Body>
                  </div>
                ))}
              </div>
            </R>
          )}
          <R delay={320} style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {ctaRow}
          </R>
          {metadataBar}
        </div>
        <style>{`@media(max-width:768px){.ms-cg-grid{grid-template-columns:1fr!important}}`}</style>
      </section>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TYPE-FORWARD — headline dominates, minimal body, no image
  // ════════════════════════════════════════════════════════════════════════════
  if (resolvedVariant === 'type-forward') {
    return (
      <section style={{ ...sectionStyle, background: hasBgImage ? sectionStyle.background : tokens.bg }}>
        {imageProbeFallback}
        {hasBgImage && <div style={{ position: 'absolute', inset: 0, background: bgScrim, zIndex: 1 }} />}
        {hasBgImage && imageOverlay && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: buildOverlayBackground(imageOverlay),
              zIndex: 2,
              pointerEvents: 'none',
            }}
          />
        )}
        <NoiseOverlay opacity={tokens.noiseOpacity} />
        <div style={{ ...container, maxWidth: 800 }}>
          {eyebrow}
          <R delay={60}>
            <InlineEditable field="headline" label="Headline" value={content.headline}>
              <Display
                tokens={tokens}
                gradient
                style={{
                  fontSize: 'clamp(1.6rem, 6cqi, 4.5rem)',
                  lineHeight: 1.15,
                  marginBottom: 24,
                }}
              >
                {content.headline}
              </Display>
            </InlineEditable>
          </R>
          {content.subheadline?.trim() && (
            <R delay={120}>
              <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline} multiline>
                <Body
                  tokens={tokens}
                  style={{ fontSize: '0.95rem', maxWidth: 560, lineHeight: 1.75, marginBottom: outcomePills ? 16 : 28 }}
                >
                  {content.subheadline}
                </Body>
              </InlineEditable>
            </R>
          )}
          {outcomePills}
          {ctaRow}
          {metadataBar}
        </div>
      </section>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CENTERED — default hero (cover slide)
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <section style={sectionStyle}>
      {imageProbeFallback}
      {hasBgImage && <div style={{ position: 'absolute', inset: 0, background: bgScrim, zIndex: 1 }} />}
      <NoiseOverlay opacity={tokens.noiseOpacity} />
      <div style={container}>
        {eyebrow}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: 'clamp(2rem, 4vw, 4rem)',
            alignItems: 'center',
          }}
        >
          <div>
            {headline}
            {subBody}
            {outcomePills}
            {ctaRow}
          </div>
        </div>
        {metadataBar}
      </div>
    </section>
  );
}

export {};
