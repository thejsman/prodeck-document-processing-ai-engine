'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import type { PluginTokens } from '../../../types/presentation';

interface CTAButtonProps {
  children: React.ReactNode;
  tokens: PluginTokens;
  variant?: 'primary' | 'secondary';
  style?: React.CSSProperties;
  onClick?: () => void;
  targetSectionId?: string;
  showArrow?: boolean;
  /** Pass true when the button sits on a dark background (e.g. hero image with scrim).
   *  Forces light text/border on the secondary variant for guaranteed contrast. */
  onDarkBg?: boolean;
}

export function CTAButton({ children, tokens, variant = 'primary', style, onClick, targetSectionId, showArrow = true, onDarkBg = false }: CTAButtonProps) {
  const [hovered, setHovered] = useState(false);
  const isPrimary = variant === 'primary';

  // Secondary button colors adapt to background lightness:
  // dark bg (image with scrim) → light text/border; light bg → tokens.text/border
  const secondaryIdleText = onDarkBg ? 'rgba(255,255,255,0.85)' : tokens.text;
  const secondaryIdleBorder = onDarkBg ? 'rgba(255,255,255,0.35)' : tokens.border;
  const secondaryHoverBorder = onDarkBg ? 'rgba(255,255,255,0.65)' : tokens.accent + '80';

  const handleClick = () => {
    if (targetSectionId) {
      document.getElementById(targetSectionId)?.scrollIntoView({ behavior: 'smooth' });
    }
    onClick?.();
  };

  return (
    <button
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: isPrimary ? '14px 32px' : '12px 24px',
        borderRadius: 8,
        border: isPrimary ? 'none' : `1px solid ${hovered ? secondaryHoverBorder : secondaryIdleBorder}`,
        background: isPrimary ? tokens.accent : 'transparent',
        color: isPrimary ? (tokens.dark ? tokens.bg : '#FFFFFF') : (hovered ? tokens.accent : secondaryIdleText),
        fontFamily: `'${tokens.bodyFont}', sans-serif`,
        fontWeight: 400,
        fontSize: '0.9rem',
        letterSpacing: '0em',
        lineHeight: 1.5,
        cursor: 'pointer',
        minHeight: 44,
        // When hovered: override with strong directional shadow. When idle: breathing glow animation.
        boxShadow: isPrimary && hovered
          ? `0 0 0 1px ${tokens.accent}40, 0 4px 20px ${tokens.glowColor}`
          : undefined,
        animation: isPrimary && !hovered ? `ms-cta-glow 2.5s ease-in-out infinite` : undefined,
        // @ts-ignore CSS variable
        '--ms-accent-glow': `${tokens.accent}55`,
        transform: hovered ? 'scale(1.03) translateY(-1px)' : 'scale(1) translateY(0)',
        transition: 'transform 0.25s ease, box-shadow 0.25s ease, color 0.2s ease, border-color 0.2s ease, background 0.2s ease',
        ...style,
      } as React.CSSProperties}
    >
      {children}
      {showArrow && (
        <span style={{
          display: 'inline-block',
          transform: hovered ? 'translateX(5px)' : 'translateX(0)',
          transition: 'transform 0.25s ease',
          fontSize: '1.1em',
          lineHeight: 1,
        }}>
          <Icon icon={ArrowRight} size="sm" />
        </span>
      )}
    </button>
  );
}
