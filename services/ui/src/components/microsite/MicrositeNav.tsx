"use client";

import { useEffect, useRef, useState } from "react";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Icon } from "@/components/ui/Icon";
import type {
  PluginTokens,
  BrandConfig,
  LayoutSection,
} from "../../types/presentation";

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

export function MicrositeNav({
  tokens,
  brand,
  sections,
  scrollContainerId,
}: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [scrollPct, setScrollPct] = useState(0);
  const [activeId, setActiveId] = useState<string>("");
  const [mobileOpen, setMobileOpen] = useState(false);
  // Detect actual nav container width instead of relying on @media queries,
  // so the hamburger works inside the editor's 375px preview pane.
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setIsMobileLayout(entry.contentRect.width < 640);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const container = getScrollContainer(scrollContainerId);

    const onScroll = () => {
      const scrollTop =
        container === document.documentElement
          ? window.scrollY
          : container.scrollTop;
      const scrollable = container.scrollHeight - container.clientHeight;
      setScrolled(scrollTop > 60);
      setScrollPct(scrollable > 0 ? (scrollTop / scrollable) * 100 : 0);
    };

    const target = container === document.documentElement ? window : container;
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [scrollContainerId]);

  // Active section tracking via IntersectionObserver, observing within the scroll container
  useEffect(() => {
    const container = getScrollContainer(scrollContainerId);
    const observers: IntersectionObserver[] = [];
    const visibleSections = new Map<string, number>();

    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (!el) return;

      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            visibleSections.set(s.id, entry.intersectionRatio);
          } else {
            visibleSections.delete(s.id);
          }
          let best = "";
          let bestRatio = 0;
          visibleSections.forEach((ratio, id) => {
            if (ratio > bestRatio) {
              bestRatio = ratio;
              best = id;
            }
          });
          if (best) setActiveId(best);
        },
        {
          root: container === document.documentElement ? null : container,
          threshold: [0, 0.1, 0.3, 0.5],
          rootMargin: "-64px 0px 0px 0px",
        },
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, [sections, scrollContainerId]);

  const scrollTo = (id: string) => {
    const container = getScrollContainer(scrollContainerId);
    const el = document.getElementById(id);
    if (!el) return;

    if (container === document.documentElement) {
      el.scrollIntoView({ behavior: "smooth" });
    } else {
      // Scroll within the container
      const containerTop = container.getBoundingClientRect().top;
      const elTop = el.getBoundingClientRect().top;
      const offset = elTop - containerTop + container.scrollTop - 64; // 64 = nav height
      container.scrollTo({ top: offset, behavior: "smooth" });
    }
    setMobileOpen(false);
  };

  const NAV_LABEL: Record<string, string> = {
    hero: "Home",
    challenge: "Challenge",
    approach: "Approach",
    deliverables: "Deliverables",
    timeline: "Timeline",
    pricing: "Pricing",
    whyus: "Value",
    nextsteps: "Contact",
    testimonials: "Reviews",
    showcase: "Showcase",
    benefits: "Benefits",
    problem: "Problem",
    stats: "Stats",
    generic: "Overview",
  };

  // Count how many sections share each type — types with duplicates need unique labels
  const typeCounts = sections.reduce<Record<string, number>>((acc, s) => {
    acc[s.sectionType] = (acc[s.sectionType] ?? 0) + 1;
    return acc;
  }, {});
  const typeOccurrence: Record<string, number> = {};

  function navLabel(s: LayoutSection): string {
    const mapped = NAV_LABEL[s.sectionType];
    if (mapped && typeCounts[s.sectionType] === 1) return mapped;
    // Multiple sections share this type — use the heading (or first 3 words of it)
    if (s.heading) {
      const words = s.heading.split(/\s+/).slice(0, 3).join(" ");
      if (words) return words;
    }
    // Last resort: mapped label with a counter
    if (mapped) {
      typeOccurrence[s.sectionType] = (typeOccurrence[s.sectionType] ?? 0) + 1;
      return `${mapped} ${typeOccurrence[s.sectionType]}`;
    }
    return s.heading.split(/\s+/)[0] || "Section";
  }

  const navLinks = sections; // show ALL sections

  // Compute contrast-safe nav text colors based on whether the bg token is dark or light.
  // Using tokens.textMuted directly can be invisible when URL-extracted designs produce
  // a muted color that doesn't contrast well against the nav's own bg.
  const navInactiveColor = tokens.dark
    ? 'rgba(255,255,255,0.62)'
    : 'rgba(0,0,0,0.52)';
  const navLogoColor = tokens.accent;

  // Scale font size down as section count grows: 15px for ≤4, down to 12px for 14+
  const navFontSize = Math.round(
    Math.max(12, Math.min(15, 16 - sections.length * 0.25)),
  );
  // Scale gap down proportionally
  const navGap = Math.round(
    Math.max(12, Math.min(28, 30 - sections.length * 0.9)),
  );

  return (
    <>
      {/* Scroll progress bar — sticky inside the scroll container */}
      <div
        style={{
          position: "sticky",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `${tokens.accent}20`,
          zIndex: 600,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${scrollPct}%`,
            background: tokens.gradientText ?? tokens.accent,
            transition: "width 0.1s linear",
          }}
        />
      </div>

      <nav
        ref={navRef}
        style={{
          position: "sticky",
          top: 2,
          left: 0,
          right: 0,
          zIndex: 500,
          padding: "0 24px",
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          transition: "background 0.3s, backdrop-filter 0.3s, border-color 0.3s",
          background: scrolled ? `${tokens.bg}cc` : `${tokens.bg}99`,
          backdropFilter: "blur(16px)",
          borderBottom: `1px solid ${scrolled ? tokens.border : "transparent"}`,
        }}
      >
        {/* Logo / Company name */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {brand.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt={brand.companyName}
              style={{ height: 28, objectFit: "contain", maxWidth: isMobileLayout ? 100 : 160 }}
            />
          ) : (
            <span
              style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontWeight: 700,
                fontSize: isMobileLayout ? 13 : 16,
                color: navLogoColor,
                letterSpacing: tokens.labelTracking,
                textTransform: "uppercase",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {brand.logoText || brand.companyName}
            </span>
          )}
        </div>

        {/* Desktop nav links — hidden when container is narrow */}
        {!isMobileLayout && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: navGap,
              flexWrap: "nowrap",
              overflow: "hidden",
            }}
          >
            {navLinks.map((s) => {
              const isActive = activeId === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => scrollTo(s.id)}
                  style={{
                    background: "none",
                    border: "none",
                    borderBottom: isActive
                      ? `1.5px solid ${tokens.accent}`
                      : "1.5px solid transparent",
                    cursor: "pointer",
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: navFontSize,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? tokens.accent : navInactiveColor,
                    letterSpacing: "0.04em",
                    padding: "4px 0 2px",
                    whiteSpace: "nowrap",
                    transition: "color 0.2s",
                    flexShrink: 0,
                  }}
                >
                  {navLabel(s)}
                </button>
              );
            })}
          </div>
        )}

        {/* Hamburger button — shown when container is narrow */}
        {isMobileLayout && (
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            style={{
              background: mobileOpen ? `${tokens.accent}18` : "none",
              border: `1px solid ${mobileOpen ? tokens.accent : "transparent"}`,
              borderRadius: 8,
              cursor: "pointer",
              padding: "6px 8px",
              color: mobileOpen ? tokens.accent : navInactiveColor,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              transition: "background 0.15s, border-color 0.15s",
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
              {mobileOpen ? (
                <path d="M6 6l12 12M6 18L18 6" />
              ) : (
                <path d="M4 8h16M4 16h16" />
              )}
            </svg>
          </button>
        )}
      </nav>

      {/* Mobile bottom-sheet menu — anchored relative to the nav's scroll container */}
      {mobileOpen && isMobileLayout && (
        <div
          style={{
            position: "sticky",
            top: 66,
            left: 0,
            right: 0,
            zIndex: 499,
            background: `${tokens.bg}f5`,
            backdropFilter: "blur(20px)",
            borderBottom: `1px solid ${tokens.border}`,
            display: "flex",
            flexDirection: "column",
          }}
          onClick={() => setMobileOpen(false)}
        >
          <div
            style={{
              padding: "8px 12px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {sections.map((s) => {
              const isActive = activeId === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => scrollTo(s.id)}
                  style={{
                    background: isActive ? `${tokens.accent}14` : "none",
                    border: "none",
                    borderLeft: isActive ? `2px solid ${tokens.accent}` : "2px solid transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: "0 6px 6px 0",
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: 16,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? tokens.accent : navInactiveColor,
                    minHeight: 44,
                    transition: "color 0.15s, background 0.15s",
                    width: "100%",
                  }}
                >
                  {navLabel(s)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
