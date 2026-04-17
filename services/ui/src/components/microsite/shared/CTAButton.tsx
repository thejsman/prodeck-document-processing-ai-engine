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
}

export function CTAButton({ children, tokens, variant = 'primary', style, onClick, targetSectionId, showArrow = true }: CTAButtonProps) {
  const [hovered, setHovered] = useState(false);
  const isPrimary = variant === 'primary';

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
        border: isPrimary ? 'none' : `1px solid ${hovered ? tokens.accent + '80' : tokens.border}`,
        background: isPrimary ? tokens.accent : 'transparent',
        color: isPrimary ? (tokens.dark ? tokens.bg : '#FFFFFF') : (hovered ? tokens.accent : tokens.textMuted),
        fontFamily: `'${tokens.bodyFont}', sans-serif`,
        fontWeight: 600,
        fontSize: '0.9rem',
        letterSpacing: '0.02em',
        cursor: 'pointer',
        minHeight: 44,
        boxShadow: isPrimary && hovered
          ? `0 0 0 1px ${tokens.accent}40, 0 4px 20px ${tokens.glowColor}`
          : 'none',
        transform: hovered ? 'scale(1.03) translateY(-1px)' : 'scale(1) translateY(0)',
        transition: 'transform 0.25s ease, box-shadow 0.25s ease, color 0.2s ease, border-color 0.2s ease, background 0.2s ease',
        ...style,
      }}
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
