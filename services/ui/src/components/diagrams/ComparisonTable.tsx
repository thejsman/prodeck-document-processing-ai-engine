'use client';

import type { ComparisonTableData } from '../../lib/customDiagramRenderer';
import type { PluginTokens } from '../../types/presentation';

interface Props {
  data: ComparisonTableData;
  tokens: PluginTokens;
}

export function ComparisonTable({ data, tokens }: Props) {
  if (!data?.features?.length || !data?.options?.length) return null;
  const features = data.features.slice(0, 10);
  const options = data.options.slice(0, 4);

  const VW = 800;
  const rowH = 46;
  const headerH = 62;
  const featureColW = 290;
  const optionColW = (VW - featureColW - 20) / options.length;
  const VH = headerH + features.length * rowH + 30;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" xmlns="http://www.w3.org/2000/svg" aria-label={data.title ?? 'Comparison table'}>
      {data.title && (
        <text x={VW / 2} y={22} textAnchor="middle" fontSize={17} fontWeight={700} fill={tokens.text} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
          {data.title}
        </text>
      )}

      <rect x={10} y={data.title ? 30 : 8} width={VW - 20} height={headerH - 8} rx={6} fill={tokens.accent} opacity={0.9} />

      <text x={24} y={(data.title ? 30 : 8) + headerH / 2 + 5} fontSize={14} fontWeight={700} fill="white" fontFamily={`'${tokens.bodyFont}', sans-serif`}>
        Feature
      </text>

      {options.map((opt, i) => {
        const ox = featureColW + i * optionColW + optionColW / 2;
        return (
          <text key={i} x={ox} y={(data.title ? 30 : 8) + headerH / 2 + 5}
            textAnchor="middle" fontSize={14} fontWeight={700} fill="white" fontFamily={`'${tokens.bodyFont}', sans-serif`}>
            {opt.name.length > 13 ? opt.name.slice(0, 12) + '…' : opt.name}
          </text>
        );
      })}

      {features.map((feature, fi) => {
        const rowY = (data.title ? 30 : 8) + headerH + fi * rowH;
        const isEven = fi % 2 === 0;
        return (
          <g key={fi}>
            <rect x={10} y={rowY} width={VW - 20} height={rowH} rx={4}
              fill={isEven ? (tokens.surfaceCard ?? tokens.surface) : 'transparent'} fillOpacity={isEven ? 0.5 : 0} />
            <text x={24} y={rowY + rowH / 2 + 5} fontSize={14} fill={tokens.text} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
              {feature.length > 34 ? feature.slice(0, 33) + '…' : feature}
            </text>
            {options.map((opt, oi) => {
              const val = opt.values?.[fi];
              const ox = featureColW + oi * optionColW + optionColW / 2;
              if (typeof val === 'boolean') {
                return (
                  <text key={oi} x={ox} y={rowY + rowH / 2 + 6} textAnchor="middle" fontSize={18}
                    fill={val ? '#4ade80' : '#f87171'}>
                    {val ? '✓' : '✗'}
                  </text>
                );
              }
              return (
                <text key={oi} x={ox} y={rowY + rowH / 2 + 5} textAnchor="middle" fontSize={13}
                  fill={tokens.text} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
                  {String(val ?? '—')}
                </text>
              );
            })}
          </g>
        );
      })}

      <line x1={10} y1={VH - 10} x2={VW - 10} y2={VH - 10} stroke={tokens.border ?? '#ddd'} strokeWidth={0.5} strokeOpacity={0.5} />
    </svg>
  );
}
