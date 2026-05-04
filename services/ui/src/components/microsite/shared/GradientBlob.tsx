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
  /** 0–3: offsets the float animation phase so multiple blobs move independently */
  animIndex?: number;
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
  animIndex = 0,
}: GradientBlobProps) {
  const sizeVal = typeof size === 'number' ? `${size}px` : size;
  const duration = 10 + animIndex * 2.5;
  const delay = -(animIndex * 2.1);
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
        animation: `ms-blob-float ${duration}s ease-in-out infinite`,
        animationDelay: `${delay}s`,
        ...(top !== undefined ? { top } : {}),
        ...(left !== undefined ? { left } : {}),
        ...(right !== undefined ? { right } : {}),
        ...(bottom !== undefined ? { bottom } : {}),
      }}
    />
  );
}
