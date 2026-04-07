'use client';

type DividerStyle = 'wave' | 'diagonal' | 'curve' | 'zigzag' | 'none';

interface Props {
  style: DividerStyle;
  toColor: string;
  height?: number;
}

/** SVG shape divider between sections, driven by ast.dividerStyle. */
export function AstSectionDivider({ style, toColor, height = 64 }: Props) {
  if (style === 'none') return null;

  const w = 1440;
  const h = height;
  let path: string;

  switch (style) {
    case 'wave':
      path = `M0,${Math.round(h * 0.55)} C${Math.round(w * 0.25)},0 ${Math.round(w * 0.75)},${h} ${w},${Math.round(h * 0.45)} L${w},${h} L0,${h} Z`;
      break;
    case 'curve':
      path = `M0,${h} Q${Math.round(w * 0.5)},0 ${w},${h} Z`;
      break;
    case 'diagonal':
      path = `M0,0 L${w},${h} L${w},${h} L0,${h} Z`;
      break;
    case 'zigzag': {
      const pts = Array.from({ length: 11 }, (_, i) => {
        const x = Math.round((i / 10) * w);
        const y = i % 2 === 0 ? 0 : h;
        return `${x},${y}`;
      }).join(' ');
      path = `M${pts} L${w},${h} L0,${h} Z`;
      break;
    }
    default:
      path = `M0,${Math.round(h * 0.55)} C${Math.round(w * 0.25)},0 ${Math.round(w * 0.75)},${h} ${w},${Math.round(h * 0.45)} L${w},${h} L0,${h} Z`;
  }

  return (
    <div
      style={{ position: 'relative', height, overflow: 'hidden', marginBottom: -2, lineHeight: 0, pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <path d={path} fill={toColor} />
      </svg>
    </div>
  );
}
