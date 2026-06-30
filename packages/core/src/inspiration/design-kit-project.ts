/**
 * Pure design-kit projection. Takes a list of tagged AssetMetadata and computes
 * a ComputedDesignKit: brand color, merged palette, font hints, logo/hero ids,
 * and an auto-generated design brief.
 *
 * Pure module: no I/O, no clock, no randomness. Deterministic for fixed input.
 */

import type { AssetMetadata, ComputedDesignKit } from './asset-types.js';

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

function dedupeHex(colors: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of colors) {
    const up = c.toUpperCase();
    if (HEX_RE.test(up) && !seen.has(up)) { seen.add(up); out.push(up); }
  }
  return out;
}

export function projectDesignKit(assets: AssetMetadata[]): ComputedDesignKit {
  const tagged = assets.filter((a) => a.status === 'tagged');

  if (tagged.length === 0) {
    return { primaryColor: null, palette: [], fontHints: [], logoAssetId: null, heroAssetId: null, designBrief: '' };
  }

  // Asset selection — primary-flagged wins; recency (uploadedAt) breaks ties
  const byNewest = [...tagged].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  const logoAsset =
    byNewest.find((a) => a.assetType === 'logo' && a.isPrimary) ??
    byNewest.find((a) => a.assetType === 'logo') ??
    null;

  const heroAsset =
    byNewest.find((a) => (a.assetType === 'hero' || a.assetType === 'background') && a.isPrimary) ??
    byNewest.find((a) => a.assetType === 'hero' || a.assetType === 'background') ??
    null;

  const paletteAsset =
    byNewest.find((a) => a.assetType === 'palette' && a.isPrimary) ??
    byNewest.find((a) => a.assetType === 'palette') ??
    null;

  // Palette merge: logo colors have brand priority → palette asset → hero → rest
  const colorSources = [logoAsset, paletteAsset, heroAsset, ...byNewest].filter(
    (a): a is AssetMetadata => a !== null,
  );
  const mergedColors: string[] = [];
  for (const a of colorSources) {
    for (const c of a.palette) mergedColors.push(c);
  }
  const palette = dedupeHex(mergedColors).slice(0, 6);
  const primaryColor = palette[0] ?? null;

  // Font hints: deduplicate across all tagged assets
  const fontSet = new Set<string>();
  for (const a of byNewest) {
    for (const h of a.fontHints) fontSet.add(h.toLowerCase().trim());
  }
  const fontHints = [...fontSet].filter(Boolean).slice(0, 5);

  // Design brief: natural-language summary for the LLM
  const parts: string[] = [];
  if (primaryColor) parts.push(`Primary brand color: ${primaryColor}`);
  if (palette.length > 1) parts.push(`Supporting palette: ${palette.slice(1).join(', ')}`);
  if (fontHints.length) parts.push(`Typography style: ${fontHints.join(', ')}`);
  const allTags = dedupeHex.length > 0
    ? [...new Set(byNewest.flatMap((a) => a.tags))].slice(0, 8)
    : [];
  if (allTags.length) parts.push(`Brand character: ${allTags.join(', ')}`);
  const designBrief = parts.join('. ');

  return {
    primaryColor,
    palette,
    fontHints,
    logoAssetId: logoAsset?.id ?? null,
    heroAssetId: heroAsset?.id ?? null,
    designBrief,
  };
}
