// services/api/src/site-facts/design/dtcg.ts
//
// W3C Design Tokens Community Group emitter (spec output 1) plus a derived
// CSS custom-properties file for direct use in microsite generation. Every
// token traces to measured data via $extensions — nothing is invented, and
// missing groups are omitted rather than padded.

import type { ClusteredTokens, ColorCluster, DtcgDocument, DtcgGroup, DtcgToken, ScaleStep } from './types.js';
import { DESIGN_VIEWPORTS } from './types.js';

const EXT_KEY = 'com.prodeck.design';

function colorToken(cluster: ColorCluster): DtcgToken {
  return {
    $type: 'color',
    $value: cluster.hex,
    $extensions: {
      [EXT_KEY]: {
        cluster_size: cluster.total_count,
        delta_e_spread: cluster.delta_e_spread,
        usage: cluster.usage,
        sources: cluster.sources,
      },
    },
  };
}

function dimensionToken(step: ScaleStep): DtcgToken {
  return {
    $type: 'dimension',
    $value: `${step.value_px}px`,
    $extensions: { [EXT_KEY]: { count: step.count, used_by: step.used_by } },
  };
}

/**
 * Band neutrals into 100–900 slots by LAB lightness. Collisions keep the
 * higher-count cluster in the slot and shift the other to the nearest free
 * slot (deterministic since input is ordered light → dark).
 */
export function bandNeutrals(neutrals: ColorCluster[]): Record<string, ColorCluster> {
  const bandFor = (L: number): number => {
    if (L >= 95) return 100;
    if (L >= 85) return 200;
    if (L >= 75) return 300;
    if (L >= 65) return 400;
    if (L >= 50) return 500;
    if (L >= 35) return 600;
    if (L >= 25) return 700;
    if (L >= 15) return 800;
    return 900;
  };
  const slots = new Map<number, ColorCluster>();
  for (const cluster of neutrals) {
    let slot = bandFor(cluster.lab.L);
    if (slots.has(slot)) {
      const incumbent = slots.get(slot)!;
      const loser = incumbent.total_count >= cluster.total_count ? cluster : incumbent;
      const winner = loser === cluster ? incumbent : cluster;
      slots.set(slot, winner);
      // shift loser to nearest free slot (prefer darker, deterministic)
      let shifted: number | null = null;
      for (let offset = 100; offset <= 800; offset += 100) {
        if (slot + offset <= 900 && !slots.has(slot + offset)) { shifted = slot + offset; break; }
        if (slot - offset >= 100 && !slots.has(slot - offset)) { shifted = slot - offset; break; }
      }
      if (shifted !== null) slots.set(shifted, loser);
    } else {
      slots.set(slot, cluster);
    }
  }
  const out: Record<string, ColorCluster> = {};
  for (const slot of [...slots.keys()].sort((a, b) => a - b)) out[String(slot)] = slots.get(slot)!;
  return out;
}

export function buildDesignTokens(
  clustered: ClusteredTokens,
  meta: { siteUrl: string; capturedAt: string },
): DtcgDocument {
  const doc: DtcgDocument = {
    $description: `Design tokens measured from ${meta.siteUrl} on ${meta.capturedAt}. Every token traces to computed-style observations via $extensions["${EXT_KEY}"]; nothing is inferred or invented.`,
  };

  // --- color ---
  const color: DtcgGroup = {};
  if (clustered.colors.primary) color.primary = colorToken(clustered.colors.primary);
  if (clustered.colors.secondary) color.secondary = colorToken(clustered.colors.secondary);
  if (clustered.colors.accent.length > 0) {
    const accent: DtcgGroup = {};
    clustered.colors.accent.forEach((cluster, i) => { accent[String(i + 1)] = colorToken(cluster); });
    color.accent = accent;
  }
  const neutralSlots = bandNeutrals(clustered.colors.neutral);
  if (Object.keys(neutralSlots).length > 0) {
    const neutral: DtcgGroup = {};
    for (const [slot, cluster] of Object.entries(neutralSlots)) neutral[slot] = colorToken(cluster);
    color.neutral = neutral;
  }
  if (clustered.colors.semantic.length > 0) {
    const semantic: DtcgGroup = {};
    for (const { hueName, cluster } of clustered.colors.semantic) semantic[hueName] = colorToken(cluster);
    color.semantic = semantic;
  }
  if (Object.keys(color).length > 0) doc.color = color;

  // --- font ---
  const font: DtcgGroup = {};
  if (clustered.font_families.length > 0) {
    const family: DtcgGroup = {};
    const headingFam = clustered.font_families.find((f) => f.used_by.some((g) => /^h[1-3]$/.test(g)));
    const bodyFam = clustered.font_families.find((f) => f.used_by.includes('p') || f.used_by.includes('label')) ?? clustered.font_families[0];
    if (headingFam) {
      family.heading = {
        $type: 'fontFamily',
        $value: headingFam.stack.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')),
        $extensions: { [EXT_KEY]: { count: headingFam.count, used_by: headingFam.used_by } },
      };
    }
    family.body = {
      $type: 'fontFamily',
      $value: bodyFam.stack.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')),
      $extensions: { [EXT_KEY]: { count: bodyFam.count, used_by: bodyFam.used_by } },
    };
    font.family = family;
  }
  if (clustered.type_scale.length > 0) {
    const size: DtcgGroup = {};
    clustered.type_scale.forEach((step, i) => { size[String((i + 1) * 100)] = dimensionToken(step); });
    font.size = size;
  }
  if (clustered.font_weights.length > 0) {
    const weight: DtcgGroup = {};
    for (const w of clustered.font_weights) weight[String(w)] = { $type: 'fontWeight', $value: w };
    font.weight = weight;
  }
  if (Object.keys(font).length > 0) doc.font = font;

  // --- spacing / radius / shadow ---
  if (clustered.spacing_scale.length > 0) {
    const spacing: DtcgGroup = {};
    clustered.spacing_scale.forEach((step, i) => { spacing[String((i + 1) * 100)] = dimensionToken(step); });
    doc.spacing = spacing;
  }
  if (clustered.radius_scale.length > 0 || clustered.has_pill_radius) {
    const radius: DtcgGroup = {};
    clustered.radius_scale.forEach((step, i) => { radius[String((i + 1) * 100)] = dimensionToken(step); });
    if (clustered.has_pill_radius) radius.pill = { $type: 'dimension', $value: '9999px' };
    doc.radius = radius;
  }
  if (clustered.shadows.length > 0) {
    const shadow: DtcgGroup = {};
    clustered.shadows.forEach((s, i) => {
      shadow[String((i + 1) * 100)] = {
        $type: 'shadow',
        $value: s.css,
        $extensions: { [EXT_KEY]: { count: s.count } },
      };
    });
    doc.shadow = shadow;
  }

  // --- breakpoints (the viewports actually measured) ---
  const breakpoints: DtcgGroup = {};
  for (const vp of DESIGN_VIEWPORTS) {
    breakpoints[vp.name] = { $type: 'dimension', $value: `${vp.width}px` };
  }
  doc.breakpoints = breakpoints;

  return doc;
}

function isToken(node: unknown): node is DtcgToken {
  return typeof node === 'object' && node !== null && '$type' in node && '$value' in node;
}

export interface FlatToken {
  path: string;
  type: string;
  value: unknown;
  extensions?: Record<string, unknown>;
}

/** Flatten a DTCG document into dot-paths ("color.primary", "font.size.100"). */
export function flattenTokenPaths(doc: DtcgDocument): FlatToken[] {
  const out: FlatToken[] = [];
  const walk = (node: unknown, prefix: string) => {
    if (isToken(node)) {
      out.push({
        path: prefix,
        type: node.$type,
        value: node.$value,
        ...(node.$extensions ? { extensions: node.$extensions[EXT_KEY] } : {}),
      });
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$')) continue;
      walk(child, prefix ? `${prefix}.${key}` : key);
    }
  };
  walk(doc, '');
  return out;
}

/** Derive a :root CSS custom-properties block — microsite-generation-ready. */
export function tokensToCssVars(doc: DtcgDocument): string {
  const lines = flattenTokenPaths(doc).map((token) => {
    const name = `--${token.path.replace(/\./g, '-')}`;
    const value = Array.isArray(token.value) ? (token.value as string[]).map((v) => (v.includes(' ') ? `"${v}"` : v)).join(', ') : String(token.value);
    return `  ${name}: ${value};`;
  });
  return `:root {\n${lines.join('\n')}\n}\n`;
}
