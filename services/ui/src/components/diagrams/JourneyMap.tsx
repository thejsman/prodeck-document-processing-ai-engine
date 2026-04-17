'use client';

import { useId } from 'react';
import type { JourneyMapData } from '../../lib/customDiagramRenderer';
import type { PluginTokens } from '../../types/presentation';

interface Props {
  data: JourneyMapData;
  tokens: PluginTokens;
}

const SENTIMENT_COLOR = { positive: '#4ade80', neutral: '#facc15', negative: '#f87171' };

export function JourneyMap({ data, tokens }: Props) {
  const uid = useId();
  if (!data?.stages?.length) return null;
  const stages = data.stages.slice(0, 6);
  const n = stages.length;

  const VW = 900;
  const stageW = (VW - 40) / n;
  const headerH = 76;
  const activityH = 38;
  const maxActivities = Math.max(...stages.map(s => s.activities?.length ?? 0), 1);
  const VH = headerH + maxActivities * activityH + 68;
  const arrowId = `jm-arrow-${uid}`;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" xmlns="http://www.w3.org/2000/svg" aria-label="Customer journey map">
      <defs>
        <marker id={arrowId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L9,3 Z" fill={tokens.accent} opacity={0.5} />
        </marker>
      </defs>

      {stages.map((stage, i) => {
        const sx = 20 + i * stageW;
        const sentimentColor = SENTIMENT_COLOR[stage.sentiment ?? 'neutral'];
        return (
          <g key={i}>
            <rect x={sx + 4} y={8} width={stageW - 8} height={headerH - 18} rx={8} fill={tokens.accent} opacity={0.85 - i * 0.08} />
            <text x={sx + stageW / 2} y={headerH / 2 - 2} textAnchor="middle" fontSize={14} fontWeight={700}
              fill="white" fontFamily={`'${tokens.bodyFont}', sans-serif`}>
              {stage.name.length > 15 ? stage.name.slice(0, 14) + '…' : stage.name}
            </text>
            <circle cx={sx + stageW / 2} cy={headerH - 8} r={8} fill={sentimentColor} />

            {(stage.activities ?? []).slice(0, 6).map((act, ai) => {
              const ay = headerH + ai * activityH + 8;
              return (
                <g key={ai}>
                  <rect x={sx + 4} y={ay} width={stageW - 8} height={activityH - 5} rx={4}
                    fill={tokens.surfaceCard ?? tokens.surface} stroke={tokens.border ?? '#ddd'} strokeWidth={0.5} strokeOpacity={0.5} />
                  <text x={sx + stageW / 2} y={ay + 20} textAnchor="middle" fontSize={12}
                    fill={tokens.text} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
                    {act.length > 18 ? act.slice(0, 17) + '…' : act}
                  </text>
                </g>
              );
            })}

            {i < n - 1 && (
              <line x1={sx + stageW} y1={8} x2={sx + stageW} y2={VH - 20}
                stroke={tokens.border ?? '#ddd'} strokeWidth={0.5} strokeOpacity={0.4} strokeDasharray="4 3" />
            )}
          </g>
        );
      })}

      {stages.length > 1 && (
        <path d={`M ${20 + stageW / 2},${VH - 18} L ${20 + stageW * (n - 0.5)},${VH - 18}`}
          stroke={tokens.accent} strokeOpacity={0.4} strokeWidth={2} markerEnd={`url(#${arrowId})`} fill="none" />
      )}
    </svg>
  );
}
