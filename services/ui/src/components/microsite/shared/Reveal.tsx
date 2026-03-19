'use client';

import { useEffect, useRef, useState } from 'react';

type RevealVariant = 'fadeUp' | 'fadeIn' | 'scale' | 'slideLeft';

interface RevealProps {
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
  className?: string;
  variant?: RevealVariant;
}

const HIDDEN: Record<RevealVariant, React.CSSProperties> = {
  fadeUp:    { opacity: 0, transform: 'translateY(28px)' },
  fadeIn:    { opacity: 0, transform: 'none' },
  scale:     { opacity: 0, transform: 'scale(0.94)' },
  slideLeft: { opacity: 0, transform: 'translateX(-28px)' },
};

const VISIBLE: Record<RevealVariant, React.CSSProperties> = {
  fadeUp:    { opacity: 1, transform: 'translateY(0)' },
  fadeIn:    { opacity: 1, transform: 'none' },
  scale:     { opacity: 1, transform: 'scale(1)' },
  slideLeft: { opacity: 1, transform: 'translateX(0)' },
};

export function Reveal({ children, delay = 0, style, className, variant = 'fadeUp' }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const state = visible ? VISIBLE[variant] : HIDDEN[variant];

  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...style,
        ...state,
        transition: `opacity 0.7s cubic-bezier(0.22,1,0.36,1) ${delay}ms, transform 0.7s cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}
