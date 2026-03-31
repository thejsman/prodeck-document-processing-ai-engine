'use client';
export function TypingCursor({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 2,
        height: '0.85em',
        background: 'currentColor',
        marginLeft: 2,
        verticalAlign: 'text-bottom',
        animation: 'tw-cursor-blink 530ms step-end infinite',
        borderRadius: 1,
        opacity: 1,
      }}
    />
  );
}
