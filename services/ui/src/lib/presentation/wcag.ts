/**
 * WCAG 2.1 AA contrast enforcement for PluginTokens.
 *
 * Checks all meaningful foreground/background pairs in the token set and
 * adjusts the foreground color (lightens or darkens) until the required
 * contrast ratio is met — without changing hue or saturation.
 *
 * AA thresholds (WCAG 2.1 success criterion 1.4.3 / 1.4.11):
 *   Normal text   ≥ 4.5 : 1
 *   Large text    ≥ 3.0 : 1  (≥24px regular or ≥18.67px bold)
 *   UI components ≥ 3.0 : 1
 */

import type { PluginTokens } from '../../types/presentation';

// ── WCAG math ────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  try {
    const clean = hex.replace('#', '');
    if (clean.length !== 6 && clean.length !== 3) return null;
    const full = clean.length === 3
      ? clean.split('').map(c => c + c).join('')
      : clean;
    const n = parseInt(full, 16);
    if (isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } catch { return null; }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');
}

function linearize(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return 1;
  const l1 = relativeLuminance(...rgb1);
  const l2 = relativeLuminance(...rgb2);
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── Hue / Saturation preserved lightness shift ────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
      case gn: h = ((bn - rn) / d + 2) / 6; break;
      case bn: h = ((rn - gn) / d + 4) / 6; break;
    }
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(h + 1 / 3) * 255),
    Math.round(hue2rgb(h) * 255),
    Math.round(hue2rgb(h - 1 / 3) * 255),
  ];
}

/**
 * Adjust `fg` lightness (preserving hue+sat) until contrast against `bg`
 * meets `targetRatio`. Returns the adjusted hex, or the original if
 * it already passes or hex parsing fails.
 *
 * Direction: towards white for dark backgrounds, towards black for light ones.
 */
function enforceContrast(fg: string, bg: string, targetRatio: number): string {
  if (contrastRatio(fg, bg) >= targetRatio) return fg;

  const fgRgb = hexToRgb(fg);
  const bgRgb = hexToRgb(bg);
  if (!fgRgb || !bgRgb) return fg;

  const bgL = relativeLuminance(...bgRgb);
  // Move fg toward light if bg is dark, toward dark if bg is light
  const moveLighter = bgL < 0.18;

  let [h, s, l] = rgbToHsl(...fgRgb);

  // Binary search on lightness in 64 steps
  let lo = moveLighter ? l  : 0;
  let hi = moveLighter ? 1  : l;

  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    const [r, g, b] = hslToRgb(h, s, mid);
    const candidate = rgbToHex(r, g, b);
    if (contrastRatio(candidate, bg) >= targetRatio) {
      if (moveLighter) { hi = mid; } else { lo = mid; }
    } else {
      if (moveLighter) { lo = mid; } else { hi = mid; }
    }
    l = mid;
  }

  const [r, g, b] = hslToRgb(h, s, moveLighter ? hi : lo);
  return rgbToHex(r, g, b);
}

// ── Token pair enforcement ────────────────────────────────────────────────────

const AA_NORMAL = 4.5;  // normal body text
const AA_LARGE  = 3.0;  // headings ≥24px, UI components, icons

/**
 * Returns a new PluginTokens with all text/background pairs enforced to
 * WCAG 2.1 AA. Hue and saturation are preserved; only lightness shifts.
 *
 * Pairs checked:
 *   text        on bg, surface, surfaceCard, surfaceAlt   — AA normal (4.5)
 *   textMuted   on bg, surface, surfaceCard               — AA normal (4.5)
 *   textSubtle  on bg, surface                            — AA large  (3.0)
 *   accent      on bg, surface, surfaceCard               — AA large  (3.0)
 *   accentDim   on bg, surface                            — AA large  (3.0)
 *
 * For each pair: if the foreground already passes, it is left untouched.
 */
export function enforceWCAGTokens(t: PluginTokens): PluginTokens {
  // We work with a mutable copy
  const out = { ...t };

  // Helper: enforce fg against multiple backgrounds, taking the hardest result
  // (the adjusted color must pass ALL listed backgrounds)
  function fix(
    key: keyof PluginTokens,
    backgrounds: Array<keyof PluginTokens>,
    ratio: number,
  ): void {
    const original = out[key];
    if (typeof original !== 'string') return;
    let current = original as string;
    for (const bgKey of backgrounds) {
      const bg = out[bgKey];
      if (typeof bg !== 'string') continue;
      if (contrastRatio(current, bg) < ratio) {
        current = enforceContrast(current, bg, ratio);
      }
    }
    (out as Record<string, unknown>)[key] = current;
  }

  // Primary text — must be readable everywhere it appears
  fix('text',       ['bg', 'surface', 'surfaceCard', 'surfaceAlt'], AA_NORMAL);

  // Muted text — used for secondary labels, captions, metadata
  fix('textMuted',  ['bg', 'surface', 'surfaceCard'], AA_NORMAL);

  // Subtle text — used for tertiary hints, timestamps (treated as large text)
  fix('textSubtle', ['bg', 'surface'], AA_LARGE);

  // Accent — used for headings, CTAs, active indicators, icons
  fix('accent',     ['bg', 'surface', 'surfaceCard'], AA_LARGE);

  // Accent dim — hover/disabled accent state
  fix('accentDim',  ['bg', 'surface'], AA_LARGE);

  return out;
}

/**
 * Audit a token set and return a list of failing pairs.
 * Useful for debug logging / surfacing warnings in the editor.
 */
export interface WCAGViolation {
  token: string;
  background: string;
  ratio: number;
  required: number;
}

export function auditWCAGTokens(t: PluginTokens): WCAGViolation[] {
  const violations: WCAGViolation[] = [];

  function check(fgKey: string, bgKey: string, required: number) {
    const fg = (t as Record<string, unknown>)[fgKey];
    const bg = (t as Record<string, unknown>)[bgKey];
    if (typeof fg !== 'string' || typeof bg !== 'string') return;
    const ratio = contrastRatio(fg, bg);
    if (ratio < required) {
      violations.push({ token: fgKey, background: bgKey, ratio: Math.round(ratio * 100) / 100, required });
    }
  }

  check('text',       'bg',          AA_NORMAL);
  check('text',       'surface',     AA_NORMAL);
  check('text',       'surfaceCard', AA_NORMAL);
  check('text',       'surfaceAlt',  AA_NORMAL);
  check('textMuted',  'bg',          AA_NORMAL);
  check('textMuted',  'surface',     AA_NORMAL);
  check('textMuted',  'surfaceCard', AA_NORMAL);
  check('textSubtle', 'bg',          AA_LARGE);
  check('textSubtle', 'surface',     AA_LARGE);
  check('accent',     'bg',          AA_LARGE);
  check('accent',     'surface',     AA_LARGE);
  check('accent',     'surfaceCard', AA_LARGE);
  check('accentDim',  'bg',          AA_LARGE);
  check('accentDim',  'surface',     AA_LARGE);

  return violations;
}
