'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { SectionStreamingContext } from '../TypewriterSection';

type RevealVariant = 'fadeUp' | 'fadeIn' | 'scale' | 'slideLeft' | 'staggerWave';

interface RevealProps {
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
  className?: string;
  variant?: RevealVariant;
}

const HIDDEN: Record<RevealVariant, React.CSSProperties> = {
  fadeUp:      { opacity: 0, transform: 'translateY(28px)' },
  fadeIn:      { opacity: 0, transform: 'none' },
  scale:       { opacity: 0, transform: 'scale(0.94)' },
  slideLeft:   { opacity: 0, transform: 'translateX(-28px)' },
  staggerWave: { opacity: 0, transform: 'translateY(20px) scale(0.96)' },
};

const VISIBLE: Record<RevealVariant, React.CSSProperties> = {
  fadeUp:      { opacity: 1, transform: 'translateY(0)' },
  fadeIn:      { opacity: 1, transform: 'none' },
  scale:       { opacity: 1, transform: 'scale(1)' },
  slideLeft:   { opacity: 1, transform: 'translateX(0)' },
  staggerWave: { opacity: 1, transform: 'translateY(0) scale(1)' },
};

export function Reveal({ children, delay = 0, style, className, variant = 'fadeUp' }: RevealProps) {
  // During streaming generation, skip ALL reveal animations — sections appear instantly
  // as the page auto-scrolls to them. This prevents the slideUp flash on newly-arrived sections.
  const isStreaming = useContext(SectionStreamingContext);

  const ref = useRef<HTMLDivElement>(null);
  // wasStreamingAtMount: frozen at mount so that sections that arrive during streaming
  // are permanently animation-free even after generating stops.
  const wasStreamingAtMount = useRef(isStreaming);
  const [visible, setVisible] = useState(!wasStreamingAtMount.current ? false : true);

  useEffect(() => {
    // Skip observer entirely if streaming was active when this mounted
    if (wasStreamingAtMount.current) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — wasStreamingAtMount is frozen

  // During streaming: return children with NO inline opacity/transform styles at all.
  // This is the only bulletproof approach — zero risk of animation styles leaking through.
  if (isStreaming || wasStreamingAtMount.current) {
    return (
      <div ref={ref} data-reveal="1" className={className} style={style}>
        {children}
      </div>
    );
  }

  const state = visible ? VISIBLE[variant] : HIDDEN[variant];
  const transition = `opacity 0.7s cubic-bezier(0.22,1,0.36,1) ${delay}ms, transform 0.7s cubic-bezier(0.22,1,0.36,1) ${delay}ms`;

  return (
    <div
      ref={ref}
      data-reveal="1"
      className={className}
      style={{ ...style, ...state, transition }}
    >
      {children}
    </div>
  );
}
