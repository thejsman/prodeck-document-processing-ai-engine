import { describe, it, expect } from 'vitest';
import {
  buildClusteredTokens,
  clusterColors,
  assignColorRoles,
  clusterScale,
  dedupeShadows,
  type ColorObservation,
} from './clustering.js';
import type { ElementSample, RawComputedStyles } from './types.js';

function obs(overrides: Partial<ColorObservation> = {}): ColorObservation {
  return {
    css: 'rgb(26, 86, 219)',
    context: 'background',
    group: 'button',
    where: 'homepage:desktop',
    count: 1,
    ...overrides,
  };
}

describe('clusterColors', () => {
  it('collapses hundreds of near-identical shades into one cluster', () => {
    const observations: ColorObservation[] = [];
    for (let i = 0; i < 200; i += 1) {
      observations.push(obs({ css: `rgb(${26 + (i % 4)}, ${86 + (i % 3)}, ${219 - (i % 4)})`, count: 1 }));
    }
    const clusters = clusterColors(observations);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].total_count).toBe(200);
  });

  it('keeps genuinely distinct hues apart', () => {
    const clusters = clusterColors([
      obs({ css: 'rgb(26, 86, 219)', count: 10 }),
      obs({ css: 'rgb(220, 38, 38)', count: 10 }),
    ]);
    expect(clusters).toHaveLength(2);
  });

  it('uses the highest-count measured member as representative, never an average', () => {
    const clusters = clusterColors([
      obs({ css: 'rgb(26, 86, 219)', count: 100 }),
      obs({ css: 'rgb(30, 90, 221)', count: 2 }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].hex).toBe('#1a56db');
  });

  it('tracks usage contexts and provenance sources', () => {
    const clusters = clusterColors([
      obs({ context: 'background', count: 5 }),
      obs({ context: 'text', group: 'a', count: 3 }),
    ]);
    expect(clusters[0].usage).toEqual({ text: 3, background: 5, border: 0 });
    expect(clusters[0].sources).toContain('homepage:desktop:button:background');
  });

  it('is deterministic', () => {
    const observations = [
      obs({ css: 'rgb(26, 86, 219)', count: 5 }),
      obs({ css: 'rgb(220, 38, 38)', count: 5 }),
      obs({ css: 'rgb(229, 231, 235)', count: 5 }),
    ];
    expect(clusterColors(observations)).toEqual(clusterColors(observations));
  });
});

describe('assignColorRoles', () => {
  it('button-background color wins primary over higher-frequency body text', () => {
    const clusters = clusterColors([
      obs({ css: 'rgb(26, 86, 219)', context: 'background', group: 'button', count: 40 }),
      obs({ css: 'rgb(146, 64, 14)', context: 'text', group: 'p', count: 100 }),
    ]);
    const roles = assignColorRoles(clusters);
    expect(roles.primary?.hex).toBe('#1a56db');
  });

  it('classifies low-chroma colors as neutrals ordered light to dark', () => {
    const clusters = clusterColors([
      obs({ css: 'rgb(17, 24, 39)', context: 'text', group: 'p', count: 50 }),
      obs({ css: 'rgb(255, 255, 255)', context: 'background', group: 'container', count: 80 }),
      obs({ css: 'rgb(107, 114, 128)', context: 'border', group: 'card', count: 20 }),
    ]);
    const roles = assignColorRoles(clusters);
    expect(roles.neutral.map((n) => n.hex)).toEqual(['#ffffff', '#6b7280', '#111827']);
    expect(roles.primary).toBeNull();
  });

  it('omits secondary when the runner-up is far below primary', () => {
    const clusters = clusterColors([
      obs({ css: 'rgb(26, 86, 219)', context: 'background', group: 'button', count: 100 }),
      obs({ css: 'rgb(180, 90, 200)', context: 'border', group: 'card', count: 3 }),
    ]);
    const roles = assignColorRoles(clusters);
    expect(roles.primary?.hex).toBe('#1a56db');
    expect(roles.secondary).toBeNull();
  });

  it('assigns low-weight hue-band colors to semantic buckets', () => {
    const clusters = clusterColors([
      obs({ css: 'rgb(26, 86, 219)', context: 'background', group: 'button', count: 200 }),
      obs({ css: 'rgb(220, 38, 38)', context: 'text', group: 'label', count: 4 }),
    ]);
    const roles = assignColorRoles(clusters);
    expect(roles.semantic.map((s) => s.hueName)).toContain('red');
  });
});

describe('clusterScale', () => {
  it('merges near-identical values keeping the highest-count member', () => {
    const steps = clusterScale(
      [
        { value_px: 16, count: 100, used_by: 'p' },
        { value_px: 16.5, count: 3, used_by: 'p' },
        { value_px: 24, count: 40, used_by: 'h3' },
      ],
      1,
      3,
    );
    expect(steps.map((s) => s.value_px)).toEqual([16, 24]);
    expect(steps[0].count).toBe(103);
  });

  it('drops low-count noise but exempts heading groups', () => {
    const steps = clusterScale(
      [
        { value_px: 48, count: 1, used_by: 'h1' },
        { value_px: 13, count: 1, used_by: 'p' },
      ],
      1,
      3,
      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    );
    expect(steps.map((s) => s.value_px)).toEqual([48]);
  });

  it('sorts ascending and records used_by', () => {
    const steps = clusterScale(
      [
        { value_px: 32, count: 10, used_by: 'h2' },
        { value_px: 8, count: 20, used_by: 'container' },
      ],
      2,
      2,
    );
    expect(steps.map((s) => s.value_px)).toEqual([8, 32]);
    expect(steps[1].used_by).toContain('h2');
  });
});

describe('dedupeShadows', () => {
  it('normalizes whitespace/case and drops singletons', () => {
    const shadows = dedupeShadows([
      { css: 'rgba(0, 0, 0, 0.1) 0px 4px 12px  0px', count: 1 },
      { css: 'rgba(0, 0, 0, 0.1) 0px 4px 12px 0px', count: 2 },
      { css: 'rgba(0, 0, 0, 0.5) 0px 1px 2px 0px', count: 1 },
      { css: 'none', count: 50 },
    ]);
    expect(shadows).toHaveLength(1);
    expect(shadows[0].count).toBe(3);
  });
});

describe('buildClusteredTokens', () => {
  function makeSample(overrides: Partial<ElementSample> = {}): ElementSample {
    return {
      group: 'p',
      tag: 'p',
      count: 10,
      color: 'rgb(17, 24, 39)',
      background_color: 'rgba(0, 0, 0, 0)',
      border_color: 'rgb(17, 24, 39)',
      font_family: 'Inter, sans-serif',
      font_size: '16px',
      font_weight: '400',
      line_height: '24px',
      letter_spacing: 'normal',
      margin: ['0px', '0px', '16px', '0px'],
      padding: ['0px', '0px', '0px', '0px'],
      gap: 'normal',
      border_radius: '0px',
      box_shadow: 'none',
      ...overrides,
    };
  }

  const raw: RawComputedStyles = {
    site_url: 'https://example.com/',
    captured_at: new Date().toISOString(),
    pages: [
      {
        url: 'https://example.com/',
        role: 'homepage',
        viewports: [
          {
            viewport: 'desktop',
            width: 1440,
            element_samples: [
              makeSample(),
              makeSample({
                group: 'button',
                tag: 'button',
                count: 8,
                color: 'rgb(255, 255, 255)',
                background_color: 'rgb(26, 86, 219)',
                font_family: 'Sora, sans-serif',
                font_size: '14px',
                font_weight: '700',
                padding: ['12px', '24px', '12px', '24px'],
                border_radius: '9999px',
              }),
              makeSample({ group: 'h1', tag: 'h1', count: 1, font_family: 'Sora, sans-serif', font_size: '48px', font_weight: '700' }),
            ],
            image_samples: [{ kind: 'img', rendered_w: 800, rendered_h: 450, aspect_ratio: 1.78 }],
            icon_summary: { svg_count: 6, raster_count: 1 },
          },
        ],
      },
    ],
  };

  it('produces a full clustered token set from raw styles', () => {
    const tokens = buildClusteredTokens(raw);
    expect(tokens.colors.primary?.hex).toBe('#1a56db');
    expect(tokens.type_scale.map((s) => s.value_px)).toEqual([14, 16, 48]);
    expect(tokens.font_weights).toEqual([400, 700]);
    expect(tokens.has_pill_radius).toBe(true);
    expect(tokens.icons).toEqual({ svg_count: 6, raster_count: 1 });
    expect(tokens.image_aspect_ratios[0].ratio).toBe('16:9');
    expect(tokens.font_families.some((f) => f.family === 'Sora')).toBe(true);
  });

  it('is deterministic end-to-end', () => {
    expect(buildClusteredTokens(raw)).toEqual(buildClusteredTokens(raw));
  });
});
