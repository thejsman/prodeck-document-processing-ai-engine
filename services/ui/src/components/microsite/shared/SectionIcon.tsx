'use client';

interface SectionIconProps {
  hint: string;
  color?: string;
  size?: number;
}

const ICON_PATHS: Record<string, string> = {
  identity:  'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4Z',
  digital:   'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5Zm4 14h8',
  content:   'M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm2 5h8m-8 4h8m-8 4h5',
  strategy:  'M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6Z',
  research:  'M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm10 16l-4.35-4.35',
  launch:    'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7Z',
  document:  'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm-2 0v6h6',
  website:   'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 0-4-10A15 15 0 0 0 12 2Z',
  photo:     'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm5 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm-5 9l5-5 3 3 4-4 5 5',
  campaign:  'M12 2v4m0 12v4m10-10h-4M6 12H2m15.07-7.07l-2.83 2.83M9.76 14.24l-2.83 2.83m11.14 0l-2.83-2.83M9.76 9.76L6.93 6.93',
  default:   'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
};

export function SectionIcon({ hint, color = 'currentColor', size = 24 }: SectionIconProps) {
  // Render uploaded/linked images directly
  if (hint && (hint.startsWith('data:') || hint.startsWith('http://') || hint.startsWith('https://'))) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={hint}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: 'contain', display: 'block' }}
      />
    );
  }

  const d = ICON_PATHS[hint] ?? ICON_PATHS.default;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}
