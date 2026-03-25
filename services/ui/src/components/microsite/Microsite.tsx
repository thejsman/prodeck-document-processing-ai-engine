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
      // Small delay so the browser paints the initial state before transitioning
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
    : {
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(32px)',
        transition: visible
          ? `opacity 0.6s cubic-bezier(0.4,0,0.2,1) ${delay}s, transform 0.6s cubic-bezier(0.4,0,0.2,1) ${delay}s`
          : 'none',
      };

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
    default:
      inner = <GenericSection content={section.content as GenericContent} tokens={tokens} imageUrl={imageUrl} index={index} sectionId={sid} />;
  }

  return inner;
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

export function Microsite({ ast, onBack, onRegenerate, onEdit, generating = false, mode = 'fullscreen' }: Props) {
  const { apiKey } = useAuth();
  const editCtx = useEditContext();
  const plugin = getPlugin(ast.plugin);
  const mergedTokens = ast.customTokens
    ? { ...(ast.customDesignSystem ?? {}), ...ast.customTokens }
    : undefined;
  const tokens = resolveTokens(ast.plugin, ast.brand.primaryColor, mergedTokens);
  console.log('[Microsite] USING LLM TOKENS →', !!mergedTokens, '| customDesignSystem:', !!ast.customDesignSystem, '| bg:', tokens.bg, '| heroFont:', tokens.heroFont);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevSectionCount = useRef(0);
  const [downloading, setDownloading] = useState(false);

  // Auto-scroll to the latest section as it streams in
  useEffect(() => {
    if (!generating) { prevSectionCount.current = 0; return; }
    const count = ast.sections?.length ?? 0;
    if (count <= prevSectionCount.current) return;
    prevSectionCount.current = count;
    const lastSection = ast.sections?.[count - 1];
    if (!lastSection) return;
    // Small delay to let the section render before scrolling
    setTimeout(() => {
      const el = document.getElementById(lastSection.id);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }, [ast.sections?.length, generating]);
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
      style={isEmbedded ? {
        background: tokens.bg,
        color: tokens.text,
        overflowX: 'hidden',
        minHeight: '100%',
        width: '100%',
      } : {
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: tokens.bg,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
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

        {(ast.sections ?? []).filter(s => !isSectionEmpty(s)).map((section, i, arr) => (
          <React.Fragment key={section.id}>
            <SectionWithOverlay
              section={section}
              index={i}
              total={ast.sections.length}
              tokens={tokens}
              brand={ast.brand}
              allSections={ast.sections}
              brief={ast.brief}
              behavior={ast.behavior}
              streamingNew={generating && i === arr.length - 1}
            />
            {/* Insert-after button between sections */}
            {editCtx && <AddSectionButton afterIndex={i} />}
          </React.Fragment>
        ))}

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

      {/* Generating indicator — shown while sections are still streaming in */}
      {!isEmbedded && generating && mounted && createPortal(
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
          Generating…
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
