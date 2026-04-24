'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PluginTokens, BrandConfig, LayoutSection } from '../../types/presentation';

interface Props {
  tokens: PluginTokens;
  brand: BrandConfig;
  sections: LayoutSection[];
  /** ID of the scrollable container div (defaults to document.documentElement) */
  scrollContainerId?: string;
}

function getScrollContainer(id?: string): HTMLElement {
  if (id) {
    const el = document.getElementById(id);
    if (el) return el;
  }
  return document.documentElement;
}

export function MicrositeNav({ tokens, brand, sections, scrollContainerId }: Props) {
  // Stable filtered list — memoized so IntersectionObserver doesn't reconnect on every streaming update
  const navLinks = useMemo(
    () => sections.filter((s) => s.sectionType !== 'approval' && (s.sectionType as string) !== 'chart' && s.sectionType !== 'hero'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections.map((s) => s.id).join(',')],
  );

  const [scrolled, setScrolled] = useState(false);
  const [scrollPct, setScrollPct] = useState(0);
  const [activeId, setActiveId] = useState<string>('');
  const [mobileOpen, setMobileOpen] = useState(false);
  // Detect actual nav container width instead of relying on @media queries,
  // so the hamburger works inside the editor's 375px preview pane.
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [navWidth, setNavWidth] = useState(1200);
  const navRef = useRef<HTMLElement>(null);
  // Suppress IntersectionObserver active-state updates during programmatic scroll
  const scrollingRef = useRef<boolean>(false);
  const scrollingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setNavWidth(w);
      setIsMobileLayout(w < 640);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const container = getScrollContainer(scrollContainerId);

    const onScroll = () => {
      const scrollTop = container === document.documentElement ? window.scrollY : container.scrollTop;
      const scrollable = container.scrollHeight - container.clientHeight;
      setScrolled(scrollTop > 60);
      setScrollPct(scrollable > 0 ? (scrollTop / scrollable) * 100 : 0);
    };

    const target = container === document.documentElement ? window : container;
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => target.removeEventListener('scroll', onScroll);
  }, [scrollContainerId]);

  // Active section tracking via IntersectionObserver, observing within the scroll container
  useEffect(() => {
    const container = getScrollContainer(scrollContainerId);
    const observers: IntersectionObserver[] = [];
    const visibleSections = new Map<string, number>();

    // Only track nav-visible sections — approval is excluded from nav so skip it
    navLinks.forEach((s) => {
      const el = document.getElementById(s.id);
      if (!el) return;

      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            visibleSections.set(s.id, entry.intersectionRatio);
          } else {
            visibleSections.delete(s.id);
          }
          let best = '';
          let bestRatio = 0;
          visibleSections.forEach((ratio, id) => {
            if (ratio > bestRatio) {
              bestRatio = ratio;
              best = id;
            }
          });
          // Suppress updates during programmatic scroll — prevents highlight jumping
          if (!scrollingRef.current) setActiveId(best);
        },
        {
          root: container === document.documentElement ? null : container,
          threshold: [0, 0.1, 0.3, 0.5],
          rootMargin: '-64px 0px 0px 0px',
        },
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, [navLinks, scrollContainerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollTo = (id: string) => {
    const container = getScrollContainer(scrollContainerId);
    const el = document.getElementById(id);
    if (!el) return;

    // Immediately highlight the tapped item and suppress IO updates during scroll
    setActiveId(id);
    scrollingRef.current = true;
    clearTimeout(scrollingTimerRef.current);
    scrollingTimerRef.current = setTimeout(() => {
      scrollingRef.current = false;
    }, 900);

    if (container === document.documentElement) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // Scroll within the container
      const containerTop = container.getBoundingClientRect().top;
      const elTop = el.getBoundingClientRect().top;
      const offset = elTop - containerTop + container.scrollTop - 64; // 64 = nav height
      container.scrollTo({ top: offset, behavior: 'smooth' });
    }
    setMobileOpen(false);
  };

  const NAV_LABEL: Record<string, string> = {
    hero: 'Home',
    overview: 'Overview',
    challenge: 'Challenge',
    problem: 'Problem',
    approach: 'Approach',
    deliverables: 'Deliverables',
    timeline: 'Timeline',
    pricing: 'Pricing',
    whyus: 'Why Us',
    nextsteps: 'Next Steps',
    testimonials: 'Testimonials',
    showcase: 'Showcase',
    benefits: 'Benefits',
    stats: 'Stats',
    metrics: 'Metrics',
    security: 'Security',
    techstack: 'Tech Stack',
    testing: 'Testing',
    faq: 'FAQ',
    team: 'Team',
    comparison: 'Comparison',
    casestudy: 'Case Study',
    generic: 'Overview',
  };

  // Count how many sections share each type — types with duplicates need unique labels
  const typeCounts = sections.reduce<Record<string, number>>((acc, s) => {
    acc[s.sectionType] = (acc[s.sectionType] ?? 0) + 1;
    return acc;
  }, {});
  const typeOccurrence: Record<string, number> = {};

  function cleanNavHeading(heading: string): string {
    return (
      heading
        // Strip common verbose prefixes: "Risk: Foo Bar" → "Foo Bar"
        .replace(/^risk[:\s]+/i, '')
        .replace(/^phase[:\s]+\d+[:\s]*/i, '')
        .replace(/^step[:\s]+\d+[:\s]*/i, '')
        .replace(/^section[:\s]+/i, '')
        // Strip trailing colons/punctuation
        .replace(/[:\s]+$/, '')
        .trim()
    );
  }

  function navLabel(s: LayoutSection): string {
    const mapped = NAV_LABEL[s.sectionType];
    if (mapped && typeCounts[s.sectionType] === 1) return mapped;
    // Multiple sections share this type — clean and shorten the heading
    if (s.heading) {
      const cleaned = cleanNavHeading(s.heading);
      const words = cleaned.split(/\s+/).slice(0, 3).join(' ');
      if (words) return words;
    }
    // Last resort: mapped label with a counter
    if (mapped) {
      typeOccurrence[s.sectionType] = (typeOccurrence[s.sectionType] ?? 0) + 1;
      return `${mapped} ${typeOccurrence[s.sectionType]}`;
    }
    return s.heading.split(/\s+/)[0] || 'Section';
  }

  // Compute contrast-safe nav text colors based on whether the bg token is dark or light.
  // Using tokens.textMuted directly can be invisible when URL-extracted designs produce
  // a muted color that doesn't contrast well against the nav's own bg.
  const navInactiveColor = tokens.dark ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.52)';
  const navLogoColor = tokens.accent;

  const navFontSize = 11;
  const navGap = 20;

  // If there are more than 11 nav items, always force hamburger mode
  const forceHamburger = navLinks.length > 11;
  const useHamburger = isMobileLayout || forceHamburger;

  // How many links fit in available space (logo ~200px, padding 48px, "More" btn ~64px)
  const LOGO_RESERVED = 220;
  const MORE_BTN_W = 70;
  const AVG_ITEM_W = 72; // rough px per nav item at 11px uppercase
  const availableW = Math.max(0, navWidth - LOGO_RESERVED - MORE_BTN_W);
  const maxVisible = Math.max(2, Math.floor(availableW / AVG_ITEM_W));
  const visibleLinks = navLinks.slice(0, maxVisible);
  const overflowLinks = navLinks.slice(maxVisible);
  const hasOverflow = overflowLinks.length > 0;

  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      {/* Scroll progress bar — sticky inside the scroll container */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `${tokens.accent}20`,
          zIndex: 600,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${scrollPct}%`,
            background: tokens.gradientText ?? tokens.accent,
            transition: 'width 0.1s linear',
          }}
        />
      </div>

      <nav
        ref={navRef}
        style={{
          position: 'sticky',
          top: 2,
          left: 0,
          right: 0,
          zIndex: 500,
          padding: '0 24px',
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          transition: 'background 0.3s, backdrop-filter 0.3s, border-color 0.3s',
          background: scrolled ? `${tokens.bg}cc` : `${tokens.bg}99`,
          backdropFilter: 'blur(16px)',
          borderBottom: `1px solid ${scrolled ? tokens.border : 'transparent'}`,
        }}
      >
        {/* Logo / Company name — never shrinks */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {brand.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt={brand.companyName}
              style={{ height: 28, objectFit: 'contain', maxWidth: useHamburger ? 100 : 160 }}
            />
          ) : (
            <span
              style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontWeight: 700,
                fontSize: useHamburger ? 13 : 16,
                color: navLogoColor,
                letterSpacing: tokens.labelTracking,
                textTransform: 'uppercase',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {brand.logoText || brand.companyName}
            </span>
          )}
        </div>

        {/* Desktop nav links — hidden when container is narrow or sections > 11 */}
        {!useHamburger && (
          <div style={{ display: 'flex', alignItems: 'center', gap: navGap, flexShrink: 0, position: 'relative' }}>
            {visibleLinks.map((s) => {
              const isActive = activeId === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => scrollTo(s.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    borderBottom: isActive ? `1.5px solid ${tokens.accent}` : '1.5px solid transparent',
                    cursor: 'pointer',
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: navFontSize,
                    fontWeight: isActive ? 700 : 600,
                    color: isActive ? tokens.accent : navInactiveColor,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase' as const,
                    padding: '4px 0 2px',
                    whiteSpace: 'nowrap',
                    transition: 'color 0.2s',
                    flexShrink: 0,
                  }}
                >
                  {navLabel(s)}
                </button>
              );
            })}

            {/* "More" dropdown for overflow sections */}
            {hasOverflow && (
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  onClick={() => setMoreOpen((o) => !o)}
                  style={{
                    background: moreOpen ? `${tokens.accent}14` : 'none',
                    border: `1px solid ${moreOpen ? tokens.accent + '60' : 'transparent'}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: navFontSize,
                    fontWeight: 600,
                    color: overflowLinks.some((s) => s.id === activeId) ? tokens.accent : navInactiveColor,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase' as const,
                    padding: '4px 8px',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    transition: 'color 0.2s, background 0.15s',
                  }}
                >
                  More
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="currentColor"
                    style={{ transform: moreOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }}
                  >
                    <path
                      d="M1 3l4 4 4-4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                {moreOpen && (
                  <>
                    {/* Click-away backdrop */}
                    <div style={{ position: 'fixed', inset: 0, zIndex: 498 }} onClick={() => setMoreOpen(false)} />
                    {/* Dropdown panel */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 10px)',
                        right: 0,
                        zIndex: 499,
                        background: `${tokens.bg}f8`,
                        backdropFilter: 'blur(20px)',
                        border: `1px solid ${tokens.border}`,
                        borderRadius: 10,
                        padding: '6px',
                        minWidth: 160,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                        display: 'flex',
                        flexDirection: 'column' as const,
                        gap: 2,
                      }}
                    >
                      {overflowLinks.map((s) => {
                        const isActive = activeId === s.id;
                        return (
                          <button
                            key={s.id}
                            onClick={() => {
                              scrollTo(s.id);
                              setMoreOpen(false);
                            }}
                            style={{
                              background: isActive ? `${tokens.accent}14` : 'none',
                              border: 'none',
                              borderLeft: isActive ? `2px solid ${tokens.accent}` : '2px solid transparent',
                              cursor: 'pointer',
                              textAlign: 'left' as const,
                              padding: '8px 10px 8px 12px',
                              borderRadius: '0 6px 6px 0',
                              fontFamily: `'${tokens.bodyFont}', sans-serif`,
                              fontSize: 11,
                              fontWeight: isActive ? 700 : 600,
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase' as const,
                              color: isActive ? tokens.accent : navInactiveColor,
                              whiteSpace: 'nowrap',
                              transition: 'color 0.15s, background 0.15s',
                              width: '100%',
                            }}
                          >
                            {navLabel(s)}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Hamburger button — shown when container is narrow or sections > 11 */}
        {useHamburger && (
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            style={{
              background: mobileOpen ? `${tokens.accent}18` : 'none',
              border: `1px solid ${mobileOpen ? tokens.accent : 'transparent'}`,
              borderRadius: 8,
              cursor: 'pointer',
              padding: '6px 8px',
              color: mobileOpen ? tokens.accent : navInactiveColor,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              transition: 'background 0.15s, border-color 0.15s',
              flexShrink: 0,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              {mobileOpen ? <path d="M6 6l12 12M6 18L18 6" /> : <path d="M4 8h16M4 16h16" />}
            </svg>
          </button>
        )}
      </nav>

      {/* Hamburger menu — full-width dropdown panel */}
      {mobileOpen && useHamburger && (
        <>
          {/* Click-away backdrop */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 498 }}
            onClick={() => setMobileOpen(false)}
          />
          <div
            style={{
              position: 'sticky',
              top: 66,
              left: 0,
              right: 0,
              zIndex: 499,
              background: tokens.dark
                ? `color-mix(in srgb, ${tokens.bg} 92%, transparent)`
                : `color-mix(in srgb, ${tokens.bg} 96%, transparent)`,
              backdropFilter: 'blur(24px)',
              borderBottom: `1px solid ${tokens.border}`,
              boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            }}
          >
            {/* Grid layout for sections */}
            <div
              style={{
                padding: '12px 16px 16px',
                display: 'grid',
                gridTemplateColumns: navLinks.length > 11
                  ? 'repeat(3, 1fr)'
                  : 'repeat(2, 1fr)',
                gap: 6,
              }}
            >
              {navLinks.map((s, idx) => {
                const isActive = activeId === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => scrollTo(s.id)}
                    style={{
                      background: isActive
                        ? `${tokens.accent}18`
                        : tokens.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                      border: `1px solid ${isActive ? tokens.accent + '50' : tokens.border}`,
                      borderRadius: 10,
                      cursor: 'pointer',
                      textAlign: 'center' as const,
                      padding: '10px 8px',
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: 10,
                      fontWeight: isActive ? 700 : 600,
                      letterSpacing: '0.07em',
                      textTransform: 'uppercase' as const,
                      color: isActive ? tokens.accent : navInactiveColor,
                      transition: 'color 0.15s, background 0.15s, border-color 0.15s',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      minHeight: 40,
                      lineHeight: 1.3,
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    {isActive && (
                      <span style={{
                        position: 'absolute',
                        top: 0, left: 0, right: 0,
                        height: 2,
                        background: tokens.gradientText ?? tokens.accent,
                        borderRadius: '10px 10px 0 0',
                      }} />
                    )}
                    <span style={{
                      display: 'flex',
                      width: 18, height: 18,
                      borderRadius: 6,
                      background: isActive ? `${tokens.accent}20` : tokens.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                      flexShrink: 0,
                      fontSize: 9,
                      fontWeight: 700,
                      color: isActive ? tokens.accent : navInactiveColor,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      {idx + 1}
                    </span>
                    {navLabel(s)}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
