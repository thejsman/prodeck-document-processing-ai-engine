import { describe, it, expect, vi } from 'vitest';
import {
  buildDesignDocPrompt,
  buildDesignSourcesSection,
  generateDesignSystemDoc,
  processDesignCitations,
} from './design-doc.service.js';
import { buildDesignTokens, flattenTokenPaths } from './dtcg.js';
import { rgbToLab } from './color-math.js';
import type { CapturedScreenshot, ClusteredTokens, VisionAnalysis } from './types.js';

function makeTokens() {
  const clustered: ClusteredTokens = {
    colors: {
      primary: {
        hex: '#1a56db',
        lab: rgbToLab(26, 86, 219),
        total_count: 100,
        delta_e_spread: 2,
        usage: { text: 0, background: 100, border: 0 },
        groups: { button: 100 },
        sources: ['homepage:desktop:button:background'],
      },
      secondary: null,
      accent: [],
      neutral: [],
      semantic: [],
    },
    font_families: [{ family: 'Inter', stack: 'Inter, sans-serif', used_by: ['p'], count: 50 }],
    type_scale: [{ value_px: 16, count: 50, used_by: ['p'] }],
    font_weights: [400],
    spacing_scale: [],
    radius_scale: [],
    has_pill_radius: false,
    shadows: [],
    icons: { svg_count: 0, raster_count: 0 },
    image_aspect_ratios: [],
  };
  return buildDesignTokens(clustered, { siteUrl: 'https://example.com/', capturedAt: '2026-07-19T00:00:00Z' });
}

const screenshots: CapturedScreenshot[] = [
  { id: 'homepage-desktop', pageUrl: 'https://example.com/', viewport: 'desktop', kind: 'fullpage', base64Jpeg: 'ZmFrZQ==' },
];

const vision: VisionAnalysis = {
  analyzed_at: '2026-07-19T00:00:00Z',
  screenshots: [
    {
      screenshot_id: 'homepage-desktop',
      style_adjectives: ['minimal'],
      components: [{ component: 'nav', description: 'Top bar with logo left.' }],
      layout_notes: [],
    },
  ],
  failed_screenshot_ids: [],
  merged: {
    adjectives: [{ term: 'minimal', seen_in: ['homepage-desktop'] }],
    component_inventory: [{ component: 'nav', descriptions: [{ text: 'Top bar with logo left.', screenshot_id: 'homepage-desktop' }] }],
    layout_notes: [],
  },
};

describe('buildDesignDocPrompt', () => {
  it('includes every token path, vision lines, and the outline', () => {
    const tokens = makeTokens();
    const prompt = buildDesignDocPrompt('Example Co', tokens, vision);
    for (const t of flattenTokenPaths(tokens)) expect(prompt).toContain(`[T:${t.path}]`);
    expect(prompt).toContain('[S:homepage-desktop]');
    expect(prompt).toContain('## Component Patterns');
    expect(prompt).toContain('# Example Co — Design System');
    expect(prompt).not.toContain('Imagery & Iconography Style');
    expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it('marks vision as unavailable for tokens-only degradation', () => {
    const prompt = buildDesignDocPrompt('Example Co', makeTokens(), null);
    expect(prompt).toContain('no visual analysis available');
  });
});

describe('processDesignCitations', () => {
  it('keeps valid citations and strips unknown ones', () => {
    const result = processDesignCitations(
      'Primary is blue [T:color.primary]. Fake [T:color.imaginary]. Nav [S:homepage-desktop]. Bogus [S:nope].',
      new Set(['color.primary']),
      new Set(['homepage-desktop']),
    );
    expect(result.body).toContain('[T:color.primary]');
    expect(result.body).not.toContain('imaginary');
    expect(result.body).toContain('[S:homepage-desktop]');
    expect(result.body).not.toContain('[S:nope]');
    expect(result.citedTokens).toEqual(['color.primary']);
    expect(result.citedShots).toEqual(['homepage-desktop']);
  });
});

describe('buildDesignSourcesSection', () => {
  it('lists cited tokens with values and screenshots by id/page/viewport', () => {
    const tokens = makeTokens();
    const sources = buildDesignSourcesSection(['color.primary'], ['homepage-desktop'], tokens, screenshots);
    expect(sources).toContain('## Sources');
    expect(sources).toContain('[T:color.primary] #1a56db — 100 observations');
    expect(sources).toContain('[S:homepage-desktop] desktop fullpage, https://example.com/');
  });

  it('falls back to listing everything when nothing was cited', () => {
    const tokens = makeTokens();
    const sources = buildDesignSourcesSection([], [], tokens, screenshots);
    expect(sources).toContain('[T:color.primary]');
    expect(sources).toContain('[T:font.size.100]');
    expect(sources).toContain('[S:homepage-desktop]');
  });
});

describe('generateDesignSystemDoc', () => {
  it('assembles body + deterministic Responsive Behavior + embedded tokens + Sources, stripping fences and bad citations', async () => {
    const tokens = makeTokens();
    const generateFn = vi.fn().mockResolvedValue(
      '```markdown\n# Example Co — Design System\n\n## Color Palette\nPrimary blue [T:color.primary]. Fake [T:nope].\n\n## Component Patterns\nTop nav [S:homepage-desktop]. Bogus [S:nope].\n```',
    );
    const doc = await generateDesignSystemDoc({ siteName: 'Example Co', tokens, vision, screenshots, generateFn });

    expect(doc).not.toContain('```markdown');
    expect(doc).not.toContain('[T:nope]');
    expect(doc).not.toContain('[S:nope]');
    expect(doc).toContain('[T:color.primary]');
    expect(doc).toContain('[S:homepage-desktop]');
    expect(doc).toContain('## Responsive Behavior');
    expect(doc).toContain('## Design Tokens (JSON)');
    expect(doc).toContain('"$description"');
    expect(doc).toContain('## Sources');
  });

  it('degrades gracefully when vision is null (tokens-only)', async () => {
    const tokens = makeTokens();
    const generateFn = vi.fn().mockResolvedValue('# Example Co — Design System\n\n## Component Patterns\nNot established by the measured tokens.');
    const doc = await generateDesignSystemDoc({ siteName: 'Example Co', tokens, vision: null, screenshots: [], generateFn });
    expect(doc).toContain('Not established by the measured tokens.');
  });
});
