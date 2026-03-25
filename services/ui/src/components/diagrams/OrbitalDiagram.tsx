'use client';

import type { OrbitalDiagramData } from '../../lib/customDiagramRenderer';
import type { PluginTokens } from '../../types/presentation';

interface Props {
  data: OrbitalDiagramData;
  tokens: PluginTokens;
}

// Satellite layout: card center (x, y) and connector angle in degrees
const SATELLITE_LAYOUT: Record<
  'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left' | 'right',
  { cx: number; cy: number; angle: number }
> = {
  'top-left':     { cx: 150, cy: 95,  angle: 225 },
  'top-right':    { cx: 650, cy: 95,  angle: 315 },
  'bottom-left':  { cx: 150, cy: 405, angle: 135 },
  'bottom-right': { cx: 650, cy: 405, angle: 45  },
  'left':         { cx: 80,  cy: 250, angle: 180 },
  'right':        { cx: 720, cy: 250, angle: 0   },
};

const OUTER_RING_R = 175;
const CENTER_X = 400;
const CENTER_Y = 250;
const CARD_W = 175;
const CARD_H = 85;

function getConnectorPoint(angle: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return {
    x: CENTER_X + OUTER_RING_R * Math.cos(rad),
    y: CENTER_Y + OUTER_RING_R * Math.sin(rad),
  };
}

// Find nearest card edge point from connector to the card rect
function getNearestCardEdge(
  connX: number,
  connY: number,
  cardCx: number,
  cardCy: number,
): { x: number; y: number } {
  const left   = cardCx - CARD_W / 2;
  const right  = cardCx + CARD_W / 2;
  const top    = cardCy - CARD_H / 2;
  const bottom = cardCy + CARD_H / 2;

  // Clamp connector direction to card boundary
  const dx = connX - cardCx;
  const dy = connY - cardCy;

  // Determine which side the connector exits from
  const scaleX = dx !== 0 ? (CARD_W / 2) / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? (CARD_H / 2) / Math.abs(dy) : Infinity;

  if (scaleX < scaleY) {
    return {
      x: dx > 0 ? right : left,
      y: cardCy + dy * scaleX,
    };
  }
  return {
    x: cardCx + dx * scaleY,
    y: dy > 0 ? bottom : top,
  };
}

// Truncate description to ~2 lines of ~22 chars each
function truncate(text: string, maxChars = 44): string {
  return text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
}

// Split description into two lines at nearest word boundary
function splitLines(text: string): [string, string] {
  const truncated = truncate(text, 44);
  const mid = Math.floor(truncated.length / 2);
  let split = mid;
  // Seek nearest space
  for (let i = 0; i < 10; i++) {
    if (truncated[mid - i] === ' ') { split = mid - i; break; }
    if (truncated[mid + i] === ' ') { split = mid + i; break; }
  }
  return [truncated.slice(0, split).trim(), truncated.slice(split).trim()];
}

export function OrbitalDiagram({ data, tokens }: Props) {
  if (!data || !data.center || !Array.isArray(data.satellites)) return null;

  const satellites = data.satellites.slice(0, 6);
  if (satellites.length < 1) return null;

  return (
    <svg
      viewBox="0 0 800 500"
      width="100%"
      xmlns="http://www.w3.org/2000/svg"
      aria-label={`Orbital diagram: ${data.center.title}`}
    >
      {/* Gradient for center circle */}
      <defs>
        <radialGradient id="orbital-center-grad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={tokens.accent} stopOpacity="1" />
          <stop offset="100%" stopColor={tokens.accentDim || tokens.accent} stopOpacity="0.8" />
        </radialGradient>
      </defs>

      {/* Outer ring */}
      <circle
        cx={CENTER_X} cy={CENTER_Y} r={OUTER_RING_R}
        stroke={tokens.accent} strokeOpacity={0.15} strokeWidth={1} fill="none"
      />

      {/* Inner ring */}
      <circle
        cx={CENTER_X} cy={CENTER_Y} r={130}
        stroke={tokens.accent} strokeOpacity={0.3} strokeWidth={1.5} fill="none"
      />

      {/* Satellite connectors and cards */}
      {satellites.map((sat, i) => {
        const layout = SATELLITE_LAYOUT[sat.position];
        if (!layout) return null;

        const conn = getConnectorPoint(layout.angle);
        const edge = getNearestCardEdge(conn.x, conn.y, layout.cx, layout.cy);

        const cardLeft = layout.cx - CARD_W / 2;
        const cardTop  = layout.cy - CARD_H / 2;
        const [line1, line2] = splitLines(sat.description ?? '');

        return (
          <g key={i}>
            {/* Connector line */}
            <line
              x1={conn.x} y1={conn.y}
              x2={edge.x} y2={edge.y}
              stroke={tokens.accent} strokeOpacity={0.45} strokeWidth={1.5}
              strokeDasharray="4 3"
            />

            {/* Connector dot on ring */}
            <circle
              cx={conn.x} cy={conn.y} r={6}
              fill={tokens.bg} stroke={tokens.accent} strokeWidth={2}
            />

            {/* Satellite card */}
            <rect
              x={cardLeft} y={cardTop}
              width={CARD_W} height={CARD_H}
              rx={10}
              fill={tokens.surfaceCard || tokens.surface}
              stroke={tokens.accent} strokeOpacity={0.4} strokeWidth={1}
            />

            {/* Card title */}
            <text
              x={layout.cx} y={cardTop + 26}
              textAnchor="middle"
              fontSize={13}
              fontWeight={700}
              fill={tokens.text}
              fontFamily={`'${tokens.bodyFont}', sans-serif`}
            >
              {sat.title}
            </text>

            {/* Card description — line 1 */}
            {line1 && (
              <text
                x={layout.cx} y={cardTop + 44}
                textAnchor="middle"
                fontSize={11}
                fill={tokens.textMuted}
                fontFamily={`'${tokens.bodyFont}', sans-serif`}
              >
                {line1}
              </text>
            )}

            {/* Card description — line 2 */}
            {line2 && (
              <text
                x={layout.cx} y={cardTop + 58}
                textAnchor="middle"
                fontSize={11}
                fill={tokens.textMuted}
                fontFamily={`'${tokens.bodyFont}', sans-serif`}
              >
                {line2}
              </text>
            )}
          </g>
        );
      })}

      {/* Center circle */}
      <circle
        cx={CENTER_X} cy={CENTER_Y} r={90}
        fill="url(#orbital-center-grad)"
      />

      {/* Center title */}
      <text
        x={CENTER_X} y={CENTER_Y - 3}
        textAnchor="middle"
        fontSize={14}
        fontWeight={700}
        fill="white"
        fontFamily={`'${tokens.bodyFont}', sans-serif`}
      >
        {data.center.title}
      </text>

      {/* Center subtitle */}
      <text
        x={CENTER_X} y={CENTER_Y + 16}
        textAnchor="middle"
        fontSize={10}
        fill="rgba(255,255,255,0.75)"
        fontFamily={`'${tokens.bodyFont}', sans-serif`}
      >
        {data.center.subtitle}
      </text>
    </svg>
  );
}
