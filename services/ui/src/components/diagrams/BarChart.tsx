'use client';

import type { BarChartData } from '../../lib/customDiagramRenderer';
import type { PluginTokens } from '../../types/presentation';

interface Props {
  data: BarChartData;
  tokens: PluginTokens;
}

export function BarChart({ data, tokens }: Props) {
  if (!data?.bars?.length) return null;
  const bars = data.bars.slice(0, 8);
  const n = bars.length;

  const VW = 800;
  const paddingL = 70;
  const paddingR = 30;
  const paddingTop = 52;
  const paddingBottom = 100;
  const chartH = 220;
  const VH = paddingTop + chartH + paddingBottom;
  const chartW = VW - paddingL - paddingR;
  const barGap = 14;
  const barW = Math.max((chartW / n) - barGap, 24);
  const maxVal = Math.max(...bars.map(b => b.value ?? 0), 1);
  const getBarH = (val: number) => (val / maxVal) * chartH;
  const getBarX = (i: number) => paddingL + i * (chartW / n) + barGap / 2;
  const baseY = paddingTop + chartH;

  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => Math.round((maxVal / tickCount) * i));

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" xmlns="http://www.w3.org/2000/svg" aria-label={data.title ?? 'Bar chart'}>
      {data.title && (
        <text x={VW / 2} y={28} textAnchor="middle" fontSize={18} fontWeight={700} fill={tokens.text} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
          {data.title}
        </text>
      )}

      <line x1={paddingL} y1={paddingTop} x2={paddingL} y2={baseY} stroke={tokens.border ?? '#ccc'} strokeWidth={1} />
      <line x1={paddingL} y1={baseY} x2={VW - paddingR} y2={baseY} stroke={tokens.border ?? '#ccc'} strokeWidth={1} />

      {ticks.map((tick, i) => {
        const y = baseY - (tick / maxVal) * chartH;
        return (
          <g key={i}>
            <line x1={paddingL - 4} y1={y} x2={VW - paddingR} y2={y} stroke={tokens.border ?? '#ddd'} strokeWidth={0.5} strokeOpacity={0.5} />
            <text x={paddingL - 10} y={y + 5} textAnchor="end" fontSize={13} fill={tokens.textMuted ?? tokens.textSubtle} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
              {tick}{data.unit ?? ''}
            </text>
          </g>
        );
      })}

      {bars.map((bar, i) => {
        const bh = getBarH(bar.value ?? 0);
        const bx = getBarX(i);
        const by = baseY - bh;
        return (
          <g key={i}>
            <rect x={bx} y={by} width={barW} height={bh} rx={4}
              fill={(bar.highlight ?? false) ? tokens.accent : (tokens.accentDim ?? `${tokens.accent}88`)} opacity={0.9} />
            <text x={bx + barW / 2} y={by - 8} textAnchor="middle" fontSize={13} fontWeight={700}
              fill={tokens.text} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
              {bar.value}{data.unit ?? ''}
            </text>
            <text x={bx + barW / 2} y={baseY + 22} textAnchor="middle" fontSize={13} fontWeight={600}
              fill={tokens.text} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
              {bar.label.length > 13 ? bar.label.slice(0, 12) + '…' : bar.label}
            </text>
            {bar.sublabel && (
              <text x={bx + barW / 2} y={baseY + 40} textAnchor="middle" fontSize={11}
                fill={tokens.textMuted ?? tokens.textSubtle} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
                {bar.sublabel}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
