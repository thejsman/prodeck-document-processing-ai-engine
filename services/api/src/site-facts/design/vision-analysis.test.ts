import { describe, it, expect, vi } from 'vitest';
import {
  analyzeScreenshots,
  buildVisionPrompt,
  mergeVisionAnalyses,
  parseVisionResponse,
} from './vision-analysis.service.js';
import type { CapturedScreenshot, VisionScreenshotAnalysis } from './types.js';

function shot(id = 'homepage-desktop'): CapturedScreenshot {
  return { id, pageUrl: 'https://example.com/', viewport: 'desktop', kind: 'fullpage', base64Jpeg: 'ZmFrZQ==' };
}

describe('buildVisionPrompt', () => {
  it('includes screenshot id, kind, viewport, and no-invention rules', () => {
    const prompt = buildVisionPrompt(shot());
    expect(prompt).toContain('homepage-desktop');
    expect(prompt).toContain('fullpage view');
    expect(prompt).toContain('desktop viewport');
    expect(prompt).toContain('Do NOT give design recommendations');
    expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});

describe('parseVisionResponse', () => {
  const valid = JSON.stringify({
    style_adjectives: ['minimal', 'corporate'],
    components: [{ component: 'nav', description: 'Top bar with logo left and links right.' }],
    layout_notes: ['Single-column centered layout.'],
  });

  it('parses a valid response', () => {
    const parsed = parseVisionResponse(valid, 'homepage-desktop');
    expect(parsed?.style_adjectives).toEqual(['minimal', 'corporate']);
    expect(parsed?.components[0].component).toBe('nav');
  });

  it('strips markdown fences', () => {
    expect(parseVisionResponse('```json\n' + valid + '\n```', 'x')).not.toBeNull();
  });

  it('coerces unknown component names to other and drops empty descriptions', () => {
    const parsed = parseVisionResponse(
      JSON.stringify({
        style_adjectives: [],
        components: [
          { component: 'megamenu', description: 'A wide dropdown.' },
          { component: 'nav', description: '' },
        ],
        layout_notes: [],
      }),
      'x',
    );
    expect(parsed?.components).toEqual([{ component: 'other', description: 'A wide dropdown.' }]);
  });

  it('enforces caps on adjectives and layout notes', () => {
    const parsed = parseVisionResponse(
      JSON.stringify({
        style_adjectives: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        components: [],
        layout_notes: ['1', '2', '3', '4', '5', '6'],
      }),
      'x',
    );
    expect(parsed?.style_adjectives).toHaveLength(6);
    expect(parsed?.layout_notes).toHaveLength(4);
  });

  it('returns null for non-JSON output', () => {
    expect(parseVisionResponse('I cannot analyze this image.', 'x')).toBeNull();
  });
});

describe('mergeVisionAnalyses', () => {
  it('dedupes adjectives case-insensitively with provenance, deterministically ordered', () => {
    const a: VisionScreenshotAnalysis = {
      screenshot_id: 'homepage-desktop',
      style_adjectives: ['Minimal', 'bold'],
      components: [{ component: 'nav', description: 'Top bar.' }],
      layout_notes: ['Grid layout.'],
    };
    const b: VisionScreenshotAnalysis = {
      screenshot_id: 'crop-header',
      style_adjectives: ['minimal'],
      components: [{ component: 'nav', description: 'Sticky bar.' }],
      layout_notes: [],
    };
    const merged = mergeVisionAnalyses([a, b]);
    expect(merged.adjectives[0]).toEqual({ term: 'minimal', seen_in: ['homepage-desktop', 'crop-header'] });
    expect(merged.component_inventory[0].component).toBe('nav');
    expect(merged.component_inventory[0].descriptions).toHaveLength(2);
  });
});

describe('analyzeScreenshots', () => {
  it('retries once on unparseable output then records failure', async () => {
    const visionFn = vi.fn().mockResolvedValue('not json at all');
    const result = await analyzeScreenshots([shot()], visionFn, { warn: () => {} });
    expect(visionFn).toHaveBeenCalledTimes(2); // initial attempt + one retry
    expect(result.failed_screenshot_ids).toEqual(['homepage-desktop']);
    expect(result.screenshots).toEqual([]);
  });

  it('succeeds on the first valid response without retrying', async () => {
    const valid = JSON.stringify({ style_adjectives: ['minimal'], components: [], layout_notes: [] });
    const visionFn = vi.fn().mockResolvedValue(valid);
    const result = await analyzeScreenshots([shot()], visionFn, { warn: () => {} });
    expect(visionFn).toHaveBeenCalledTimes(1);
    expect(result.screenshots).toHaveLength(1);
    expect(result.failed_screenshot_ids).toEqual([]);
  });
});
