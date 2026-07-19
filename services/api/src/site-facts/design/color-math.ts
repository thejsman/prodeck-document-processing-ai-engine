// services/api/src/site-facts/design/color-math.ts
//
// Pure color math for token clustering: CSS color parsing, sRGB → CIELAB
// conversion (D65), and CIE76 delta-E. No dependencies.

import type { Lab } from './types.js';

export interface ParsedColor {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

/**
 * Parse a computed-style color string (Chromium normalizes to rgb()/rgba(),
 * but hex is handled for tests). Returns null for transparent/unparseable —
 * fully-transparent colors carry no design information.
 */
export function parseCssColor(css: string): ParsedColor | null {
  const value = css.trim().toLowerCase();
  if (!value || value === 'transparent' || value === 'none' || value === 'currentcolor') return null;

  const rgbMatch = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgbMatch) {
    const alpha = rgbMatch[4] !== undefined ? Number(rgbMatch[4]) : 1;
    if (alpha === 0) return null;
    return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]), alpha };
  }

  const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      alpha: 1,
    };
  }

  return null;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// D65 reference white
const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / XN;
  const y = (rl * 0.2126 + gl * 0.7152 + bl * 0.0722) / YN;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / ZN;

  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function deltaE76(a: Lab, b: Lab): number {
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

export function chroma(lab: Lab): number {
  return Math.sqrt(lab.a ** 2 + lab.b ** 2);
}

/** LAB hue angle in degrees, 0..360. */
export function labHueDeg(lab: Lab): number {
  const deg = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}
