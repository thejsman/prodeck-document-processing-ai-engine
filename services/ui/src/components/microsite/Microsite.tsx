'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Pencil, RefreshCw } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { createPortal } from 'react-dom';
import type { LayoutAST, PluginTokens } from '../../types/presentation';
import { getPlugin, resolveTokens } from '../../lib/presentation/pluginRegistry';
import { MicrositeNav } from './MicrositeNav';
import { HeroSection } from './sections/HeroSection';
import { OverviewSection } from './sections/OverviewSection';
import { ChallengeSection } from './sections/ChallengeSection';
import { ApproachSection } from './sections/ApproachSection';
import { DeliverablesSection } from './sections/DeliverablesSection';
import { TimelineSection } from './sections/TimelineSection';
import { PricingSection } from './sections/PricingSection';
import { WhyUsSection } from './sections/WhyUsSection';
import { NextStepsSection } from './sections/NextStepsSection';
import { GenericSection } from './sections/GenericSection';
import { TestimonialsSection } from './sections/TestimonialsSection';
import { ShowcaseSection } from './sections/ShowcaseSection';
import { BenefitsSection } from './sections/BenefitsSection';
import { ProblemSection } from './sections/ProblemSection';
import { StatsSection } from './sections/StatsSection';
import { MetricsSection } from './sections/MetricsSection';
import { SecuritySection } from './sections/SecuritySection';
import { TechStackSection } from './sections/TechStackSection';
import { TestingSection } from './sections/TestingSection';
import { FaqSection } from './sections/FaqSection';
import { TeamSection } from './sections/TeamSection';
import { ComparisonSection } from './sections/ComparisonSection';
import { CaseStudySection } from './sections/CaseStudySection';
import { ApprovalSection } from './sections/ApprovalSection';

import { useEditContext } from './editor/EditContext';
import { SectionEditOverlay } from './editor/SectionEditOverlay';
import { SectionIdProvider } from './editor/SectionIdContext';
import { AddSectionButton } from './editor/AddSectionButton';
import { useAuth } from '../../lib/auth-context';
import { isSectionEmpty } from '../../lib/sectionUtils';
import { TypewriterSection, SectionStreamingContext } from './TypewriterSection';
import { MicrositeEffectsContext } from './shared/MicrositeEffectsContext';
import { AstSectionDivider } from './shared/AstSectionDivider';
import { DecorationLayer } from './shared/DecorationLayer';
import { Footer } from './shared/Footer';

import type {
  HeroContent,
  OverviewContent,
  ChallengeContent,
  ApproachContent,
  DeliverablesContent,
  TimelineContent,
  PricingContent,
  WhyUsContent,
  NextStepsContent,
  GenericContent,
  TestimonialsContent,
  ShowcaseContent,
  BenefitsContent,
  ProblemContent,
  StatsContent,
  MetricsContent,
  SecurityContent,
  TechStackContent,
  TestingContent,
  FaqContent,
  TeamContent,
  ComparisonContent,
  CaseStudyContent,
  ApprovalContent,
} from '../../types/presentation';

/** Unique stable DOM id for the fullscreen scroll container */
const SCROLL_CONTAINER_ID = 'ms-fullscreen-scroll';
const EMBEDDED_SCROLL_CONTAINER_ID = 'ms-embedded-scroll';

interface Props {
  ast: LayoutAST;
  onClose?: () => void;
  onBack?: () => void;
  onRegenerate?: () => void;
  onEdit?: () => void;
  /** 'fullscreen' (default) renders as a fixed full-viewport overlay; 'embedded' renders inline for the editor canvas. */
  mode?: 'fullscreen' | 'embedded';
  /** True while streaming is in progress — enables spring reveal animation and progress overlay. */
  generating?: boolean;
  /** Total expected sections from the plan event. */
  streamingTotal?: number;
  /** Ordered list of section types from the plan — used to show the next section name in the progress overlay. */
  planSectionTypes?: string[];
  /** Called when an AI quick-action is triggered from a section overlay in editor mode. */
  onSectionAiAction?: (sectionId: string, instruction: string) => void;
  /** Namespace and proposalId — required for the ApprovalSection to check/save approval state. */
  namespace?: string;
  proposalId?: string;
}

/** Wraps each section with visibility animation.
 *  - isStreaming=true: spring reveal immediately on mount (Gamma-style, no scroll wait)
 *  - isStreaming=false: scroll-triggered fade-up (existing behavior, tightened to 16px)
 */
function AnimatedSection({
  id,
  children,
  behavior,
  index,
  isStreaming,
}: {
  id: string;
  children: React.ReactNode;
  behavior?: LayoutAST['behavior'];
  index: number;
  isStreaming?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Freeze isStreaming at mount — parent re-renders change the prop to false after hero arrives
  const wasStreamingRef = useRef(isStreaming ?? false);
  const wasStreaming = wasStreamingRef.current;

  const [visible, setVisible] = useState(wasStreaming ? true : index === 0);

  useEffect(() => {
    // During streaming: sections appear instantly — the auto-scroll provides the
    // natural reveal effect without jarring slide/fade animations (ChatGPT/Claude style).
    if (wasStreaming) return;
    if (index === 0) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.unobserve(el);
        }
      },
      { threshold: 0.08 },
    );
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — all refs captured at mount

  const effect = behavior?.motion !== 'instant' ? (behavior?.scrollEffects ?? 'none') : 'none';
  const delay = Math.min(index * 0.04, 0.24);

  const spring = 'cubic-bezier(0.34, 1.15, 0.64, 1)';

  // Streaming sections: no inline animation styles at all — prevents any flicker
  // and lets the typewriter + auto-scroll do the visual storytelling.
  const animStyle: React.CSSProperties =
    wasStreaming || (effect === 'none' && !wasStreaming)
      ? {}
      : {
          opacity: visible ? 1 : 0,
          transform: visible ? 'none' : 'translateY(16px)',
          transition: visible ? `opacity 0.52s ${spring} ${delay}s, transform 0.52s ${spring} ${delay}s` : 'none',
        };

  return (
    <div ref={ref} id={id} data-section-id={id} style={{ ...animStyle, containerType: 'inline-size' }}>
      {children}
    </div>
  );
}

function renderSection(
  section: LayoutAST['sections'][number],
  tokens: PluginTokens,
  brand: LayoutAST['brand'],
  index: number,
  allSections: LayoutAST['sections'],
  brief?: LayoutAST['brief'],
  namespace?: string,
  proposalId?: string,
  meta?: LayoutAST['meta'],
) {
  // Root-relative paths (/presentation-images/...) are served by the API.
  // Rewrite them through the Next.js /api proxy so they work in the UI.
  const rawUrl = section.image?.url;
  const imageUrl = rawUrl?.startsWith('/presentation-images/') ? `/api${rawUrl}` : (rawUrl ?? null);
  const sid = section.id;

  let inner: React.ReactNode;
  switch (section.sectionType) {
    case 'hero': {
      const heroRaw = section.content as unknown as Record<string, unknown>;
      inner = (
        <HeroSection
          content={section.content as HeroContent}
          tokens={tokens}
          brand={brand}
          imageUrl={imageUrl}
          index={index}
          sections={allSections}
          brief={brief as { keyOutcomes?: string[] } | undefined}
          variant={typeof heroRaw.variant === 'string' ? heroRaw.variant : undefined}
          ui={heroRaw.ui as { showCTA?: boolean; layout?: string; mediaPosition?: string } | undefined}
          behavior={heroRaw.behavior as { hasParallax?: boolean; animation?: string } | undefined}
          imageOverlay={section.imageOverlay}
          sectionId={sid}
          meta={meta ? { client: meta.client, author: meta.author, date: meta.date } : undefined}
        />
      );
      break;
    }
    case 'overview':
      inner = (
        <OverviewSection
          content={section.content as OverviewContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'challenge':
      inner = (
        <ChallengeSection
          content={section.content as ChallengeContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'approach':
      inner = (
        <ApproachSection
          content={section.content as ApproachContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'deliverables':
      inner = (
        <DeliverablesSection
          content={section.content as DeliverablesContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'timeline':
      inner = (
        <TimelineSection
          content={section.content as TimelineContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'pricing':
      inner = (
        <PricingSection
          content={section.content as PricingContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sections={allSections}
          sectionId={sid}
        />
      );
      break;
    case 'whyus':
      inner = (
        <WhyUsSection
          content={section.content as WhyUsContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'nextsteps':
      inner = (
        <NextStepsSection
          content={section.content as NextStepsContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sections={allSections}
          sectionId={sid}
        />
      );
      break;
    case 'testimonials':
      inner = (
        <TestimonialsSection
          content={section.content as TestimonialsContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'showcase':
      inner = (
        <ShowcaseSection
          content={section.content as ShowcaseContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'benefits':
      inner = (
        <BenefitsSection
          content={section.content as BenefitsContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'problem':
      inner = (
        <ProblemSection
          content={section.content as ProblemContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'stats':
      inner = (
        <StatsSection
          content={section.content as StatsContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'metrics':
      inner = (
        <MetricsSection
          content={section.content as MetricsContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'security':
      inner = (
        <SecuritySection
          content={section.content as SecurityContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'techstack':
      inner = (
        <TechStackSection
          content={section.content as TechStackContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'testing':
      inner = (
        <TestingSection
          content={section.content as TestingContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'faq':
      inner = (
        <FaqSection
          content={section.content as FaqContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'team':
      inner = (
        <TeamSection
          content={section.content as TeamContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'comparison':
      inner = (
        <ComparisonSection
          content={section.content as ComparisonContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'casestudy':
      inner = (
        <CaseStudySection
          content={section.content as CaseStudyContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
      break;
    case 'approval':
      inner = (
        <ApprovalSection
          content={section.content as ApprovalContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
          namespace={namespace}
          proposalId={proposalId}
        />
      );
      break;
    default:
      inner = (
        <GenericSection
          content={section.content as GenericContent}
          tokens={tokens}
          imageUrl={imageUrl}
          index={index}
          sectionId={sid}
        />
      );
  }

  return inner;
}

// ── Shimmer skeleton placeholder (shown while sections are still generating) ──

function SkeletonSection({ tokens }: { tokens: PluginTokens }) {
  return (
    <div
      style={{
        minHeight: 480,
        background: `linear-gradient(90deg, ${tokens.surface ?? tokens.bg} 25%, ${tokens.surfaceAlt ?? tokens.surface ?? tokens.bg} 50%, ${tokens.surface ?? tokens.bg} 75%)`,
        backgroundSize: '200% 100%',
        animation: 'ms-shimmer 1.6s ease-in-out infinite',
        margin: '2px 0',
      }}
    />
  );
}

// ── Section overlay wrapper (editor-only) ────────────────────────────────────

function SectionWithOverlay({
  section,
  index,
  total,
  tokens,
  brand,
  allSections,
  brief,
  behavior,
  isStreaming,
  onSectionAiAction,
  namespace,
  proposalId,
  meta,
}: {
  section: LayoutAST['sections'][number];
  index: number;
  total: number;
  tokens: PluginTokens;
  brand: LayoutAST['brand'];
  allSections: LayoutAST['sections'];
  brief?: LayoutAST['brief'];
  behavior?: LayoutAST['behavior'];
  isStreaming?: boolean;
  onSectionAiAction?: (sectionId: string, instruction: string) => void;
  namespace?: string;
  proposalId?: string;
  meta?: LayoutAST['meta'];
}) {
  const editCtx = useEditContext();
  const inner = renderSection(section, tokens, brand, index, allSections, brief, namespace, proposalId, meta);
  // Apply per-section background override using scoped CSS to beat inline styles
  const sel = `[data-section-id="${section.id}"] section,[data-section-id="${section.id}"] > div > section`;
  const hasBgColor = !!section.bgColor;
  // Background image only applies to hero by default.
  // For other sections it only applies when the user explicitly set it via
  // the toolbar (source === 'custom').
  const isHero = section.sectionType === 'hero' || section.sectionType === 'overview';
  const hasBgImage = !!section.image?.url && (isHero || section.image.source === 'custom');
  let bgCssRule = '';
  if (hasBgColor) {
    // Allow CSS variable syntax (hyphens) and all valid CSS value chars.
    // Keep hyphen at end of character class so it's treated as a literal, not a range.
    const safe = section.bgColor!.replace(/[^a-zA-Z0-9#(),. % -]/g, '');
    bgCssRule = `${sel}{background:${safe} !important;}`;
  } else if (hasBgImage) {
    const resolvedBgUrl = section.image!.url!.startsWith('/presentation-images/')
      ? `/api${section.image!.url!}`
      : section.image!.url!;
    bgCssRule = `${sel}{background-image:url("${resolvedBgUrl.replace(/"/g, '')}") !important;background-size:cover !important;background-position:center !important;}`;
  }
  const titleScale = section.titleScale ?? 1;
  const contentScale = section.contentScale ?? 1;
  const scaleCssRule =
    titleScale !== 1 || contentScale !== 1
      ? `[data-section-id="${section.id}"]{--ms-title-scale:${titleScale};--ms-content-scale:${contentScale};}`
      : '';
  const allCssRules = [bgCssRule, scaleCssRule].filter(Boolean).join('');
  let sectionInner: React.ReactNode = allCssRules ? (
    <>
      <style dangerouslySetInnerHTML={{ __html: allCssRules }} />
      {inner}
    </>
  ) : (
    inner
  );

  // Render embed overlay if section has an embed URL
  if (section.embed?.url) {
    const embedSrc = getEmbedSrc(section.embed.url);
    if (embedSrc) {
      sectionInner = (
        <div style={{ position: 'relative' }}>
          {sectionInner}
          <div style={{ padding: '0 0 32px', background: 'transparent' }}>
            <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px' }}>
              <div
                style={{
                  position: 'relative',
                  paddingBottom: '56.25%',
                  borderRadius: 12,
                  overflow: 'hidden',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                }}
              >
                <iframe
                  src={embedSrc}
                  title={section.embed.title ?? 'Embedded media'}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
                />
              </div>
              {section.embed.title && (
                <p style={{ textAlign: 'center', fontSize: 12, color: tokens.textSubtle ?? '#94a3b8', marginTop: 8 }}>
                  {section.embed.title}
                </p>
              )}
            </div>
          </div>
        </div>
      );
    }
  }

  return (
    <AnimatedSection id={section.id} behavior={behavior} index={index} isStreaming={isStreaming}>
      <SectionIdProvider id={section.id}>
        {editCtx ? (
          <SectionEditOverlay
            section={section}
            sectionIndex={index}
            totalSections={total}
            onAiAction={onSectionAiAction}
          >
            {sectionInner}
          </SectionEditOverlay>
        ) : (
          sectionInner
        )}
      </SectionIdProvider>
    </AnimatedSection>
  );
}

/**
 * Memoized SectionWithOverlay — prevents hero re-renders when only `total` or
 * `allSections` grow during streaming. Without this, every new section arrival
 * triggers a re-render of all existing sections, including hero. HeroSection
 * defines inline helper components (R, E) whose function references change on
 * every render → React unmounts/remounts Reveal children → visibility state
 * resets → fade-in animations replay → visible flicker.
 *
 * The comparator intentionally excludes `total` and `allSections` — these grow
 * during streaming but hero doesn't need to re-render when only the count grows.
 */
const StableSectionWithOverlay = React.memo(SectionWithOverlay, (prev, next) => {
  return (
    prev.section === next.section &&
    prev.index === next.index &&
    prev.tokens === next.tokens &&
    prev.brand === next.brand &&
    prev.brief === next.brief &&
    prev.behavior === next.behavior &&
    prev.isStreaming === next.isStreaming &&
    prev.onSectionAiAction === next.onSectionAiAction &&
    prev.meta === next.meta
  );
});

/** Convert a YouTube/Loom/iframe URL into an embeddable src */
function getEmbedSrc(url: string): string | null {
  try {
    // YouTube: https://www.youtube.com/watch?v=ID or https://youtu.be/ID
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?rel=0`;
    // YouTube short embed
    if (url.includes('youtube.com/embed/')) return url;
    // Loom: https://www.loom.com/share/ID
    const loomMatch = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
    if (loomMatch) return `https://www.loom.com/embed/${loomMatch[1]}`;
    if (url.includes('loom.com/embed/')) return url;
    // Generic iframe URL
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return null;
  } catch {
    return null;
  }
}

// ── Token override helpers (module-level, no deps) ───────────────────────────

/** Extract just the font family name from a CSS font-family string like "'Nunito', sans-serif" */
function extractFontName(fontFamily?: string): string | undefined {
  if (!fontFamily) return undefined;
  const match = fontFamily.match(/['"]?([^'",]+)['"]?/);
  return match?.[1]?.trim();
}

/** Return true when a hex color has perceived luminance below 128 (i.e. dark background) */
function isColorDark(hex: string): boolean {
  try {
    const h = hex.replace('#', '');
    if (h.length < 6) return false;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b < 128;
  } catch {
    return false;
  }
}

export function Microsite({
  ast,
  onBack,
  onRegenerate,
  onEdit,
  mode = 'fullscreen',
  generating,
  streamingTotal,
  planSectionTypes,
  onSectionAiAction,
  namespace,
  proposalId,
}: Props) {
  const { apiKey } = useAuth();
  const editCtx = useEditContext();
  const plugin = getPlugin(ast.plugin);
  const brand = ast.brand;

  // Memoize mergedTokens — ast.customTokens/customDesignSystem don't change during
  // streaming (only ast.sections grows), so this reference stays stable.
  const mergedTokens = useMemo(
    () => (ast.customTokens ? { ...(ast.customDesignSystem ?? {}), ...ast.customTokens } : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ast.customTokens, ast.customDesignSystem],
  );

  // Memoize tokens — resolveTokens() returns a new object every call, which would
  // break React.memo on SectionWithOverlay (prev.tokens !== next.tokens always).
  // Stable token reference = hero section won't re-render when new sections arrive.
  const tokens = useMemo(() => {
    // When extractedCssVariables is present, skip brandPrimaryColor so applyBrandOverride
    // does NOT taint tokens with the brand's primaryColor before the override.
    const hasCssOverride = !!(brand?.extractedCssVariables && Object.keys(brand.extractedCssVariables).length > 0);
    let t = resolveTokens(ast.plugin, hasCssOverride ? '' : brand.primaryColor, mergedTokens);
    if (hasCssOverride) {
      const vars = brand.extractedCssVariables!;
      const bgOverride = vars['--ms-bg'] ?? t.bg;
      const accentOverride = vars['--ms-accent'] ?? vars['--ms-hero-accent'] ?? t.accent;
      const textOverride = vars['--ms-text'] ?? t.text;
      // Respect explicit dark/light signal from reference design extraction; fall back to luminance check
      const isDark = vars['--ms-is-dark'] !== undefined ? vars['--ms-is-dark'] === '1' : isColorDark(bgOverride);
      t = {
        ...t,
        accent: accentOverride,
        accentDim: vars['--ms-accent2'] ?? t.accentDim,
        bg: bgOverride,
        surface: vars['--ms-bg2'] ?? t.surface,
        surfaceAlt: vars['--ms-bg3'] ?? t.surfaceAlt,
        surfaceCard: vars['--ms-surface'] ?? t.surfaceCard,
        text: textOverride,
        textMuted: vars['--ms-text2'] ?? t.textMuted,
        textSubtle: vars['--ms-text3'] ?? t.textSubtle,
        border: vars['--ms-border'] ?? t.border,
        gradientHero: vars['--ms-gradient-hero'] ?? t.gradientHero,
        gradientText: vars['--ms-gradient-text'] ?? t.gradientText,
        // customTokens font wins over CSS-extracted font (user explicitly chose it via Design AI)
        heroFont:
          ((mergedTokens as Record<string, unknown>)?.['heroFont'] as string | undefined) ??
          extractFontName(vars['--ms-font-heading']) ??
          t.heroFont,
        bodyFont:
          ((mergedTokens as Record<string, unknown>)?.['bodyFont'] as string | undefined) ??
          extractFontName(vars['--ms-font-body']) ??
          t.bodyFont,
        borderRadius: vars['--ms-r-card'] ?? t.borderRadius,
        cardShadow: vars['--ms-shadow'] ?? t.cardShadow,
        cardShadowHover: vars['--ms-shadow-hover'] ?? t.cardShadowHover,
        dark: isDark,
      };
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ast.plugin, brand, mergedTokens]);

  // Resolve CSS variables: also inject as CSS custom properties for any
  // CSS-based consumers (nav, overlays, etc.), now in addition to the token override above
  const cssVars = brand?.overrideTheme && brand?.extractedCssVariables ? brand.extractedCssVariables : {};

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  // Control bar uses an inverted contrast scheme so buttons are always legible
  // regardless of the microsite's own theme (dark or light) or URL-extracted colors.
  const ctrlBg = tokens.dark ? 'rgba(240,240,245,0.92)' : 'rgba(12,12,15,0.88)';
  const ctrlText = tokens.dark ? '#111118' : '#f0f0f5';
  const ctrlBorder = tokens.dark ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.15)';

  // Track which section IDs have been seen to identify newly streamed sections (for spring reveal)
  const seenSectionIds = useRef<Set<string>>(new Set());
  const allSections = (ast.sections ?? []).filter((s) => !isSectionEmpty(s));

  // During streaming: show hero at top but freeze the allSections reference passed to each
  // section component. Without freezing, every new section arrival grows allSections → hero
  // re-renders with a new sections prop → visible flicker/layout shift.
  const frozenSectionsRef = useRef<typeof allSections>([]);
  if (generating && allSections.length > 0 && frozenSectionsRef.current.length === 0) {
    // Lock when first section (hero) arrives — keeps hero stable throughout generation
    frozenSectionsRef.current = allSections;
  } else if (!generating) {
    frozenSectionsRef.current = []; // Reset after generation so next run starts fresh
  }
  // What to pass as allSections prop to SectionWithOverlay components
  const sectionsForComponents =
    generating && frozenSectionsRef.current.length > 0 ? frozenSectionsRef.current : allSections;

  // Full list — used for progress counting and seenSectionIds tracking
  const sections = allSections.filter((s) => (s.sectionType as string) !== 'chart');

  const newSectionIds = new Set<string>();
  if (generating) {
    sections.forEach((s) => {
      if (!seenSectionIds.current.has(s.id)) newSectionIds.add(s.id);
    });
    sections.forEach((s) => seenSectionIds.current.add(s.id));
  }

  // Progress overlay values — use allSections (includes hero) for accurate count
  const generatedCount = allSections.length;
  const totalCount = streamingTotal ?? 0;
  const nextSectionType = planSectionTypes?.[generatedCount];
  const nextSectionLabel = nextSectionType
    ? nextSectionType.charAt(0).toUpperCase() + nextSectionType.slice(1).replace(/([A-Z])/g, ' $1')
    : null;

  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(0);
  const [pdfProgressMsg, setPdfProgressMsg] = useState('');
  const [mounted, setMounted] = useState(false);
  // typingIndex: which section is currently being typed. null = no typing active.
  const [typingIndex, setTypingIndex] = useState<number | null>(null);

  // During generation: only render sections 0..typingIndex — sections not yet typed
  // stay hidden so they don't flash full content then get retyped when their turn comes.
  // When typingIndex is still null (effect hasn't fired yet), limit to at most 1 section
  // to prevent the race-condition where multiple sections arrive before the first effect
  // runs, causing them all to flash simultaneously then "jump" away when typingIndex=0.
  const visibleSections = generating ? sections.slice(0, typingIndex !== null ? typingIndex + 1 : 1) : sections;

  // Track previous sections length to detect new arrivals during streaming
  const prevSectionsLengthRef = useRef<number>(0);
  // Track which typing completions are pending (next section not yet arrived)
  const typingCompletePendingRef = useRef(false);

  useEffect(() => setMounted(true), []);

  // Drive typingIndex: start typing first section when streaming begins,
  // advance to next when a new section arrives and the previous is done.
  useEffect(() => {
    const currentLen = sections.length;
    if (!generating) {
      // Stream ended — clear typing state
      setTypingIndex(null);
      typingCompletePendingRef.current = false;
      prevSectionsLengthRef.current = 0;
      return;
    }
    if (currentLen === 0) return;

    const prev = prevSectionsLengthRef.current;

    if (prev === 0 && currentLen > 0) {
      // First section arrived: start typing it
      setTypingIndex(0);
      prevSectionsLengthRef.current = currentLen;
      return;
    }

    if (currentLen > prev) {
      // New section(s) arrived
      prevSectionsLengthRef.current = currentLen;
      if (typingCompletePendingRef.current) {
        // Previous section finished typing while waiting for next — advance now
        typingCompletePendingRef.current = false;
        setTypingIndex(currentLen - 1);
      }
      // If current section not yet done typing, it will advance in onComplete
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections.length, generating]);

  // Track if the user has scrolled up (so we don't force-scroll them back down)
  const userScrolledUpRef = useRef(false);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      userScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 180;
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll in sync with content growth: ResizeObserver fires exactly when the
  // content div gets taller (a new typed character rendered), so we scroll
  // immediately — no timer lag, no periodic snap, no jerk.
  useEffect(() => {
    if (!generating) return;
    const container = scrollRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const observer = new ResizeObserver(() => {
      if (userScrolledUpRef.current) return;
      container.scrollTop = container.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating]);

  useEffect(() => {
    const fonts = ast.customFonts?.length ? ast.customFonts : plugin.fonts;
    fonts.forEach((font) => {
      if (!document.querySelector(`link[href="${font.url}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = font.url;
        document.head.appendChild(link);
      }
    });
    // plugin is derived from ast.plugin (a string) — using the string avoids a new
    // object reference every render that would re-run this effect unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ast.plugin, ast.customFonts]);

  // Safety-net: always load Google Fonts for whatever heroFont/bodyFont the resolved
  // tokens reference. This ensures custom fonts (e.g. Poppins from Design AI) are
  // loaded even when customFonts is absent or only partially populated, and guarantees
  // both font families render correctly across every section.
  useEffect(() => {
    const toLoad = [tokens.heroFont, tokens.bodyFont].filter(
      (f): f is string => typeof f === 'string' && f.trim().length > 0,
    );
    toLoad.forEach((family) => {
      const encoded = encodeURIComponent(family.trim()).replace(/%20/g, '+');
      const url = `https://fonts.googleapis.com/css2?family=${encoded}:wght@300;400;500;600;700;800&display=swap`;
      if (!document.querySelector(`link[href="${url}"]`)) {
        console.log('[Microsite] Loading font:', family, url);
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        document.head.appendChild(link);
      } else {
        console.log('[Microsite] Font already loaded:', family);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens.heroFont, tokens.bodyFont]);

  // Load Google Fonts from extractedDesignTokens when overrideTheme is active
  useEffect(() => {
    const fontsUrl = ast.brand?.googleFontsUrl;
    if (!fontsUrl) return;
    const existing = document.querySelector('link[data-ms-fonts]');
    if (existing) existing.remove();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontsUrl;
    link.setAttribute('data-ms-fonts', 'true');
    document.head.appendChild(link);
    return () => {
      document.querySelector('link[data-ms-fonts]')?.remove();
    };
  }, [ast.brand?.googleFontsUrl]);

  // Inject font CSS variable declarations extracted from design prompt
  useEffect(() => {
    const declarations = ast.brand?.fontFaceDeclarations;
    if (!declarations) return;
    const existing = document.querySelector('style[data-ms-font-vars]');
    if (existing) existing.remove();
    const style = document.createElement('style');
    style.setAttribute('data-ms-font-vars', 'true');
    style.textContent = declarations;
    document.head.appendChild(style);
    return () => {
      document.querySelector('style[data-ms-font-vars]')?.remove();
    };
  }, [ast.brand?.fontFaceDeclarations]);

  const animClass = ast.brand?.animationStyle ? `anim-${ast.brand.animationStyle}` : 'anim-smooth';
  const themeClass = ast.brand?.themeClass ?? '';

  const downloadHTML = () => {
    setDownloading(true);
    try {
      const el = contentRef.current;
      if (!el) return;
      const fontLinks = (ast.customFonts?.length ? ast.customFonts : plugin.fonts)
        .map((f) => `<link rel="stylesheet" href="${f.url}">`)
        .join('\n');
      const title = ast.meta?.title || ast.brand.companyName || 'Microsite';
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
${fontLinks}
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:${tokens.bg};color:${tokens.text};overflow-x:hidden}
@media(max-width:768px){
  .ms-grid-3{grid-template-columns:1fr!important}
  .ms-stats-row{flex-direction:column!important}
  .ms-hero-ctas{flex-direction:column!important;width:100%!important}
  .ms-split{flex-direction:column!important}
}
</style>
</head>
<body>
${el.innerHTML}
</body>
</html>`;
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.toLowerCase().replace(/\s+/g, '-')}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  const downloadPdf = async () => {
    const content = contentRef.current;
    const root = scrollRef.current;
    if (!content || !root || downloadingPdf) return;
    setDownloadingPdf(true);
    setPdfProgress(0);
    setPdfProgressMsg('Starting…');

    // Force all animated/reveal elements visible before capture.
    // AnimatedSection and Reveal both set opacity:0 via inline styles on elements not yet
    // scrolled into view — the clone copies those styles, producing invisible content in the PDF.
    type SavedStyle = { el: HTMLElement; opacity: string; transform: string; transition: string };
    const savedStyles: SavedStyle[] = [];
    content.querySelectorAll<HTMLElement>('[data-section-id], [data-reveal]').forEach((el) => {
      savedStyles.push({
        el,
        opacity: el.style.opacity,
        transform: el.style.transform,
        transition: el.style.transition,
      });
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.style.transition = 'none';
    });

    try {
      const { generateCapturePDF } = await import('../../lib/pdfCaptureRenderer');
      const title = ast.meta?.title || ast.brand.companyName || 'Microsite';
      const result = await generateCapturePDF(content, root, {
        title,
        quality: 0.9,
        onProgress: ({ pct, message }) => {
          setPdfProgress(pct);
          setPdfProgressMsg(message);
        },
      });
      if (!result.success) {
        console.error('PDF download failed:', result.error);
        setPdfProgressMsg(`Error: ${result.error ?? 'Download failed'}`);
      }
    } catch (err) {
      console.error('PDF download failed:', err);
      setPdfProgressMsg('Download failed');
    } finally {
      // Restore animated/reveal styles so the UI looks normal after download
      savedStyles.forEach(({ el, opacity, transform, transition }) => {
        el.style.opacity = opacity;
        el.style.transform = transform;
        el.style.transition = transition;
      });
      setDownloadingPdf(false);
    }
  };

  // Allow NextStepsSection's "Download this proposal" CTA to trigger PDF download
  // without prop-drilling through the memoized section tree.
  const downloadPdfRef = useRef(downloadPdf);
  useEffect(() => { downloadPdfRef.current = downloadPdf; });
  useEffect(() => {
    const handler = () => downloadPdfRef.current();
    window.addEventListener('microsite:download-pdf', handler);
    return () => window.removeEventListener('microsite:download-pdf', handler);
  }, []);

  // Build effects context values from AST
  const effectsContextValue = useMemo(
    () => ({
      hoverStyle: (ast.hoverStyle ?? 'lift') as 'none' | 'subtle' | 'lift' | 'glow' | 'tilt',
      sectionAnimations: ast.sectionAnimations ?? {},
    }),
    [ast.hoverStyle, ast.sectionAnimations],
  );

  // In embedded mode the caller supplies its own scroll container — use a plain div.
  const isEmbedded = mode === 'embedded';

  return (
    <MicrositeEffectsContext.Provider value={effectsContextValue}>
      <div
        id={isEmbedded ? undefined : SCROLL_CONTAINER_ID}
        ref={scrollRef}
        data-parallax={ast.behavior?.parallax ? 'true' : 'false'}
        className={`microsite-root ${animClass} ${themeClass}`.trim()}
        style={
          isEmbedded
            ? ({
                background: tokens.bg,
                color: tokens.text,
                minHeight: '100%',
                width: '100%',
                ...cssVars,
              } as React.CSSProperties)
            : ({
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                background: tokens.bg,
                overflowY: 'auto',
                overflowX: 'hidden',
                ...cssVars,
              } as React.CSSProperties)
        }
      >
        <style>{`
        /* ── Regular media queries (real mobile browsers) ── */
        @media (max-width: 768px) {
          .ms-grid-3 { grid-template-columns: 1fr !important; }
          .ms-grid-auto { grid-template-columns: 1fr !important; }
          .ms-split { grid-template-columns: 1fr !important; flex-direction: column !important; }
          .ms-stats-row { flex-direction: column !important; border-radius: 12px !important; }
          .ms-hero-ctas { flex-direction: column !important; width: 100% !important; }
          .ms-nav-links { display: none !important; }
          section { padding-left: 1.25rem !important; padding-right: 1.25rem !important; padding-top: 3rem !important; padding-bottom: 3rem !important; }
        }
        @media (max-width: 960px) {
          .ms-grid-3 { grid-template-columns: repeat(2, 1fr) !important; }
        }
        .ms-parallax-bg { background-attachment: fixed; background-size: cover; }
        @media (max-width: 768px) { .ms-parallax-bg { background-attachment: scroll; } }

        /* ── Container queries (editor mobile/tablet preview) ── */
        .ms-content-root { container-type: inline-size; }

        @container (max-width: 580px) {
          .ms-grid-3 { grid-template-columns: 1fr !important; }
          .ms-grid-auto { grid-template-columns: 1fr !important; }
          .ms-split { grid-template-columns: 1fr !important; }
          .ms-stats-row { flex-direction: column !important; border-radius: 12px !important; }
          .ms-hero-ctas { flex-direction: column !important; width: 100% !important; }
          .ms-nav-links { display: none !important; }
          section {
            padding-left: 1.25rem !important;
            padding-right: 1.25rem !important;
            padding-top: 3rem !important;
            padding-bottom: 3rem !important;
          }
          h1, h2 { word-break: break-word; }
        }
        @container (min-width: 581px) and (max-width: 900px) {
          .ms-grid-3 { grid-template-columns: repeat(2, 1fr) !important; }
          .ms-split { grid-template-columns: 1fr !important; }
          .ms-stats-row { flex-direction: column !important; border-radius: 12px !important; }
          section { padding-left: 1.5rem !important; padding-right: 1.5rem !important; }
        }

        @keyframes ms-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* During streaming, suppress ALL Reveal slide/fade animations.
           Uses !important to override the inline styles that Reveal sets. */
        .ms-generating [data-reveal="1"] {
          opacity: 1 !important;
          transform: none !important;
          transition: none !important;
        }

        @keyframes tw-cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes tw-item-pop {
          from { opacity: 0; transform: translateY(6px) scale(0.97); }
          to   { opacity: 1; transform: none; }
        }

        /* Ensure nav-targeted sections don't scroll behind the sticky nav */
        [data-section-id] { scroll-margin-top: 70px; }

      `}</style>

        {/* Nav — uses the appropriate scroll container */}
        <MicrositeNav
          tokens={tokens}
          brand={ast.brand}
          sections={ast.sections ?? []}
          scrollContainerId={isEmbedded ? EMBEDDED_SCROLL_CONTAINER_ID : SCROLL_CONTAINER_ID}
        />

        {/* Sections */}
        <div
          ref={contentRef}
          className={`ms-content-root${generating ? ' ms-generating' : ''}`}
          style={{ containerType: 'inline-size' }}
        >
          {/* Insert-before-first button */}
          {editCtx && <AddSectionButton afterIndex={-1} />}

          {/* SectionStreamingContext=true disables Reveal slide animations inside sections during generation */}
          <SectionStreamingContext.Provider value={!!generating}>
            {visibleSections.map((section, i) => (
              <React.Fragment key={section.id}>
                <div
                  ref={(el) => {
                    if (el) sectionRefs.current.set(section.id, el);
                    else sectionRefs.current.delete(section.id);
                  }}
                >
                  <TypewriterSection
                    section={section}
                    isActiveTyping={generating === true && typingIndex === i}
                    isStreamingMode={generating === true}
                    onComplete={() => {
                      // Advance to the next section if it has already arrived,
                      // otherwise mark as pending so the arrival effect picks it up.
                      const nextIdx = i + 1;
                      if (nextIdx < sections.length) {
                        setTypingIndex(nextIdx);
                      } else {
                        // Next section not yet in the list — wait for it
                        typingCompletePendingRef.current = true;
                      }
                    }}
                  >
                    {(animatedSection) => (
                      <StableSectionWithOverlay
                        section={animatedSection}
                        index={i}
                        total={sections.length}
                        tokens={tokens}
                        brand={ast.brand}
                        allSections={sectionsForComponents}
                        brief={ast.brief}
                        behavior={ast.behavior}
                        isStreaming={newSectionIds.has(section.id)}
                        onSectionAiAction={onSectionAiAction}
                        namespace={namespace}
                        proposalId={proposalId ?? ast.proposalId}
                        meta={ast.meta}
                      />
                    )}
                  </TypewriterSection>
                </div>
                {/* AST-driven section divider between sections (not after last) */}
                {!generating && ast.dividerStyle && ast.dividerStyle !== 'none' && i < visibleSections.length - 1 && (
                  <AstSectionDivider style={ast.dividerStyle} toColor={visibleSections[i + 1]?.bgColor ?? tokens.bg} />
                )}
                {/* Floating decorative layer per section */}
                {!generating &&
                  ast.decorations &&
                  ast.decorations.style !== 'none' &&
                  (!ast.decorations.sections || ast.decorations.sections.includes(section.id)) && (
                    <div style={{ position: 'relative', height: 0, overflow: 'visible' }}>
                      <DecorationLayer
                        style={ast.decorations.style}
                        opacity={ast.decorations.opacity}
                        accentColor={tokens.accent}
                      />
                    </div>
                  )}
                {editCtx && <AddSectionButton afterIndex={i} />}
              </React.Fragment>
            ))}
            {generating &&
              mounted &&
              createPortal(
                <div
                  style={{
                    position: 'fixed',
                    bottom: 28,
                    right: 28,
                    zIndex: 10001,
                    background: 'rgba(10,10,10,0.88)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    color: '#fff',
                    borderRadius: 12,
                    padding: '12px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    fontSize: 13,
                    lineHeight: 1.4,
                    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
                    minWidth: 220,
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      border: '2px solid rgba(255,255,255,0.25)',
                      borderTopColor: '#fff',
                      animation: 'spin 0.75s linear infinite',
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, color: '#fff' }}>
                      {totalCount > 0 && generatedCount >= totalCount
                        ? 'Finalizing...'
                        : totalCount > 0
                          ? `Section ${generatedCount} of ${totalCount}`
                          : 'Generating sections...'}
                    </div>
                    {nextSectionLabel && generatedCount < totalCount && (
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                        Next: {nextSectionLabel}
                      </div>
                    )}
                  </div>
                </div>,
                document.body,
              )}
          </SectionStreamingContext.Provider>

          <Footer
            tokens={tokens}
            brand={ast.brand}
            sections={ast.sections ?? []}
            client={ast.meta?.client}
            date={ast.meta?.date}
            proposedBy={ast.brief?.proposingCompany || ast.brand?.companyName}
          />
        </div>

        {/* Control bar */}
        {!isEmbedded &&
          mounted &&
          createPortal(
            <div
              style={{
                position: 'fixed',
                bottom: 24,
                right: 24,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                zIndex: 99999,
              }}
            >
              {onBack && (
                <button
                  onClick={onBack}
                  style={{
                    padding: '9px 18px',
                    borderRadius: 100,
                    border: `1px solid ${ctrlBorder}`,
                    background: ctrlBg,
                    backdropFilter: 'blur(12px)',
                    color: ctrlText,
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.8rem',
                    fontWeight: 400,
                    cursor: 'pointer',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Icon icon={ArrowLeft} size="sm" /> Back
                </button>
              )}
              {onRegenerate && (
                <button
                  onClick={onRegenerate}
                  style={{
                    padding: '9px 18px',
                    borderRadius: 100,
                    border: `1px solid ${ctrlBorder}`,
                    background: ctrlBg,
                    backdropFilter: 'blur(12px)',
                    color: ctrlText,
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.8rem',
                    fontWeight: 400,
                    cursor: 'pointer',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Icon icon={RefreshCw} size="sm" /> Regenerate
                </button>
              )}
              {onEdit && (
                <button
                  onClick={onEdit}
                  style={{
                    padding: '9px 18px',
                    borderRadius: 100,
                    border: `1px solid ${ctrlBorder}`,
                    background: ctrlBg,
                    backdropFilter: 'blur(12px)',
                    color: ctrlText,
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.8rem',
                    fontWeight: 400,
                    cursor: 'pointer',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Icon icon={Pencil} size="sm" /> Edit
                </button>
              )}
              {!generating && (
                <>
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <button
                      onClick={downloadPdf}
                      disabled={downloadingPdf}
                      style={{
                        padding: '9px 18px',
                        borderRadius: 100,
                        border: `1px solid ${ctrlBorder}`,
                        background: ctrlBg,
                        backdropFilter: 'blur(12px)',
                        color: ctrlText,
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: downloadingPdf ? 'wait' : 'pointer',
                        minWidth: 148,
                        opacity: downloadingPdf ? 0.75 : 1,
                        boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                    >
                      {downloadingPdf ? `${pdfProgress}% — ${pdfProgressMsg}` : '↓ Download PDF'}
                    </button>
                    {downloadingPdf && (
                      <div
                        style={{
                          position: 'absolute',
                          bottom: -6,
                          left: 0,
                          right: 0,
                          height: 3,
                          borderRadius: 100,
                          background: `${tokens.accent}40`,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${pdfProgress}%`,
                            background: tokens.accent,
                            transition: 'width 0.3s ease',
                            borderRadius: 100,
                          }}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>,
            document.body,
          )}
      </div>
    </MicrositeEffectsContext.Provider>
  );
}

export { SCROLL_CONTAINER_ID, EMBEDDED_SCROLL_CONTAINER_ID };
