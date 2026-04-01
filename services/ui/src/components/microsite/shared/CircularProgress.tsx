'use client';

import { useEffect, useRef, useState } from 'react';
import type { PluginTokens } from '../../../types/presentation';

interface Props {
  value: number;        // 0–100
  label: string;
  description?: string;
  /** Override label rendering with a custom node (e.g. InlineEditable wrapper) */
  labelNode?: React.ReactNode;
  /** Override description rendering with a custom node (e.g. InlineEditable wrapper) */
  descriptionNode?: React.ReactNode;
  size?: number;        // diameter in px, default 140
  strokeWidth?: number; // default 10
  tokens: PluginTokens;
  delay?: number;
}

export function CircularProgress({ value, label, description, labelNode, descriptionNode, size = 140, strokeWidth = 10, tokens, delay = 0 }: Props) {
  const [animated, setAnimated] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (animated / 100) * circumference;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          const start = performance.now();
          const duration = 1000;
          const raf = (now: number) => {
            const t = Math.min((now - start - delay) / duration, 1);
            if (t < 0) { requestAnimationFrame(raf); return; }
            const eased = 1 - Math.pow(1 - t, 3);
            setAnimated(Math.round(eased * value));
            if (t < 1) requestAnimationFrame(raf);
          };
          requestAnimationFrame(raf);
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, delay]);

  return (
    <div
      ref={ref}
      data-progress-value={value}
      data-progress-size={size}
      data-progress-strokewidth={strokeWidth}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}
    >
      {/* Ring */}
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tokens.border}
            strokeWidth={strokeWidth}
          />
          {/* Progress arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tokens.accent}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.05s linear' }}
          />
        </svg>
        {/* Center text */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
          }}
        >
          <span
            style={{
              fontFamily: `'${tokens.heroFont}', serif`,
              fontWeight: tokens.heroWeight,
              fontSize: `${size * 0.22}px`,
              lineHeight: 1,
              color: tokens.text,
              letterSpacing: '-0.02em',
            }}
          >
            {animated}%
          </span>
        </div>
      </div>

      {/* Label + description */}
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: `'${tokens.bodyFont}', sans-serif`,
            fontWeight: 700,
            fontSize: '0.85rem',
            letterSpacing: '0.06em',
            textTransform: 'uppercase' as const,
            color: tokens.text,
            marginBottom: (description || descriptionNode) ? 6 : 0,
          }}
        >
          {labelNode ?? label}
        </div>
        {(descriptionNode || description) && (
          <div
            style={{
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontWeight: 300,
              fontSize: '0.8rem',
              color: tokens.textMuted,
              lineHeight: 1.5,
              maxWidth: 160,
            }}
          >
            {descriptionNode ?? description}
          </div>
        )}
      </div>
    </div>
  );
}
