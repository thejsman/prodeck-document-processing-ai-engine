'use client';

import type { PuzzleDiagramData } from '../../lib/customDiagramRenderer';
import type { PluginTokens } from '../../types/presentation';

interface Props {
  data: PuzzleDiagramData;
  tokens: PluginTokens;
}

// Piece grid origins (ox, oy)
const PIECE_ORIGINS: Record<
  'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
  { ox: number; oy: number }
> = {
  'top-left':     { ox: 200, oy: 65  },
  'top-right':    { ox: 390, oy: 65  },
  'bottom-left':  { ox: 200, oy: 255 },
  'bottom-right': { ox: 390, oy: 255 },
};

// Tab/socket radius
const TR = 22;
// Piece size
const PS = 190;
// Half-piece
const HS = PS / 2;

/**
 * Generate the SVG path for each puzzle piece at its origin (ox, oy).
 *
 * Interlocking rules:
 *   top-left:     tab-right, tab-bottom,    straight-top,    straight-left
 *   top-right:    socket-left, tab-bottom,  straight-top,    straight-right
 *   bottom-left:  tab-right, socket-top,    straight-bottom, straight-left
 *   bottom-right: socket-left, socket-top,  straight-bottom, straight-right
 *
 * Tab = semicircle bump protruding outward (convex bezier)
 * Socket = corresponding indented shape (concave bezier — same curve, flipped)
 */
function buildPath(position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'): string {
  switch (position) {
    case 'top-left': {
      const ox = 200, oy = 65;
      // straight-top, tab-right (protrudes right), tab-bottom (protrudes down), straight-left
      return [
        `M ${ox},${oy}`,
        `L ${ox + PS},${oy}`,
        // right edge: go to tab position, then tab curve (protrudes right = +x)
        `L ${ox + PS},${oy + HS - TR}`,
        `C ${ox + PS + TR},${oy + HS - TR} ${ox + PS + TR},${oy + HS + TR} ${ox + PS},${oy + HS + TR}`,
        `L ${ox + PS},${oy + PS}`,
        // bottom edge: go to tab position, then tab curve (protrudes down = +y)
        `L ${ox + HS + TR},${oy + PS}`,
        `C ${ox + HS + TR},${oy + PS + TR} ${ox + HS - TR},${oy + PS + TR} ${ox + HS - TR},${oy + PS}`,
        `L ${ox},${oy + PS}`,
        'Z',
      ].join(' ');
    }
    case 'top-right': {
      const ox = 390, oy = 65;
      // straight-top, straight-right, tab-bottom (protrudes down), socket-left (indented left = curves inward toward +x)
      return [
        `M ${ox},${oy}`,
        `L ${ox + PS},${oy}`,
        `L ${ox + PS},${oy + PS}`,
        // bottom edge: tab (protrudes down)
        `L ${ox + HS + TR},${oy + PS}`,
        `C ${ox + HS + TR},${oy + PS + TR} ${ox + HS - TR},${oy + PS + TR} ${ox + HS - TR},${oy + PS}`,
        `L ${ox},${oy + PS}`,
        // left edge: socket (curves inward — control points go right, toward interior)
        `L ${ox},${oy + HS + TR}`,
        `C ${ox - TR},${oy + HS + TR} ${ox - TR},${oy + HS - TR} ${ox},${oy + HS - TR}`,
        'Z',
      ].join(' ');
    }
    case 'bottom-left': {
      const ox = 200, oy = 255;
      // socket-top (indented up = curves inward toward +y), straight-left, straight-bottom, tab-right
      return [
        `M ${ox},${oy}`,
        `L ${ox + HS - TR},${oy}`,
        // top edge: socket (curves inward — control points go down, toward interior)
        `C ${ox + HS - TR},${oy - TR} ${ox + HS + TR},${oy - TR} ${ox + HS + TR},${oy}`,
        `L ${ox + PS},${oy}`,
        // right edge: tab (protrudes right)
        `L ${ox + PS},${oy + HS - TR}`,
        `C ${ox + PS + TR},${oy + HS - TR} ${ox + PS + TR},${oy + HS + TR} ${ox + PS},${oy + HS + TR}`,
        `L ${ox + PS},${oy + PS}`,
        `L ${ox},${oy + PS}`,
        'Z',
      ].join(' ');
    }
    case 'bottom-right': {
      const ox = 390, oy = 255;
      // socket-top, straight-right, straight-bottom, socket-left
      return [
        `M ${ox},${oy}`,
        `L ${ox + HS - TR},${oy}`,
        // top edge: socket (curves inward)
        `C ${ox + HS - TR},${oy - TR} ${ox + HS + TR},${oy - TR} ${ox + HS + TR},${oy}`,
        `L ${ox + PS},${oy}`,
        `L ${ox + PS},${oy + PS}`,
        `L ${ox},${oy + PS}`,
        // left edge: socket (curves inward)
        `L ${ox},${oy + HS + TR}`,
        `C ${ox - TR},${oy + HS + TR} ${ox - TR},${oy + HS - TR} ${ox},${oy + HS - TR}`,
        'Z',
      ].join(' ');
    }
  }
}

// Icon SVG paths relative to (0,0) center, for use with transform="translate(cx,cy)"
const ICON_PATHS: Record<string, string> = {
  gateway:  'M -16,12 C -16,-4 -8,-12 0,-12 C 8,-12 16,-4 16,12',
  monitor:  'M -18,-12 H 18 V 10 H -18 Z M 0,10 V 16 M -8,16 H 8',
  stream:   'M -14,-10 H 14 V 14 H -14 Z M -14,-4 H 14 M -8,-14 V -6 M 8,-14 V -6',
  storage:  'M -16,-8 C -16,-12 16,-12 16,-8 V 8 C 16,12 -16,12 -16,8 Z M -16,-8 C -16,-4 16,-4 16,-8',
  security: 'M 0,-16 L 14,-8 V 4 C 14,12 0,18 0,18 C 0,18 -14,12 -14,4 V -8 Z',
  cloud:    'M -12,6 C -18,6 -20,-2 -14,-6 C -12,-14 2,-16 8,-8 C 16,-12 22,-4 18,4 C 20,10 14,14 8,14 H -8 C -14,14 -18,10 -12,6 Z',
  api:      'M -10,-12 L -18,0 L -10,12 M 10,-12 L 18,0 L 10,12',
  user:     'M 0,-14 m -6,0 a 6,6 0 1,0 12,0 a 6,6 0 1,0 -12,0 M -12,14 C -12,4 12,4 12,14',
  process:  'M 0,0 m -8,0 a 8,8 0 1,0 16,0 a 8,8 0 1,0 -16,0 M 0,-14 L 0,-11 M 0,11 L 0,14 M -14,0 L -11,0 M 11,0 L 14,0 M -10,-10 L -8,-8 M 8,8 L 10,10 M 10,-10 L 8,-8 M -8,8 L -10,10',
  integrate:'M -12,-8 C -4,-12 4,-12 12,-8 M -12,8 C -4,12 4,12 12,8 M 8,-12 L 12,-8 L 8,-4 M -8,4 L -12,8 L -8,12',
  deploy:   'M 0,-16 C 8,-8 8,4 0,12 C -8,4 -8,-8 0,-16 Z M -8,4 L -14,10 M 8,4 L 14,10 M 0,12 L 0,16',
  data:     'M -14,-8 H 14 V 8 H -14 Z M -8,-8 V 8 M 8,-8 V 8 M -14,0 H 14',
};

// Label positions for each piece position
const LABEL_POSITIONS: Record<
  'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
  { x: number; y: number; anchor: 'start' | 'end' | 'middle' }
> = {
  'top-left':     { x: 185, y: 160, anchor: 'end'   },
  'top-right':    { x: 585, y: 160, anchor: 'start' },
  'bottom-left':  { x: 185, y: 350, anchor: 'end'   },
  'bottom-right': { x: 585, y: 350, anchor: 'start' },
};

function getPieceColor(
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
  tokens: PluginTokens,
): string {
  // top-left and bottom-right: full accent; top-right and bottom-left: dimmed
  if (position === 'top-left' || position === 'bottom-right') {
    return tokens.accent;
  }
  return tokens.accentDim || `${tokens.accent}99`;
}

export function PuzzleDiagram({ data, tokens }: Props) {
  if (!data || !Array.isArray(data.pieces)) return null;

  const pieces = data.pieces.slice(0, 4);
  if (pieces.length < 1) return null;

  return (
    <svg
      viewBox="0 0 800 520"
      width="100%"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Puzzle architecture diagram"
    >
      <defs>
        {/* Background gradient */}
        <linearGradient id="puzzle-bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={tokens.surfaceCard || tokens.surface} stopOpacity="1" />
          <stop offset="100%" stopColor={tokens.surfaceAlt || tokens.surface} stopOpacity="1" />
        </linearGradient>
        {/* Clip paths for icons inside each piece */}
        {pieces.map((piece) => {
          const pos = piece.position;
          const origins = PIECE_ORIGINS[pos];
          if (!origins) return null;
          const { ox, oy } = origins;
          return (
            <clipPath key={`clip-${pos}`} id={`clip-${pos}`}>
              <rect x={ox + 10} y={oy + 10} width={PS - 20} height={PS - 20} />
            </clipPath>
          );
        })}
      </defs>

      {/* Background */}
      <rect x={0} y={0} width={800} height={520} fill="url(#puzzle-bg-grad)" />

      {/* Render each puzzle piece */}
      {pieces.map((piece, i) => {
        const pos = piece.position;
        const origins = PIECE_ORIGINS[pos];
        if (!origins) return null;
        const { ox, oy } = origins;

        const fill = getPieceColor(pos, tokens);
        const iconCx = ox + HS;
        const iconCy = oy + HS;
        const iconPath = ICON_PATHS[piece.iconType] ?? ICON_PATHS['data'];
        const labelPos = LABEL_POSITIONS[pos];

        return (
          <g key={i}>
            {/* Puzzle piece shape */}
            <path
              d={buildPath(pos)}
              fill={fill}
              opacity={0.92}
            />

            {/* Icon */}
            <g transform={`translate(${iconCx},${iconCy})`}>
              <path
                d={iconPath}
                stroke="white"
                strokeWidth={2}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>

            {/* Label */}
            {labelPos && (
              <text
                x={labelPos.x}
                y={labelPos.y}
                textAnchor={labelPos.anchor}
                fontSize={13}
                fontWeight={700}
                fill={tokens.text}
                fontFamily={`'${tokens.bodyFont}', sans-serif`}
              >
                {piece.title}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
