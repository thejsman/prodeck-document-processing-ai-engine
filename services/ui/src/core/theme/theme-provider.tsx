'use client';

/**
 * Global theme provider.
 *
 * Manages light / dark / system theme preference.
 * - Persists selection to localStorage
 * - Falls back to system prefers-color-scheme when theme === "system"
 * - Listens for OS-level theme changes in real time
 * - Applies the "light" class to <html> (dark is the no-class default)
 *
 * Usage:
 *   <ThemeProvider>...</ThemeProvider>
 *   const { theme, setTheme, resolvedTheme } = useTheme()
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

// ── Types ─────────────────────────────────────────────────────────

export type Theme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

interface ThemeContextValue {
  /** User's stored preference (may be "system"). */
  theme: Theme;
  /** Set and persist theme preference. */
  setTheme: (t: Theme) => void;
  /** Actual applied theme after resolving "system" preference. */
  resolvedTheme: ResolvedTheme;
}

// ── Context ───────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  setTheme: () => {},
  resolvedTheme: 'dark',
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

// ── Helpers ───────────────────────────────────────────────────────

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

function resolveTheme(t: Theme): ResolvedTheme {
  return t === 'system' ? getSystemTheme() : t;
}

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle('light', resolved === 'light');
}

// ── Provider ──────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('dark');

  // On mount: read stored preference and apply it
  useEffect(() => {
    let stored: Theme = 'dark';
    try {
      stored = (localStorage.getItem('theme') as Theme) ?? 'dark';
    } catch {
      // localStorage not available (e.g. private browsing edge cases)
    }
    const resolved = resolveTheme(stored);
    setThemeState(stored);
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, []);

  // System mode: track OS preference in real time
  useEffect(() => {
    if (theme !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (e: MediaQueryListEvent) => {
      const resolved: ResolvedTheme = e.matches ? 'light' : 'dark';
      setResolvedTheme(resolved);
      applyTheme(resolved);
    };

    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem('theme', t);
    } catch { /* ignore */ }

    const resolved = resolveTheme(t);
    setThemeState(t);
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
