'use client';

interface GradientBlobProps {
  color: string;
  size?: number | string;
  top?: number | string;
  left?: number | string;
  right?: number | string;
  bottom?: number | string;
  opacity?: number;
  blur?: number;
}

export function GradientBlob({
  color,
  size = 400,
  top,
  left,
  right,
  bottom,
  opacity = 0.35,
  blur = 80,
}: GradientBlobProps) {
  const sizeVal = typeof size === 'number' ? `${size}px` : size;
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        width: sizeVal,
        height: sizeVal,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        filter: `blur(${blur}px)`,
        opacity,
        pointerEvents: 'none',
        zIndex: 2,
        ...(top !== undefined ? { top } : {}),
        ...(left !== undefined ? { left } : {}),
        ...(right !== undefined ? { right } : {}),
        ...(bottom !== undefined ? { bottom } : {}),
      }}
    />
  );
}
