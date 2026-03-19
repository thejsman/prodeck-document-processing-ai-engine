'use client';

import type { PluginTokens } from '../../../types/presentation';

interface Props {
  tokens: PluginTokens;
  variant?: 'gradient' | 'wave' | 'angle';
}

export function SectionDivider({ tokens, variant = 'gradient' }: Props) {
  if (variant === 'wave') {
    return (
      <div style={{ position: 'relative', height: 56, overflow: 'hidden', marginTop: -1 }}>
        <svg
          viewBox="0 0 1440 56"
          preserveAspectRatio="none"
          style={{ width: '100%', height: '100%', display: 'block' }}
        >
          <path
            d="M0,28 C360,56 720,0 1080,28 C1260,42 1380,28 1440,28 L1440,56 L0,56 Z"
            fill={tokens.surfaceAlt}
            opacity={0.5}
          />
        </svg>
      </div>
    );
  }

  if (variant === 'angle') {
    return (
      <div
        style={{
          height: 48,
          background: `linear-gradient(170deg, transparent 49.5%, ${tokens.border}20 49.5%, ${tokens.border}20 50.5%, transparent 50.5%)`,
          marginTop: -1,
        }}
      />
    );
  }

  // Default: gradient line
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '0 2rem' }}>
      <div
        style={{
          width: '100%',
          maxWidth: 960,
          height: 1,
          background: `linear-gradient(90deg, transparent 0%, ${tokens.accent}60 30%, ${tokens.accent}60 70%, transparent 100%)`,
        }}
      />
    </div>
  );
}
