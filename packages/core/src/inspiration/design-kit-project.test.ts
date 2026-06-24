import { describe, it, expect } from 'vitest';
import { projectDesignKit } from './design-kit-project.js';
import type { AssetMetadata } from './asset-types.js';

function makeAsset(overrides: Partial<AssetMetadata>): AssetMetadata {
  return {
    id: crypto.randomUUID(),
    fileName: 'test.png',
    mediaType: 'image/png',
    size: 1000,
    uploadedAt: new Date().toISOString(),
    assetType: 'other',
    isPrimary: false,
    palette: [],
    fontHints: [],
    tags: [],
    description: '',
    status: 'tagged',
    ...overrides,
  };
}

describe('projectDesignKit', () => {
  it('returns empty kit when no tagged assets', () => {
    const kit = projectDesignKit([
      makeAsset({ status: 'processing' }),
      makeAsset({ status: 'failed' }),
    ]);
    expect(kit.primaryColor).toBeNull();
    expect(kit.palette).toEqual([]);
    expect(kit.logoAssetId).toBeNull();
    expect(kit.heroAssetId).toBeNull();
    expect(kit.designBrief).toBe('');
  });

  it('picks primary logo over any logo', () => {
    const any = makeAsset({ assetType: 'logo', uploadedAt: '2024-01-01T00:00:00Z' });
    const primary = makeAsset({ assetType: 'logo', isPrimary: true, uploadedAt: '2024-01-02T00:00:00Z' });
    const kit = projectDesignKit([any, primary]);
    expect(kit.logoAssetId).toBe(primary.id);
  });

  it('logo palette takes brand priority over hero palette', () => {
    const logo = makeAsset({ assetType: 'logo', palette: ['#111111', '#222222'], uploadedAt: '2024-01-01T00:00:00Z' });
    const hero = makeAsset({ assetType: 'hero', palette: ['#AAAAAA', '#BBBBBB'], uploadedAt: '2024-01-01T00:00:00Z' });
    const kit = projectDesignKit([logo, hero]);
    expect(kit.palette[0]).toBe('#111111');
    expect(kit.palette[1]).toBe('#222222');
    expect(kit.primaryColor).toBe('#111111');
  });

  it('deduplicates palette and caps at 6 colors', () => {
    const asset = makeAsset({
      assetType: 'logo',
      palette: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#111111'],
    });
    const kit = projectDesignKit([asset]);
    expect(kit.palette.length).toBeLessThanOrEqual(6);
    // no duplicates
    expect(new Set(kit.palette).size).toBe(kit.palette.length);
  });

  it('only accepts valid HEX colors', () => {
    const asset = makeAsset({ assetType: 'palette', palette: ['#AABBCC', 'red', 'rgb(0,0,0)', '#XYZ123', '#aabbcc'] });
    const kit = projectDesignKit([asset]);
    // 'red', 'rgb(0,0,0)', '#XYZ123' are invalid; #AABBCC and #aabbcc deduped to one
    expect(kit.palette).toEqual(['#AABBCC']);
  });

  it('aggregates and deduplicates font hints across assets', () => {
    const a = makeAsset({ fontHints: ['Sans-serif', 'bold headings'] });
    const b = makeAsset({ fontHints: ['SANS-SERIF', 'geometric'] });
    const kit = projectDesignKit([a, b]);
    expect(kit.fontHints).toContain('sans-serif');
    expect(kit.fontHints).toContain('bold headings');
    expect(kit.fontHints).toContain('geometric');
    // deduped — 'sans-serif' appears once
    expect(kit.fontHints.filter((h) => h === 'sans-serif').length).toBe(1);
  });

  it('builds a non-empty design brief when palette and tags are present', () => {
    const asset = makeAsset({ assetType: 'logo', palette: ['#1A2B3C'], tags: ['corporate', 'minimal'] });
    const kit = projectDesignKit([asset]);
    expect(kit.designBrief.length).toBeGreaterThan(0);
    expect(kit.designBrief).toContain('#1A2B3C');
  });

  it('picks primary hero over any hero, recency breaks ties', () => {
    const old = makeAsset({ assetType: 'hero', uploadedAt: '2024-01-01T00:00:00Z' });
    const recent = makeAsset({ assetType: 'hero', uploadedAt: '2024-06-01T00:00:00Z' });
    const kit = projectDesignKit([old, recent]);
    // no primary set — most recent wins
    expect(kit.heroAssetId).toBe(recent.id);
  });
});
