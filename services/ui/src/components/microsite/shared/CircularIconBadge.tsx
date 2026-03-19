'use client';

import type { PluginTokens } from '../../../types/presentation';
import { SectionIcon } from './SectionIcon';

interface Props {
  hint: string;
  tokens: PluginTokens;
  size?: number;
}

export function CircularIconBadge({ hint, tokens, size = 52 }: Props) {
  const iconSize = Math.round(size * 0.5);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: tokens.iconBg ?? tokens.surfaceCard,
        border: `1px solid ${tokens.accent}33`,
        boxShadow: `inset 0 1px 4px ${tokens.accent}18, 0 1px 2px ${tokens.accent}10`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <SectionIcon hint={hint} color={tokens.accent} size={iconSize} />
    </div>
  );
}
