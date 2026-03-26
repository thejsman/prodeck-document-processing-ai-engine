'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LayoutAST, PluginTokens } from '../../types/presentation';
import { getPlugin, resolveTokens } from '../../lib/presentation/pluginRegistry';
import { MicrositeNav } from './MicrositeNav';
import { HeroSection } from './sections/HeroSection';
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
import { ChartSection } from './sections/ChartSection';

import { useEditContext } from './editor/EditContext';
import { SectionEditOverlay } from './editor/SectionEditOverlay';
import { SectionIdProvider } from './editor/SectionIdContext';
import { AddSectionButton } from './editor/AddSectionButton';
import { useAuth } from '../../lib/auth-context';
import { isSectionEmpty } from '../../lib/sectionUtils';

import type {
  HeroContent,
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
  ChartContent,
} from '../../types/presentation';

/** Unique stable DOM id for the fullscreen scroll container */
const SCROLL_CONTAINER_ID = 'ms-fullscreen-scroll';

interface Props {
  ast: LayoutAST;
  onClose?: () => void;
  onBack?: () => void;
  onRegenerate?: () => void;
  onEdit?: () => void;
  /** When true, hides the bottom action bar — sections are still streaming in */
  generating?: boolean;
  /** Expected total number of sections (from plan event) — used to show skeleton placeholders */
  streamingTotal?: number;
  /** 'fullscreen' (default) renders as a fixed full-viewport overlay; 'embedded' renders inline for the editor canvas. */
  mode?: 'fullscreen' | 'embedded';
}

/** Wraps each section with scroll-triggered visibility animation. */
function AnimatedSection({
  id,
  children,
  behavior,
  index,
  streamingNew = false,
}: {
  id: string;
  children: React.ReactNode;
  behavior?: LayoutAST['behavior'];
  index: number;
  /** When true (newly streamed in), skip IntersectionObserver and animate immediately */
  streamingNew?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(index === 0 && !streamingNew);

  useEffect(() => {
    if (streamingNew) {
      const t = setTimeout(() => setVisible(true), 30);
      return () => clearTimeout(t);
    }
    if (index === 0) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.unobserve(el); } },
      { threshold: 0.08 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [index, streamingNew]);

  // During streaming always use slide-up; otherwise honour the theme behavior
  const effect = streamingNew
    ? 'slide-up'
    : behavior?.motion !== 'instant' ? (behavior?.scrollEffects ?? 'none') : 'none';
  const delay = streamingNew ? 0 : Math.min(index * 0.04, 0.24);

  const animStyle: React.CSSProperties = effect === 'none'
    ? {}
    : streamingNew
      ? {
          // Gamma-style: fast fade + subtle rise, no delay
          opacity: visible ? 1 : 0,
          transform: visible ? 'none' : 'translateY(20px) scale(0.995)',
          transition: visible
            ? 'opacity 0.45s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1)'
            : 'none',
        }
      : {
          opacity: visible ? 1 : 0,
          transform: visible ? 'none' : 'translateY(32px)',
          transition: visible
            ? `opacity 0.6s cubic-bezier(0.4,0,0.2,1) ${delay}s, transform 0.6s cubic-bezier(0.4,0,0.2,1) ${delay}s`
            : 'none',
        };

  // No typewriter effect — content reveals with the slide-in animation (Gamma style)

  return (
    <div ref={ref} id={id} data-section-id={id} style={animStyle}>
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
) {
  const imageUrl = section.image.url;
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
          sectionId={sid}
        />
      );
      break;
    }
    case 'challenge':
      inner = <ChallengeSection content={section.content as ChallengeContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
      break;
    case 'approach':
      inner = <ApproachSection content={section.content as ApproachContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
      break;
    case 'deliverables':
      inner = <DeliverablesSection content={section.content as DeliverablesContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
      break;
    case 'timeline':
      inner = <TimelineSection content={section.content as TimelineContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
      break;
    case 'pricing':
      inner = <PricingSection content={section.content as PricingContent} tokens={tokens} imageUrl={imageUrl} index={index} sections={allSections} sectionId={sid} />;
      break;
    case 'whyus':
      inner = <WhyUsSection content={section.content as WhyUsContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
      break;
    case 'nextsteps':
      inner = <NextStepsSection content={section.content as NextStepsContent} tokens={tokens} imageUrl={imageUrl} index={index} sections={allSections} sectionId={sid} />;
      break;
    case 'testimonials':
      inner = <TestimonialsSection content={section.content as TestimonialsContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
      break;
    case 'showcase':
      inner = <ShowcaseSection content={section.content as ShowcaseContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
      break;
    case 'benefits':
      inner = <BenefitsSection content={section.content as BenefitsContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
      break;
    case 'problem':
      inner = <ProblemSection content={section.content as ProblemContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
      break;
    case 'stats':
      inner = <StatsSection content={section.content as StatsContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
      break;
    case 'metrics':
      inner = <MetricsSection content={section.content as MetricsContent} tokens={tokens} imageUrl={imageUrl} index={index} />;
      break;
    case 'security':
      inner = <SecuritySection content={section.content as SecurityContent} tokens={tokens} imageUrl={imageUrl} index={index} />;
      break;
    case 'techstack':
      inner = <TechStackSection content={section.content as TechStackContent} tokens={tokens} imageUrl={imageUrl} index={index} />;
      break;
    case 'testing':
      inner = <TestingSection content={section.content as TestingContent} tokens={tokens} imageUrl={imageUrl} index={index} />;
      break;
    case 'faq':
      inner = <FaqSection content={section.content as FaqContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
      break;
    case 'team':
      inner = <TeamSection content={section.content as TeamContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
      break;
    case 'comparison':
      inner = <ComparisonSection content={section.content as ComparisonContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
      break;
    case 'casestudy':
      inner = <CaseStudySection content={section.content as CaseStudyContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
      break;
    case 'chart':
      inner = <ChartSection content={section.content as ChartContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
      break;
    default:
      inner = <GenericSection content={section.content as GenericContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
  }

  return inner;
}

// ── Skeleton placeholder shown for in-flight sections during streaming ────────

function SectionSkeleton({ tokens, sectionNumber, isActive }: { tokens: PluginTokens; sectionNumber: number; isActive?: boolean }) {
  const isHero = sectionNumber === 1;
  const isStats = sectionNumber % 4 === 0;
  const isGrid = sectionNumber % 3 === 0 && !isStats;

  return (
    <div style={{
      minHeight: isHero ? '92vh' : '58vh',
      background: isHero ? tokens.surface : tokens.bg,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: isStats ? 32 : 20,
      padding: isHero ? '120px 48px' : '72px 48px',
      position: 'relative',
      overflow: 'hidden',
      borderTop: `1px solid ${tokens.border}`,
      transition: 'box-shadow 0.4s ease',
      boxShadow: isActive ? `inset 0 0 0 2px ${tokens.accent}40, 0 0 40px ${tokens.accent}18` : 'none',
    }}>
      <style>{`
        @keyframes ms-sk-shimmer{0%{background-position:-800px 0}100%{background-position:800px 0}}
        @keyframes ms-sk-pulse{0%,100%{opacity:0.5}50%{opacity:1}}
        .ms-sk{background:linear-gradient(90deg,${tokens.surface}55 25%,${tokens.surfaceAlt ?? tokens.surface}bb 50%,${tokens.surface}55 75%);background-size:800px 100%;animation:ms-sk-shimmer 1.8s infinite linear;border-radius:6px}
        .ms-sk-dot{width:6px;height:6px;border-radius:50%;background:${tokens.accent};animation:ms-sk-pulse 1.2s ease-in-out infinite}
        .ms-sk-dot:nth-child(2){animation-delay:0.2s}
        .ms-sk-dot:nth-child(3){animation-delay:0.4s}
      `}</style>

      {/* Hero skeleton */}
      {isHero && <>
        <div className="ms-sk" style={{ width: 110, height: 12, marginBottom: 8 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 700, alignItems: 'center' }}>
          <div className="ms-sk" style={{ width: '78%', height: 52 }} />
          <div className="ms-sk" style={{ width: '55%', height: 52 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 560, alignItems: 'center', marginTop: 8 }}>
          <div className="ms-sk" style={{ width: '90%', height: 14 }} />
          <div className="ms-sk" style={{ width: '75%', height: 14 }} />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <div className="ms-sk" style={{ width: 148, height: 46, borderRadius: 23 }} />
          <div className="ms-sk" style={{ width: 120, height: 46, borderRadius: 23, opacity: 0.6 }} />
        </div>
      </>}

      {/* Stats skeleton */}
      {isStats && !isHero && <>
        <div className="ms-sk" style={{ width: 90, height: 12 }} />
        <div className="ms-sk" style={{ width: '50%', height: 36 }} />
        <div style={{ display: 'flex', gap: 32, marginTop: 16, justifyContent: 'center' }}>
          {[1,2,3].map(n => (
            <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div className="ms-sk" style={{ width: 80, height: 52, borderRadius: 8 }} />
              <div className="ms-sk" style={{ width: 64, height: 12 }} />
            </div>
          ))}
        </div>
      </>}

      {/* Grid skeleton */}
      {isGrid && !isHero && <>
        <div className="ms-sk" style={{ width: 90, height: 12 }} />
        <div className="ms-sk" style={{ width: '52%', height: 34 }} />
        <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 860 }}>
          {[1,2,3,4].map(n => (
            <div key={n} style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 180 }}>
              <div className="ms-sk" style={{ width: 36, height: 36, borderRadius: 8 }} />
              <div className="ms-sk" style={{ width: '80%', height: 14 }} />
              <div className="ms-sk" style={{ width: '100%', height: 10 }} />
              <div className="ms-sk" style={{ width: '70%', height: 10 }} />
            </div>
          ))}
        </div>
      </>}

      {/* Default skeleton */}
      {!isHero && !isStats && !isGrid && <>
        <div className="ms-sk" style={{ width: 90, height: 12 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 560, alignItems: 'center' }}>
          <div className="ms-sk" style={{ width: '62%', height: 36 }} />
          <div className="ms-sk" style={{ width: '44%', height: 36 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 480, alignItems: 'center' }}>
          <div className="ms-sk" style={{ width: '100%', height: 13 }} />
          <div className="ms-sk" style={{ width: '85%', height: 13 }} />
          <div className="ms-sk" style={{ width: '68%', height: 13 }} />
        </div>
      </>}

      {/* Active building indicator */}
      {isActive && (
        <div style={{
          position: 'absolute', bottom: 24,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ display: 'flex', gap: 5 }}>
            <div className="ms-sk-dot" />
            <div className="ms-sk-dot" />
            <div className="ms-sk-dot" />
          </div>
          <span style={{
            fontFamily: 'sans-serif', fontSize: 11,
            color: tokens.accent, opacity: 0.7,
            letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600,
          }}>
            Building section {sectionNumber}
          </span>
        </div>
      )}

      {/* Inactive label */}
      {!isActive && (
        <div style={{
          position: 'absolute', bottom: 20,
          fontFamily: 'sans-serif', fontSize: 11,
          color: tokens.textSubtle, opacity: 0.3,
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          Section {sectionNumber}
        </div>
      )}
    </div>
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
  streamingNew,
}: {
  section: LayoutAST['sections'][number];
  index: number;
  total: number;
  tokens: PluginTokens;
  brand: LayoutAST['brand'];
  allSections: LayoutAST['sections'];
  brief?: LayoutAST['brief'];
  behavior?: LayoutAST['behavior'];
  streamingNew?: boolean;
}) {
  const editCtx = useEditContext();
  const inner = renderSection(section, tokens, brand, index, allSections, brief);
  // Apply per-section background override using scoped CSS to beat inline styles
  const sel = `[data-section-id="${section.id}"] section,[data-section-id="${section.id}"] > div > section`;
  const hasBgColor = !!section.bgColor;
  // Background image only applies to hero by default.
  // For other sections it only applies when the user explicitly set it via
  // the toolbar (source === 'custom').
  const isHero = section.sectionType === 'hero';
  const hasBgImage = !!section.image?.url && (isHero || section.image.source === 'custom');
  let bgCssRule = '';
  if (hasBgColor) {
    const safe = section.bgColor!.replace(/[^a-zA-Z0-9#(),.% ]/g, '');
    bgCssRule = `${sel}{background:${safe} !important;}`;
  } else if (hasBgImage) {
    bgCssRule = `${sel}{background-image:url("${section.image!.url!.replace(/"/g, '')}") !important;background-size:cover !important;background-position:center !important;}`;
  }
  let sectionInner: React.ReactNode = bgCssRule ? (
    <>
      <style dangerouslySetInnerHTML={{ __html: bgCssRule }} />
      {inner}
    </>
  ) : inner;

  // Render embed overlay if section has an embed URL
  if (section.embed?.url) {
    const embedSrc = getEmbedSrc(section.embed.url);
    if (embedSrc) {
      sectionInner = (
        <div style={{ position: 'relative' }}>
          {sectionInner}
          <div style={{ padding: '0 0 32px', background: 'transparent' }}>
            <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px' }}>
              <div style={{ position: 'relative', paddingBottom: '56.25%', borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
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
    <div>
      <AnimatedSection id={section.id} behavior={behavior} index={index} streamingNew={streamingNew}>
        <SectionIdProvider id={section.id}>
          {editCtx ? (
            <SectionEditOverlay section={section} sectionIndex={index} totalSections={total}>
              {sectionInner}
            </SectionEditOverlay>
          ) : sectionInner}
        </SectionIdProvider>
      </AnimatedSection>
    </div>
  );
}

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
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
  } catch { return false; }
}

export function Microsite({ ast, onBack, onRegenerate, onEdit, generating = false, streamingTotal, mode = 'fullscreen' }: Props) {
  const { apiKey } = useAuth();
  const editCtx = useEditContext();
  const plugin = getPlugin(ast.plugin);
  const mergedTokens = ast.customTokens
    ? { ...(ast.customDesignSystem ?? {}), ...ast.customTokens }
    : undefined;
  const brand = ast.brand;
  // When extractedCssVariables is present, skip brandPrimaryColor so applyBrandOverride
  // does NOT taint tokens with the brand's primaryColor (#C8A96E etc.) before the override.
  const hasCssOverride = !!(brand?.extractedCssVariables && Object.keys(brand.extractedCssVariables).length > 0);
  let tokens = resolveTokens(ast.plugin, hasCssOverride ? '' : ast.brand.primaryColor, mergedTokens);

  // ── Override tokens from extractedCssVariables when overrideTheme is set ──
  // Sections use tokens.* directly (JS object fields), not CSS var() references,
  // so we must override the tokens object itself — injecting CSS variables on
  // the root div alone has no effect on section rendering.
  if (hasCssOverride) {
    const vars = brand.extractedCssVariables!;
    const bgOverride = vars['--ms-bg'] ?? tokens.bg;
    const accentOverride = vars['--ms-accent'] ?? vars['--ms-hero-accent'] ?? tokens.accent;
    const textOverride = vars['--ms-text'] ?? tokens.text;
    const isDark = isColorDark(bgOverride);
    tokens = {
      ...tokens,
      accent:       accentOverride,
      accentDim:    vars['--ms-accent2'] ?? tokens.accentDim,
      bg:           bgOverride,
      surface:      vars['--ms-bg2']     ?? tokens.surface,
      surfaceAlt:   vars['--ms-bg3']     ?? tokens.surfaceAlt,
      surfaceCard:  vars['--ms-surface'] ?? tokens.surfaceCard,
      text:         textOverride,
      textMuted:    vars['--ms-text2']   ?? tokens.textMuted,
      textSubtle:   vars['--ms-text3']   ?? tokens.textSubtle,
      border:       vars['--ms-border']  ?? tokens.border,
      heroFont:     extractFontName(vars['--ms-font-heading']) ?? tokens.heroFont,
      bodyFont:     extractFontName(vars['--ms-font-body'])    ?? tokens.bodyFont,
      borderRadius: vars['--ms-r-card']        ?? tokens.borderRadius,
      cardShadow:      vars['--ms-shadow']       ?? tokens.cardShadow,
      cardShadowHover: vars['--ms-shadow-hover'] ?? tokens.cardShadowHover,
      dark: isDark,
    };
  }

  console.log('[Microsite] USING LLM TOKENS →', !!mergedTokens, '| overrideTheme:', !!brand?.overrideTheme, '| customDesignSystem:', !!ast.customDesignSystem, '| bg:', tokens.bg, '| accent:', tokens.accent, '| heroFont:', tokens.heroFont);

  // Resolve CSS variables: also inject as CSS custom properties for any
  // CSS-based consumers (nav, overlays, etc.), now in addition to the token override above
  const cssVars = (brand?.overrideTheme && brand?.extractedCssVariables)
    ? brand.extractedCssVariables
    : {};

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  // Track recently-arrived section IDs for slide-in animation + auto-scroll (Gamma style)
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [recentlyArrived, setRecentlyArrived] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!generating) return;
    const sections = ast.sections ?? [];
    const newIds = sections.map(s => s.id).filter(id => !recentlyArrived.has(id));
    if (!newIds.length) return;
    setRecentlyArrived(prev => new Set([...prev, ...newIds]));
    // Auto-scroll to the latest arrived section (Gamma feel)
    const latestId = newIds[newIds.length - 1];
    setTimeout(() => {
      const el = sectionRefs.current.get(latestId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    newIds.forEach(id => {
      setTimeout(() => {
        setRecentlyArrived(prev => { const next = new Set(prev); next.delete(id); return next; });
      }, 2500);
    });
  }, [ast.sections?.length, generating]); // eslint-disable-line react-hooks/exhaustive-deps
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);

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
  }, [plugin, ast.customFonts]);

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
    return () => { document.querySelector('link[data-ms-fonts]')?.remove(); };
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
    return () => { document.querySelector('style[data-ms-font-vars]')?.remove(); };
  }, [ast.brand?.fontFaceDeclarations]);

  const animClass = ast.brand?.animationStyle ? `anim-${ast.brand.animationStyle}` : 'anim-smooth';
  const themeClass = ast.brand?.themeClass ?? '';

  const downloadHTML = () => {
    setDownloading(true);
    try {
      const el = contentRef.current;
      if (!el) return;
      const fontLinks = (ast.customFonts?.length ? ast.customFonts : plugin.fonts)
        .map(f => `<link rel="stylesheet" href="${f.url}">`)
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

  const downloadPdf = () => {
    setDownloadingPdf(true);
    try {
      const el = contentRef.current;
      if (!el) return;

      // Clone the DOM so we don't mutate the live page
      const clone = el.cloneNode(true) as HTMLElement;

      // Reset ALL inline animation states — Reveal + AnimatedSection components
      // leave opacity:0 / translateY on elements not yet scrolled into view.
      clone.querySelectorAll<HTMLElement>('*').forEach(elem => {
        const s = elem.style;
        // Handle both string "0" and numeric 0 opacity
        if (s.opacity === '0' || s.opacity === '0.0' || (s.opacity !== '' && parseFloat(s.opacity) === 0)) {
          s.opacity = '1';
        }
        if (s.transform && s.transform !== 'none' && s.transform !== '') s.transform = 'none';
        if (s.transition) s.transition = 'none';
        if (s.visibility === 'hidden') s.visibility = 'visible';
        // Some animations use pointer-events:none + opacity together
        if (s.pointerEvents === 'none' && elem.tagName !== 'DIV') s.pointerEvents = 'auto';
      });
      // Also reset the outer animated wrappers (AnimatedSection)
      clone.querySelectorAll<HTMLElement>('[data-section-id]').forEach(elem => {
        elem.style.opacity = '1';
        elem.style.transform = 'none';
        elem.style.transition = 'none';
      });

      const fontLinks = (ast.customFonts?.length ? ast.customFonts : plugin.fonts)
        .map(f => `<link rel="stylesheet" href="${f.url}">`)
        .join('\n');
      const title = ast.meta?.title || ast.brand.companyName || 'Microsite';

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
${fontLinks}
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:${tokens.bg};color:${tokens.text};overflow-x:hidden;width:1280px}
@page{size:1280px 720px;margin:0}
[data-section-id]{
  width:1280px;
  min-height:720px;
  page-break-after:always;
  break-after:page;
  page-break-inside:avoid;
  break-inside:avoid;
  overflow:hidden;
}
[data-section-id]:last-child{page-break-after:avoid;break-after:avoid}
*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
*{opacity:1!important;visibility:visible!important;transform:none!important;transition:none!important}
.ms-parallax-bg{background-attachment:scroll!important}
</style>
</head>
<body>${clone.innerHTML}</body>
</html>`;

      // Render iframe at 1280px wide so sections layout correctly before printing
      const iframe = document.createElement('iframe');
      Object.assign(iframe.style, {
        position: 'fixed', top: '-9999px', left: '-9999px',
        width: '1280px', height: '720px', border: 'none',
        visibility: 'hidden',
      });
      document.body.appendChild(iframe);

      iframe.srcdoc = html;

      // Wait for fonts + layout inside the iframe before printing
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } finally {
          // Remove iframe after a short delay (print dialog may still be open)
          setTimeout(() => document.body.removeChild(iframe), 3000);
          setDownloadingPdf(false);
        }
      }, 1500);
    } catch {
      setDownloadingPdf(false);
    }
  };

  // In embedded mode the caller supplies its own scroll container — use a plain div.
  const isEmbedded = mode === 'embedded';

  return (
    <div
      id={isEmbedded ? undefined : SCROLL_CONTAINER_ID}
      ref={scrollRef}
      data-parallax={ast.behavior?.parallax ? 'true' : 'false'}
      className={`microsite-root ${animClass} ${themeClass}`.trim()}
      style={isEmbedded ? {
        background: tokens.bg,
        color: tokens.text,
        overflowX: 'hidden',
        minHeight: '100%',
        width: '100%',
        ...cssVars,
      } as React.CSSProperties : {
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: tokens.bg,
        overflowY: 'auto',
        overflowX: 'hidden',
        ...cssVars,
      } as React.CSSProperties}
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
      `}</style>

      {/* Nav — uses SCROLL_CONTAINER_ID to find its scroll target */}
      <MicrositeNav
        tokens={tokens}
        brand={ast.brand}
        sections={ast.sections ?? []}
        scrollContainerId={SCROLL_CONTAINER_ID}
      />

      {/* Sections */}
      <div ref={contentRef} className="ms-content-root" style={{ containerType: 'inline-size' }}>
        {/* Insert-before-first button */}
        {editCtx && <AddSectionButton afterIndex={-1} />}

        {(() => {
          // ── Gamma-style append rendering ──────────────────────────────────
          // Sections grow the page downward one by one — no pre-allocated skeleton
          // slots. A single active skeleton appends below the last real section
          // while generation is in progress, giving a smooth top-to-bottom reveal.
          const arrivedSections = (ast.sections ?? []).filter(s => !isSectionEmpty(s));
          const total = streamingTotal || arrivedSections.length;

          return (
            <>
              {arrivedSections.map((section, i) => (
                <React.Fragment key={section.id}>
                  <div ref={el => { if (el) sectionRefs.current.set(section.id, el); else sectionRefs.current.delete(section.id); }}>
                    <SectionWithOverlay
                      section={section}
                      index={i}
                      total={total}
                      tokens={tokens}
                      brand={ast.brand}
                      allSections={arrivedSections}
                      brief={ast.brief}
                      behavior={ast.behavior}
                      streamingNew={generating && recentlyArrived.has(section.id)}
                    />
                  </div>
                  {editCtx && <AddSectionButton afterIndex={i} />}
                </React.Fragment>
              ))}
              {/* Single active skeleton at the bottom while generating */}
              {generating && (
                <SectionSkeleton
                  tokens={tokens}
                  sectionNumber={arrivedSections.length + 1}
                  isActive={true}
                />
              )}
            </>
          );
        })()}

        <footer
          style={{
            padding: '40px 24px env(safe-area-inset-bottom, 40px)',
            textAlign: 'center',
            borderTop: `1px solid ${tokens.border}`,
            background: tokens.bg,
          }}
        >
          <p style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: 12, color: tokens.textSubtle, margin: 0 }}>
            {ast.brand.companyName}{ast.brand.tagline ? ` — ${ast.brand.tagline}` : ''}
          </p>
        </footer>
      </div>

      {/* Planning overlay removed — generate step handles the loading state before first section */}

      {/* Generating indicator — progress counter while sections are streaming in */}
      {!isEmbedded && generating && mounted && (ast.sections ?? []).filter(s => !isSectionEmpty(s)).length > 0 && createPortal(
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 99999,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 16px', borderRadius: 100,
          background: `${tokens.bg}ee`, backdropFilter: 'blur(12px)',
          border: `1px solid ${tokens.border}`, boxShadow: tokens.cardShadow,
          fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.8rem',
          fontWeight: 600, color: tokens.textMuted,
        }}>
          <div style={{
            width: 12, height: 12, borderRadius: '50%',
            border: `2px solid ${tokens.border}`, borderTopColor: tokens.accent,
            animation: 'spin 0.8s linear infinite',
          }} />
          {streamingTotal
            ? `Section ${(ast.sections ?? []).filter(s => !isSectionEmpty(s)).length} of ${streamingTotal}`
            : 'Generating…'}
        </div>,
        document.body,
      )}

      {/* Control bar — hidden while streaming or in embedded mode */}
      {!isEmbedded && !generating && mounted && createPortal(
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          zIndex: 99999,
        }}>
          {onBack && (
            <button
              onClick={onBack}
              style={{
                padding: '9px 18px',
                borderRadius: 100,
                border: `1px solid ${tokens.border}`,
                background: `${tokens.bg}ee`,
                backdropFilter: 'blur(12px)',
                color: tokens.textMuted,
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: tokens.cardShadow,
              }}
            >
              ← Back
            </button>
          )}
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              style={{
                padding: '9px 18px',
                borderRadius: 100,
                border: `1px solid ${tokens.border}`,
                background: `${tokens.bg}ee`,
                backdropFilter: 'blur(12px)',
                color: tokens.textMuted,
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: tokens.cardShadow,
              }}
            >
              ↺ Regenerate
            </button>
          )}
          {onEdit && (
            <button
              onClick={onEdit}
              style={{
                padding: '9px 18px',
                borderRadius: 100,
                border: `1px solid ${tokens.border}`,
                background: `${tokens.bg}ee`,
                backdropFilter: 'blur(12px)',
                color: tokens.textMuted,
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: tokens.cardShadow,
              }}
            >
              ✏ Edit
            </button>
          )}
          <button
            onClick={downloadPdf}
            disabled={downloadingPdf}
            style={{
              padding: '9px 18px',
              borderRadius: 100,
              border: 'none',
              background: tokens.accent,
              color: tokens.dark ? tokens.bg : '#fff',
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: downloadingPdf ? 'wait' : 'pointer',
              boxShadow: `0 4px 16px ${tokens.glowColor}`,
            }}
          >
            {downloadingPdf ? 'Preparing…' : '↓ Download PDF'}
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

export { SCROLL_CONTAINER_ID };
