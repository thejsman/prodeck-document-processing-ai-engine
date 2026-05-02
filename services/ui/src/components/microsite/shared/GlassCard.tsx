'use client';

import { useRef, useState } from 'react';
import type { PluginTokens } from '../../../types/presentation';
import { useMicrositeEffects } from './MicrositeEffectsContext';

interface Props {
  children: React.ReactNode;
  tokens: PluginTokens;
  style?: React.CSSProperties;
}

export function GlassCard({ children, tokens, style }: Props) {
  const { hoverStyle } = useMicrositeEffects();
  const [hovered, setHovered] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (hoverStyle !== 'tilt') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: y * -8, y: x * 8 });
  };

  const handleMouseLeave = () => {
    setHovered(false);
    setTilt({ x: 0, y: 0 });
  };

  // Build transform based on hover style
  let transform = 'translateY(0)';
  let boxShadow = tokens.cardShadow;
  let borderColor = tokens.border;
  let background = `linear-gradient(135deg, ${tokens.accent}08 0%, ${tokens.surfaceCard} 40%)`;

  if (hovered) {
    borderColor = `${tokens.accent}50`;
    background = tokens.surfaceCard;

    switch (hoverStyle) {
      case 'tilt':
        transform = `perspective(600px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) translateY(-4px)`;
        boxShadow = `${tokens.cardShadowHover}, 0 0 40px ${tokens.accent}15`;
        break;
      case 'glow':
        transform = 'translateY(-4px)';
        boxShadow = `${tokens.cardShadowHover}, 0 0 60px ${tokens.accent}30, 0 0 20px ${tokens.accent}20`;
        break;
      case 'subtle':
        transform = 'translateY(-2px)';
        boxShadow = tokens.cardShadowHover;
        break;
      case 'none':
        transform = 'none';
        boxShadow = tokens.cardShadow;
        borderColor = tokens.border;
        break;
      default: // 'lift'
        transform = 'translateY(-4px)';
        boxShadow = `${tokens.cardShadowHover}, 0 0 40px ${tokens.accent}15`;
    }
  }

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      style={{
        padding: '32px 28px',
        borderRadius: 16,
        border: `1px solid ${borderColor}`,
        background,
        backdropFilter: 'blur(12px)',
        boxShadow,
        transform,
        transition: hoverStyle === 'tilt' && hovered
          ? 'box-shadow 0.3s ease, border-color 0.3s ease, background 0.3s ease'
          : 'transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease, background 0.3s ease',
        height: '100%',
        willChange: hoverStyle === 'tilt' ? 'transform' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
