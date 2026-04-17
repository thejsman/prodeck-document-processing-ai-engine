'use client';

import type { TimelineBarData } from '../../lib/customDiagramRenderer';
import type { PluginTokens } from '../../types/presentation';

interface Props {
  data: TimelineBarData;
  tokens: PluginTokens;
}

export function TimelineBar({ data, tokens }: Props) {
  if (!data?.phases?.length) return null;
  const phases = data.phases.slice(0, 8);
  const n = phases.length;

  const VW = 900;
  const rowH = 62;
  const labelW = 240;
  const barAreaX = labelW + 24;
  const barAreaW = VW - barAreaX - 24;
  const VH = 80 + n * rowH + 40;

  const totalWeeks = Math.max(...phases.map(p => (p.startWeek ?? 0) + (p.durationWeeks ?? 1)), 1);
  const getX = (week: number) => barAreaX + (week / totalWeeks) * barAreaW;
  const getW = (dur: number) => Math.max((dur / totalWeeks) * barAreaW, 28);

  const shades = [tokens.accent, tokens.accentDim ?? `${tokens.accent}bb`, `${tokens.accent}88`, `${tokens.accent}66`];

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" xmlns="http://www.w3.org/2000/svg" aria-label="Project timeline">
      <text x={barAreaX} y={34} fontSize={13} fontWeight={600}
        fill={tokens.textSubtle ?? tokens.textMuted} fontFamily={`'${tokens.bodyFont}', sans-serif`} letterSpacing="0.08em">
        WEEKS →
      </text>

      {Array.from({ length: Math.min(totalWeeks + 1, 13) }, (_, i) => {
        const interval = Math.ceil(totalWeeks / 12);
        const week = i * interval;
        if (week > totalWeeks) return null;
        const x = getX(week);
        return (
          <g key={i}>
            <line x1={x} y1={46} x2={x} y2={VH - 20} stroke={tokens.border ?? '#ddd'} strokeWidth={0.5} strokeOpacity={0.6} />
            <text x={x} y={54} textAnchor="middle" fontSize={12} fill={tokens.textSubtle ?? tokens.textMuted} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
              {week}
            </text>
          </g>
        );
      })}

      {phases.map((phase, i) => {
        const y = 66 + i * rowH;
        const barX = getX(phase.startWeek ?? 0);
        const barW = getW(phase.durationWeeks ?? 2);
        const fill = shades[i % shades.length];
        const barY = y + 8;
        const barH = 34;

        return (
          <g key={i}>
            <text x={labelW} y={barY + 22} textAnchor="end" fontSize={14} fontWeight={600}
              fill={tokens.text} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
              {phase.name.length > 26 ? phase.name.slice(0, 25) + '…' : phase.name}
            </text>
            <rect x={barAreaX} y={barY} width={barAreaW} height={barH} rx={4} fill={tokens.border ?? '#eee'} fillOpacity={0.3} />
            <rect x={barX} y={barY} width={barW} height={barH} rx={4} fill={fill} opacity={0.9} />
            {barW > 54 && (
              <text x={barX + barW / 2} y={barY + 22} textAnchor="middle" fontSize={12} fontWeight={600}
                fill="white" fontFamily={`'${tokens.bodyFont}', sans-serif`}>
                {phase.durationWeeks}w
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
