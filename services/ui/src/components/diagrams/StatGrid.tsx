'use client';

import { useId } from 'react';
import type { StatGridData } from '../../lib/customDiagramRenderer';
import type { PluginTokens } from '../../types/presentation';

interface Props {
  data: StatGridData;
  tokens: PluginTokens;
}

const STAT_ICONS: Record<string, string> = {
  up:     'M 0,-12 L 10,4 L 4,4 L 4,12 L -4,12 L -4,4 L -10,4 Z',
  down:   'M 0,12 L 10,-4 L 4,-4 L 4,-12 L -4,-12 L -4,-4 L -10,-4 Z',
  check:  'M -10,0 L -4,8 L 10,-8',
  star:   'M 0,-12 L 3,-4 L 11,-4 L 5,2 L 7,12 L 0,7 L -7,12 L -5,2 L -11,-4 L -3,-4 Z',
  people: 'M -8,-10 m -4,0 a 4,4 0 1,0 8,0 a 4,4 0 1,0 -8,0 M -12,6 C -12,-1 -4,-1 -4,6 M 4,-10 m -4,0 a 4,4 0 1,0 8,0 a 4,4 0 1,0 -8,0 M 0,6 C 0,-1 8,-1 8,6',
  time:   'M 0,-12 m -12,0 a 12,12 0 1,0 24,0 a 12,12 0 1,0 -24,0 M 0,-12 L 0,0 L 7,5',
  money:  'M 0,-12 V 12 M -8,-6 C -8,-10 8,-10 8,-3 C 8,3 -8,3 -8,9 C -8,14 8,14 8,9',
  growth: 'M -12,8 L -4,-4 L 4,2 L 12,-10 M 12,-10 L 7,-10 M 12,-10 L 12,-5',
};

export function StatGrid({ data, tokens }: Props) {
  const uid = useId();
  if (!data?.stats?.length) return null;
  const stats = data.stats.slice(0, 6);
  const n = stats.length;
  const cols = n <= 3 ? n : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);

  const VW = 800;
  const cardW = (VW - 40) / cols - 16;
  const cardH = 140;
  const gap = 16;
  const VH = rows * (cardH + gap) + 40;
  const gradId = `sg-grad-${uid}`;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" xmlns="http://www.w3.org/2000/svg" aria-label="Key statistics">
      <defs>
        <radialGradient id={gradId} cx="30%" cy="30%" r="70%">
          <stop offset="0%" stopColor={tokens.accent} stopOpacity="0.18" />
          <stop offset="100%" stopColor={tokens.accent} stopOpacity="0.04" />
        </radialGradient>
      </defs>

      {stats.map((stat, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = 20 + col * (cardW + gap) + cardW / 2;
        const cardX = 20 + col * (cardW + gap);
        const cardY = 20 + row * (cardH + gap);
        const iconPath = STAT_ICONS[stat.icon ?? 'star'] ?? STAT_ICONS['star'];
        const isUp = stat.trend === 'up';
        const isDown = stat.trend === 'down';

        return (
          <g key={i}>
            <rect x={cardX} y={cardY} width={cardW} height={cardH} rx={10}
              fill={tokens.surfaceCard ?? tokens.surface} stroke={tokens.accent} strokeOpacity={0.2} strokeWidth={1} />
            <rect x={cardX} y={cardY} width={cardW} height={cardH} rx={10} fill={`url(#${gradId})`} />
            <g transform={`translate(${cardX + 22}, ${cardY + 36})`} opacity={0.7}>
              <path d={iconPath} stroke={tokens.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </g>
            <text x={cx + 10} y={cardY + 54} textAnchor="middle" fontSize={32} fontWeight={800}
              fill={tokens.accent} fontFamily={`'${tokens.heroFont ?? tokens.bodyFont}', sans-serif`}>
              {stat.value}
            </text>
            {(isUp || isDown) && (
              <text x={cardX + cardW - 16} y={cardY + 50} textAnchor="middle" fontSize={18}
                fill={isUp ? '#4ade80' : '#f87171'}>
                {isUp ? '↑' : '↓'}
              </text>
            )}
            <text x={cx} y={cardY + 86} textAnchor="middle" fontSize={14} fontWeight={600}
              fill={tokens.text} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
              {stat.label.length > 24 ? stat.label.slice(0, 23) + '…' : stat.label}
            </text>
            {stat.sublabel && (
              <text x={cx} y={cardY + 108} textAnchor="middle" fontSize={12}
                fill={tokens.textMuted ?? tokens.textSubtle} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
                {stat.sublabel}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
