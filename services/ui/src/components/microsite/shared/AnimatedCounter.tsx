'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  value: string;
  duration?: number;
  style?: React.CSSProperties;
}

function parseNumericValue(val: string): { prefix: string; number: number; suffix: string; decimals: number } {
  const match = val.match(/^([^0-9]*?)([\d,.]+)(.*)$/);
  if (!match) return { prefix: '', number: 0, suffix: val, decimals: 0 };
  const raw = match[2].replace(/,/g, '');
  const num = parseFloat(raw);
  const decMatch = raw.match(/\.(\d+)/);
  return {
    prefix: match[1],
    number: isNaN(num) ? 0 : num,
    suffix: match[3],
    decimals: decMatch ? decMatch[1].length : 0,
  };
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function AnimatedCounter({ value, duration = 1500, style }: Props) {
  const [display, setDisplay] = useState(value);
  const ref = useRef<HTMLSpanElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          const { prefix, number, suffix, decimals } = parseNumericValue(value);
          if (number === 0) {
            setDisplay(value);
            return;
          }

          const start = performance.now();
          const animate = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const easedProgress = easeOutCubic(progress);
            const current = easedProgress * number;
            setDisplay(`${prefix}${current.toFixed(decimals)}${suffix}`);
            if (progress < 1) requestAnimationFrame(animate);
            else setDisplay(value);
          };
          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [value, duration]);

  return <span ref={ref} style={style}>{display}</span>;
}
