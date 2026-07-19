import { describe, it, expect } from 'vitest';
import { chroma, deltaE76, labHueDeg, parseCssColor, rgbToHex, rgbToLab } from './color-math.js';

describe('parseCssColor', () => {
  it('parses rgb() and rgba()', () => {
    expect(parseCssColor('rgb(26, 86, 219)')).toEqual({ r: 26, g: 86, b: 219, alpha: 1 });
    expect(parseCssColor('rgba(26, 86, 219, 0.5)')).toEqual({ r: 26, g: 86, b: 219, alpha: 0.5 });
  });

  it('parses 6- and 3-digit hex', () => {
    expect(parseCssColor('#1a56db')).toEqual({ r: 26, g: 86, b: 219, alpha: 1 });
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255, alpha: 1 });
  });

  it('returns null for transparent, zero-alpha, and garbage', () => {
    expect(parseCssColor('transparent')).toBeNull();
    expect(parseCssColor('rgba(0, 0, 0, 0)')).toBeNull();
    expect(parseCssColor('inherit')).toBeNull();
    expect(parseCssColor('')).toBeNull();
  });
});

describe('rgbToHex', () => {
  it('formats and clamps', () => {
    expect(rgbToHex(26, 86, 219)).toBe('#1a56db');
    expect(rgbToHex(300, -5, 0)).toBe('#ff0000');
  });
});

describe('rgbToLab', () => {
  it('maps white to L=100 and black to L=0', () => {
    expect(rgbToLab(255, 255, 255).L).toBeCloseTo(100, 0);
    expect(rgbToLab(0, 0, 0).L).toBeCloseTo(0, 0);
  });

  it('gives grays near-zero chroma', () => {
    expect(chroma(rgbToLab(128, 128, 128))).toBeLessThan(3);
    expect(chroma(rgbToLab(230, 231, 235))).toBeLessThan(5);
  });

  it('gives saturated colors high chroma', () => {
    expect(chroma(rgbToLab(220, 38, 38))).toBeGreaterThan(50);
  });
});

describe('deltaE76', () => {
  it('is zero for identical colors and symmetric', () => {
    const a = rgbToLab(26, 86, 219);
    const b = rgbToLab(30, 90, 220);
    expect(deltaE76(a, a)).toBe(0);
    expect(deltaE76(a, b)).toBeCloseTo(deltaE76(b, a), 10);
  });

  it('is small for near-identical shades and large for distinct hues', () => {
    expect(deltaE76(rgbToLab(26, 86, 219), rgbToLab(28, 88, 221))).toBeLessThan(3);
    expect(deltaE76(rgbToLab(26, 86, 219), rgbToLab(220, 38, 38))).toBeGreaterThan(50);
  });
});

describe('labHueDeg', () => {
  it('places red near 0-40deg and green near 100-160deg', () => {
    const red = labHueDeg(rgbToLab(220, 38, 38));
    const green = labHueDeg(rgbToLab(22, 163, 74));
    expect(red >= 335 || red <= 45).toBe(true);
    expect(green).toBeGreaterThan(100);
    expect(green).toBeLessThan(170);
  });
});
