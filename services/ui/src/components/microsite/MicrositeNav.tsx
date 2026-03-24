'use client';

import { useEffect, useState } from 'react';
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
  const [scrolled, setScrolled] = useState(false);
  const [scrollPct, setScrollPct] = useState(0);
  const [activeId, setActiveId] = useState<string>('');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const container = getScrollContainer(scrollContainerId);

    const onScroll = () => {
      const scrollTop = container === document.documentElement
        ? window.scrollY
        : container.scrollTop;
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
          let best = '';
          let bestRatio = 0;
          visibleSections.forEach((ratio, id) => {
            if (ratio > bestRatio) { bestRatio = ratio; best = id; }
          });
          if (best) setActiveId(best);
        },
        {
          root: container === document.documentElement ? null : container,
          threshold: [0, 0.1, 0.3, 0.5],
          rootMargin: '-56px 0px 0px 0px',
        },
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach(o => o.disconnect());
  }, [sections, scrollContainerId]);

  const scrollTo = (id: string) => {
    const container = getScrollContainer(scrollContainerId);
    const el = document.getElementById(id);
    if (!el) return;

    if (container === document.documentElement) {
      el.scrollIntoView({ behavior: 'smooth' });
    } else {
      // Scroll within the container
      const containerTop = container.getBoundingClientRect().top;
      const elTop = el.getBoundingClientRect().top;
      const offset = elTop - containerTop + container.scrollTop - 64; // 64 = nav height
      container.scrollTo({ top: offset, behavior: 'smooth' });
    }
    setMobileOpen(false);
  };

  const navLinks = sections;

  return (
    <>
      {/* Scroll progress bar — sticky inside the scroll container */}
      <div style={{
        position: 'sticky',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        background: `${tokens.accent}20`,
        zIndex: 600,
        pointerEvents: 'none',
      }}>
        <div style={{
          height: '100%',
          width: `${scrollPct}%`,
          background: tokens.gradientText ?? tokens.accent,
          transition: 'width 0.1s linear',
        }} />
      </div>

      <nav
        style={{
          position: 'sticky',
          top: 2, // just below progress bar
          left: 0,
          right: 0,
          zIndex: 500,
          padding: '0 24px',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          transition: 'background 0.3s, backdrop-filter 0.3s, border-color 0.3s',
          background: scrolled ? `${tokens.bg}cc` : `${tokens.bg}99`,
          backdropFilter: 'blur(16px)',
          borderBottom: `1px solid ${scrolled ? tokens.border : 'transparent'}`,
        }}
      >
        {/* Logo / Company name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.companyName} style={{ height: 24, objectFit: 'contain' }} />
          ) : (
            <span style={{
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontWeight: 700,
              fontSize: 13,
              color: tokens.accent,
              letterSpacing: tokens.labelTracking,
              textTransform: 'uppercase',
            }}>
              {brand.logoText || brand.companyName}
            </span>
          )}
        </div>

        {/* Desktop nav links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, overflowX: 'auto', flexShrink: 1, scrollbarWidth: 'none' }} className="ms-nav-links">
          {navLinks.map((s) => {
            const isActive = activeId === s.id;
            return (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: isActive ? `1.5px solid ${tokens.accent}` : '1.5px solid transparent',
                  paddingBottom: 2,
                  cursor: 'pointer',
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? tokens.accent : tokens.textMuted,
                  letterSpacing: '0.02em',
                  padding: '4px 0 2px',
                  transition: 'color 0.2s',
                }}
              >
                {s.heading}
              </button>
            );
          })}
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="ms-nav-mobile-btn"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 8,
            color: tokens.text,
            display: 'none',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            {mobileOpen
              ? <path d="M6 6l12 12M6 18L18 6" />
              : <path d="M4 8h16M4 16h16" />
            }
          </svg>
        </button>
      </nav>

      {/* Mobile bottom sheet */}
      {mobileOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: `${tokens.bg}ee`,
            backdropFilter: 'blur(20px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: '0 0 env(safe-area-inset-bottom, 24px)',
          }}
          onClick={() => setMobileOpen(false)}
        >
          <div
            style={{
              background: tokens.surface,
              borderTop: `1px solid ${tokens.border}`,
              borderRadius: '16px 16px 0 0',
              padding: '24px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  padding: '14px 12px',
                  borderRadius: 8,
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: 15,
                  fontWeight: activeId === s.id ? 700 : 500,
                  color: activeId === s.id ? tokens.accent : tokens.text,
                  minHeight: 44,
                  transition: 'color 0.2s',
                }}
              >
                {s.heading}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Responsive CSS */}
      <style>{`
        @media (max-width: 768px) {
          .ms-nav-mobile-btn { display: block !important; }
          .ms-nav-links { display: none !important; }
        }
      `}</style>
    </>
  );
}
