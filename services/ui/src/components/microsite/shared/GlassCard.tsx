'use client';

import { useState } from 'react';
import type { PluginTokens } from '../../../types/presentation';

interface Props {
  children: React.ReactNode;
  tokens: PluginTokens;
  style?: React.CSSProperties;
}

export function GlassCard({ children, tokens, style }: Props) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '32px 28px',
        borderRadius: 16,
        border: `1px solid ${hovered ? tokens.accent + '50' : tokens.border}`,
        background: hovered
          ? tokens.surfaceCard
          : `linear-gradient(135deg, ${tokens.accent}08 0%, ${tokens.surfaceCard} 40%)`,
        backdropFilter: 'blur(12px)',
        boxShadow: hovered
          ? `${tokens.cardShadowHover}, 0 0 40px ${tokens.accent}15`
          : tokens.cardShadow,
        transform: hovered ? 'translateY(-4px)' : 'translateY(0)',
        transition: 'transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease, background 0.3s ease',
        height: '100%',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
