'use client';

import { useTheme, type Theme } from '@/core/theme/theme-provider';
import { Sun, Moon } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';

// ── Config ────────────────────────────────────────────────────────

const ICONS: Record<Theme, string> = {
  dark:   '☾',
  light:  '☀',
  system: '☾',
};

/** Clicking toggles between dark and light only */
const NEXT_THEME: Record<Theme, Theme> = {
  dark:   'light',
  light:  'dark',
  system: 'light',
};

const TOOLTIPS: Record<Theme, string> = {
  dark:   'Dark mode — click for light',
  light:  'Light mode — click for dark',
  system: 'Click for light mode',
};

// ── Component ─────────────────────────────────────────────────────

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <button
      className="theme-toggle"
      onClick={() => setTheme(NEXT_THEME[theme])}
      title={TOOLTIPS[theme]}
      aria-label="Switch theme"
    >
      <Icon icon={theme === 'light' ? Sun : Moon} size="md" />
    </button>
  );
}
