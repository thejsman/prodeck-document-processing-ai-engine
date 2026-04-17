'use client';

import { useId } from 'react';
import type { StepsFlowData } from '../../lib/customDiagramRenderer';
import type { PluginTokens } from '../../types/presentation';

interface Props {
  data: StepsFlowData;
  tokens: PluginTokens;
}

const WRAP = 22;

function wrapText(text: string, maxChars = WRAP): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

export function StepsFlow({ data, tokens }: Props) {
  const uid = useId();
  if (!data?.steps?.length) return null;
  const steps = data.steps.slice(0, 6);
  const n = steps.length;

  const VW = 900;
  const VH = 380;
  const paddingX = 50;
  const stepW = (VW - paddingX * 2) / n;
  const circleCY = 80;
  const circleR = 32;
  const cardTop = circleCY + circleR + 20;
  const cardH = 155;
  const cardW = Math.min(stepW - 16, 152);
  const gradId = `sf-accent-grad-${uid}`;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" xmlns="http://www.w3.org/2000/svg" aria-label={`Steps: ${steps.map(s => s.title).join(', ')}`}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={tokens.accent} stopOpacity="1" />
          <stop offset="100%" stopColor={tokens.accentDim ?? tokens.accent} stopOpacity="0.8" />
        </linearGradient>
      </defs>

      {n > 1 && (
        <line x1={paddingX + stepW / 2} y1={circleCY} x2={paddingX + stepW * (n - 0.5)} y2={circleCY}
          stroke={tokens.accent} strokeOpacity={0.25} strokeWidth={2} strokeDasharray="6 4" />
      )}

      {steps.map((step, i) => {
        const cx = paddingX + stepW * i + stepW / 2;
        const cardX = cx - cardW / 2;
        const descLines = wrapText(step.description ?? '', WRAP);
        const isActive = i === 0;

        return (
          <g key={i}>
            {i > 0 && (
              <polygon
                points={`${cx - stepW / 2 + 2},${circleCY - 8} ${cx - stepW / 2 + 2},${circleCY + 8} ${cx - circleR - 6},${circleCY}`}
                fill={tokens.accent} opacity={0.5} />
            )}
            <circle cx={cx} cy={circleCY} r={circleR}
              fill={isActive ? `url(#${gradId})` : (tokens.surfaceCard ?? tokens.surface)}
              stroke={tokens.accent} strokeWidth={isActive ? 0 : 1.5} strokeOpacity={0.6} />
            <text x={cx} y={circleCY + 7} textAnchor="middle" fontSize={20} fontWeight={700}
              fill={isActive ? 'white' : tokens.accent} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
              {i + 1}
            </text>
            <rect x={cardX} y={cardTop} width={cardW} height={cardH} rx={8}
              fill={tokens.surfaceCard ?? tokens.surface}
              stroke={tokens.accent} strokeOpacity={isActive ? 0.6 : 0.25} strokeWidth={isActive ? 1.5 : 1} />
            <text x={cx} y={cardTop + 28} textAnchor="middle" fontSize={14} fontWeight={700}
              fill={tokens.text} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
              {step.title.length > 20 ? step.title.slice(0, 19) + '…' : step.title}
            </text>
            {descLines.map((line, li) => (
              <text key={li} x={cx} y={cardTop + 54 + li * 20} textAnchor="middle" fontSize={12}
                fill={tokens.textMuted ?? tokens.textSubtle} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
