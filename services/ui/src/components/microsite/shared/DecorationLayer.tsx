'use client';

type DecorationStyle = 'orbs' | 'dots' | 'grid' | 'geometric' | 'none';

interface Props {
  style: DecorationStyle;
  opacity?: number;
  accentColor?: string;
}

export function DecorationLayer({ style, opacity = 0.12, accentColor = '#6366F1' }: Props) {
  if (style === 'none') return null;

  if (style === 'orbs') {
    return (
      <div
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}
      >
        <div style={{
          position: 'absolute', width: 320, height: 320, borderRadius: '50%',
          background: `radial-gradient(circle, ${accentColor}, transparent 70%)`,
          opacity, top: '-10%', left: '-5%', filter: 'blur(60px)',
        }} />
        <div style={{
          position: 'absolute', width: 240, height: 240, borderRadius: '50%',
          background: `radial-gradient(circle, ${accentColor}, transparent 70%)`,
          opacity: opacity * 0.6, bottom: '5%', right: '-5%', filter: 'blur(50px)',
        }} />
        <div style={{
          position: 'absolute', width: 160, height: 160, borderRadius: '50%',
          background: `radial-gradient(circle, ${accentColor}, transparent 70%)`,
          opacity: opacity * 0.4, top: '40%', right: '15%', filter: 'blur(40px)',
        }} />
      </div>
    );
  }

  if (style === 'dots') {
    return (
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
          backgroundImage: `radial-gradient(circle, ${accentColor} 1px, transparent 1px)`,
          backgroundSize: '28px 28px',
          opacity,
        }}
      />
    );
  }

  if (style === 'grid') {
    return (
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
          backgroundImage: `linear-gradient(${accentColor}40 1px, transparent 1px), linear-gradient(90deg, ${accentColor}40 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
          opacity,
        }}
      />
    );
  }

  if (style === 'geometric') {
    return (
      <div
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}
      >
        <svg
          width="100%" height="100%"
          style={{ position: 'absolute', inset: 0, opacity }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <polygon points="60,20 100,80 20,80"  fill={accentColor} opacity="0.4" />
          <polygon points="1340,40 1400,130 1280,130" fill={accentColor} opacity="0.25" />
          <rect x="80%" y="60%" width="40" height="40" fill={accentColor} opacity="0.2" transform="rotate(20, 1200, 300)" />
          <circle cx="15%" cy="70%" r="18" fill={accentColor} opacity="0.3" />
          <polygon points="700,10 730,60 670,60" fill={accentColor} opacity="0.15" />
        </svg>
      </div>
    );
  }

  return null;
}
