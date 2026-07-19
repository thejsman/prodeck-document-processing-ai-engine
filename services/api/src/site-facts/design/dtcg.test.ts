import { describe, it, expect } from 'vitest';
import { bandNeutrals, buildDesignTokens, flattenTokenPaths, tokensToCssVars } from './dtcg.js';
import { rgbToLab } from './color-math.js';
import type { ClusteredTokens, ColorCluster } from './types.js';

function cluster(hex: string, r: number, g: number, b: number, count = 10): ColorCluster {
  return {
    hex,
    lab: rgbToLab(r, g, b),
    total_count: count,
    delta_e_spread: 1.5,
    usage: { text: 0, background: count, border: 0 },
    groups: { button: count },
    sources: ['homepage:desktop:button:background'],
  };
}

function makeClustered(overrides: Partial<ClusteredTokens> = {}): ClusteredTokens {
  return {
    colors: {
      primary: cluster('#1a56db', 26, 86, 219, 100),
      secondary: null,
      accent: [],
      neutral: [cluster('#ffffff', 255, 255, 255, 80), cluster('#111827', 17, 24, 39, 60)],
      semantic: [{ hueName: 'red', cluster: cluster('#dc2626', 220, 38, 38, 5) }],
    },
    font_families: [
      { family: 'Sora', stack: 'Sora, sans-serif', used_by: ['h1', 'h2'], count: 20 },
      { family: 'Inter', stack: 'Inter, sans-serif', used_by: ['p', 'label'], count: 90 },
    ],
    type_scale: [
      { value_px: 16, count: 100, used_by: ['p'] },
      { value_px: 48, count: 3, used_by: ['h1'] },
    ],
    font_weights: [400, 700],
    spacing_scale: [
      { value_px: 8, count: 50, used_by: ['container'] },
      { value_px: 24, count: 30, used_by: ['card'] },
    ],
    radius_scale: [{ value_px: 8, count: 12, used_by: ['card'] }],
    has_pill_radius: true,
    shadows: [{ css: 'rgba(0, 0, 0, 0.1) 0px 4px 12px 0px', count: 6 }],
    icons: { svg_count: 10, raster_count: 2 },
    image_aspect_ratios: [{ ratio: '16:9', count: 4 }],
    ...overrides,
  };
}

describe('buildDesignTokens', () => {
  const doc = buildDesignTokens(makeClustered(), { siteUrl: 'https://example.com/', capturedAt: '2026-07-19T00:00:00Z' });

  it('every leaf token has $type and $value', () => {
    for (const token of flattenTokenPaths(doc)) {
      expect(token.type).toBeTruthy();
      expect(token.value).toBeDefined();
    }
  });

  it('names sizes ascending and bands neutrals by lightness', () => {
    const paths = flattenTokenPaths(doc).map((t) => t.path);
    expect(paths).toContain('color.primary');
    expect(paths).toContain('color.neutral.100');
    expect(paths).toContain('color.neutral.900');
    expect(paths).toContain('color.semantic.red');
    expect(paths).toContain('font.size.100');
    expect(paths).toContain('font.size.200');
    expect(paths).toContain('radius.pill');
    expect(paths).toContain('breakpoints.desktop');
  });

  it('carries traceability extensions on measured tokens', () => {
    const primary = flattenTokenPaths(doc).find((t) => t.path === 'color.primary');
    expect(primary?.extensions?.cluster_size).toBe(100);
    expect(primary?.extensions?.sources).toBeTruthy();
  });

  it('separates heading and body font families', () => {
    const flat = flattenTokenPaths(doc);
    expect(flat.find((t) => t.path === 'font.family.heading')?.value).toEqual(['Sora', 'sans-serif']);
    expect(flat.find((t) => t.path === 'font.family.body')?.value).toEqual(['Inter', 'sans-serif']);
  });

  it('omits groups with no measured data instead of padding', () => {
    const sparse = buildDesignTokens(
      makeClustered({
        colors: { primary: null, secondary: null, accent: [], neutral: [], semantic: [] },
        shadows: [],
        radius_scale: [],
        has_pill_radius: false,
      }),
      { siteUrl: 'https://example.com/', capturedAt: '2026-07-19T00:00:00Z' },
    );
    expect(sparse.color).toBeUndefined();
    expect(sparse.shadow).toBeUndefined();
    expect(sparse.radius).toBeUndefined();
  });
});

describe('bandNeutrals', () => {
  it('bands by lightness and resolves collisions deterministically', () => {
    const white = cluster('#ffffff', 255, 255, 255, 100);
    const nearWhite = cluster('#fafafa', 250, 250, 250, 10);
    const dark = cluster('#111827', 17, 24, 39, 50);
    const banded = bandNeutrals([white, nearWhite, dark]);
    expect(banded['100'].hex).toBe('#ffffff');
    expect(Object.values(banded).map((c) => c.hex)).toContain('#fafafa');
    expect(banded['900'].hex).toBe('#111827');
  });
});

describe('tokensToCssVars', () => {
  it('emits :root custom properties for every token', () => {
    const doc = buildDesignTokens(makeClustered(), { siteUrl: 'https://example.com/', capturedAt: '2026-07-19T00:00:00Z' });
    const css = tokensToCssVars(doc);
    expect(css).toContain(':root {');
    expect(css).toContain('--color-primary: #1a56db;');
    expect(css).toContain('--font-family-body: Inter, sans-serif;');
    expect(css).toContain('--radius-pill: 9999px;');
  });
});
