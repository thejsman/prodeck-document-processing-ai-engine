'use client';

import type { DonutChartData } from '../../lib/customDiagramRenderer';
import type { PluginTokens } from '../../types/presentation';

interface Props {
  data: DonutChartData;
  tokens: PluginTokens;
}

function polarToCart(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function segmentPath(cx: number, cy: number, outerR: number, innerR: number, startDeg: number, endDeg: number): string {
  const s1 = polarToCart(cx, cy, outerR, startDeg);
  const e1 = polarToCart(cx, cy, outerR, endDeg);
  const s2 = polarToCart(cx, cy, innerR, endDeg);
  const e2 = polarToCart(cx, cy, innerR, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return [`M ${s1.x},${s1.y}`,`A ${outerR},${outerR} 0 ${large} 1 ${e1.x},${e1.y}`,`L ${s2.x},${s2.y}`,`A ${innerR},${innerR} 0 ${large} 0 ${e2.x},${e2.y}`,'Z'].join(' ');
}

export function DonutChart({ data, tokens }: Props) {
  if (!data?.segments?.length) return null;
  const segments = data.segments.slice(0, 8);

  const VW = 700;
  const VH = 400;
  const cx = 200;
  const cy = 200;
  const outerR = 155;
  const innerR = 92;

  const opacities = [1, 0.75, 0.55, 0.4, 0.3, 0.22, 0.16, 0.12];
  const colors = segments.map((_, i) => {
    if (i === 0) return tokens.accent;
    if (i === 1) return tokens.accentDim ?? `${tokens.accent}bb`;
    return `${tokens.accent}${Math.round(opacities[i] * 255).toString(16).padStart(2, '0')}`;
  });

  let cumAngle = 0;
  const arcs = segments.map((seg) => {
    const total = segments.reduce((a, s) => a + (s.value ?? 0), 0) || 1;
    const pct = seg.percentage ?? ((seg.value ?? 0) / total) * 100;
    const sweep = (pct / 100) * 360;
    const start = cumAngle;
    cumAngle += sweep;
    return { seg, start, end: cumAngle };
  });

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" xmlns="http://www.w3.org/2000/svg" aria-label={data.title ?? 'Donut chart'}>
      {arcs.map(({ start, end }, i) => (
        <path key={i} d={segmentPath(cx, cy, outerR, innerR, start, end)} fill={colors[i]} stroke={tokens.bg ?? tokens.surface} strokeWidth={2} />
      ))}

      <text x={cx} y={cy - 10} textAnchor="middle" fontSize={20} fontWeight={700} fill={tokens.text} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
        {data.total ?? ''}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize={14} fill={tokens.textMuted ?? tokens.textSubtle} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
        {data.title ?? 'Total'}
      </text>

      {arcs.map(({ seg }, i) => {
        const lx = 380;
        const ly = 56 + i * 40;
        return (
          <g key={i}>
            <rect x={lx} y={ly - 11} width={18} height={18} rx={3} fill={colors[i]} />
            <text x={lx + 28} y={ly + 4} fontSize={15} fontWeight={600} fill={tokens.text} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
              {seg.label}
            </text>
            <text x={lx + 28} y={ly + 20} fontSize={13} fill={tokens.textMuted ?? tokens.textSubtle} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
              {seg.percentage != null ? `${Math.round(seg.percentage)}%` : ''}
              {(seg.value ?? null) != null ? `  ${seg.value}` : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
