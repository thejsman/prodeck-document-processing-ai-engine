// services/api/src/site-facts/design/clustering.ts
//
// Deterministic token clustering (spec step 3). Raw computed styles are
// noisy (hundreds of near-identical shades, dozens of near-identical font
// sizes); this module collapses them into a clean token set BEFORE any LLM
// sees them. Representative values are always actually-measured members —
// never averages, never invented scale steps.

import { chroma, deltaE76, labHueDeg, parseCssColor, rgbToHex, rgbToLab } from './color-math.js';
import type {
  ClusteredTokens,
  ColorCluster,
  ElementGroup,
  Lab,
  RawComputedStyles,
  RoleAssignedColors,
  ScaleStep,
  ShadowValue,
} from './types.js';

export const COLOR_DELTA_E_THRESHOLD = 10;
const NEUTRAL_CHROMA_THRESHOLD = 12;

export interface ColorObservation {
  css: string;
  context: 'text' | 'background' | 'border';
  group: ElementGroup;
  /** "pageRole:viewport" provenance for the sources list. */
  where: string;
  count: number;
}

interface WorkingCluster {
  representative: { hex: string; lab: Lab; count: number };
  members: { hex: string; lab: Lab; count: number }[];
  total_count: number;
  usage: { text: number; background: number; border: number };
  groups: Partial<Record<ElementGroup, number>>;
  sources: string[];
}

/**
 * Greedy agglomerative clustering in LAB space. Colors are processed in
 * descending weight order (ties: hex ascending) so the output is fully
 * deterministic; each color joins the first cluster whose representative is
 * within the delta-E threshold, else founds a new one.
 */
export function clusterColors(
  observations: ColorObservation[],
  deltaEThreshold: number = COLOR_DELTA_E_THRESHOLD,
): ColorCluster[] {
  interface Agg {
    hex: string;
    lab: Lab;
    total: number;
    usage: { text: number; background: number; border: number };
    groups: Partial<Record<ElementGroup, number>>;
    sources: Map<string, number>;
  }
  const byHex = new Map<string, Agg>();

  for (const obs of observations) {
    const parsed = parseCssColor(obs.css);
    if (!parsed) continue;
    const hex = rgbToHex(parsed.r, parsed.g, parsed.b);
    let agg = byHex.get(hex);
    if (!agg) {
      agg = {
        hex,
        lab: rgbToLab(parsed.r, parsed.g, parsed.b),
        total: 0,
        usage: { text: 0, background: 0, border: 0 },
        groups: {},
        sources: new Map(),
      };
      byHex.set(hex, agg);
    }
    agg.total += obs.count;
    agg.usage[obs.context] += obs.count;
    agg.groups[obs.group] = (agg.groups[obs.group] ?? 0) + obs.count;
    const source = `${obs.where}:${obs.group}:${obs.context}`;
    agg.sources.set(source, (agg.sources.get(source) ?? 0) + obs.count);
  }

  const ordered = [...byHex.values()].sort((a, b) => b.total - a.total || a.hex.localeCompare(b.hex));

  const clusters: WorkingCluster[] = [];
  const clusterSources: Map<WorkingCluster, Map<string, number>> = new Map();

  for (const agg of ordered) {
    let target = clusters.find((c) => deltaE76(c.representative.lab, agg.lab) <= deltaEThreshold);
    if (!target) {
      target = {
        representative: { hex: agg.hex, lab: agg.lab, count: agg.total },
        members: [],
        total_count: 0,
        usage: { text: 0, background: 0, border: 0 },
        groups: {},
        sources: [],
      };
      clusters.push(target);
      clusterSources.set(target, new Map());
    }
    target.members.push({ hex: agg.hex, lab: agg.lab, count: agg.total });
    target.total_count += agg.total;
    target.usage.text += agg.usage.text;
    target.usage.background += agg.usage.background;
    target.usage.border += agg.usage.border;
    for (const [group, count] of Object.entries(agg.groups)) {
      const g = group as ElementGroup;
      target.groups[g] = (target.groups[g] ?? 0) + (count ?? 0);
    }
    const srcMap = clusterSources.get(target)!;
    for (const [src, count] of agg.sources) srcMap.set(src, (srcMap.get(src) ?? 0) + count);
  }

  return clusters.map((c) => {
    const spread = Math.max(0, ...c.members.map((m) => deltaE76(c.representative.lab, m.lab)));
    const topSources = [...clusterSources.get(c)!.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([src]) => src);
    return {
      hex: c.representative.hex,
      lab: c.representative.lab,
      total_count: c.total_count,
      delta_e_spread: Math.round(spread * 10) / 10,
      usage: c.usage,
      groups: c.groups,
      sources: topSources,
    };
  });
}

function interactiveBackgroundWeight(cluster: ColorCluster): number {
  return (cluster.groups.button ?? 0) + (cluster.groups.a ?? 0);
}

/** Weighted role score: interactive backgrounds dominate, then any background, then text/border. */
function roleScore(cluster: ColorCluster): number {
  const interactive = Math.min(interactiveBackgroundWeight(cluster), cluster.usage.background);
  const otherBackground = cluster.usage.background - interactive;
  return 3 * interactive + 2 * otherBackground + (cluster.usage.text + cluster.usage.border);
}

function semanticHueName(lab: Lab): 'red' | 'green' | 'amber' | null {
  // LAB hue angles: saturated reds land around 30-45deg (not 0), greens
  // around 130-150deg, ambers/oranges around 60-90deg.
  const hue = labHueDeg(lab);
  if (hue >= 335 || hue <= 45) return 'red';
  if (hue >= 100 && hue <= 165) return 'green';
  if (hue > 45 && hue < 100) return 'amber';
  return null;
}

/**
 * Assign clusters to roles deterministically: neutrals by low chroma (banded
 * light→dark), primary/secondary by usage-weighted score, semantics by hue
 * band among low-weight leftovers, everything else accent.
 */
export function assignColorRoles(clusters: ColorCluster[]): RoleAssignedColors {
  const kept = clusters.filter((c) => c.total_count >= 3 || interactiveBackgroundWeight(c) > 0);

  const neutral = kept
    .filter((c) => chroma(c.lab) < NEUTRAL_CHROMA_THRESHOLD)
    .sort((a, b) => b.lab.L - a.lab.L || a.hex.localeCompare(b.hex));

  const chromatic = kept
    .filter((c) => chroma(c.lab) >= NEUTRAL_CHROMA_THRESHOLD)
    .sort((a, b) => roleScore(b) - roleScore(a) || a.hex.localeCompare(b.hex));

  const primary = chromatic[0] ?? null;
  const second = chromatic[1] ?? null;
  const secondary = primary && second && roleScore(second) >= roleScore(primary) * 0.25 ? second : null;

  const remaining = chromatic.filter((c) => c !== primary && c !== secondary);
  const primaryScore = primary ? roleScore(primary) : 0;

  const semantic: RoleAssignedColors['semantic'] = [];
  const accent: ColorCluster[] = [];
  for (const cluster of remaining) {
    const hueName = semanticHueName(cluster.lab);
    const lowWeight = primaryScore > 0 && cluster.total_count < primaryScore * 0.1;
    const formLeaning = (cluster.groups.input ?? 0) + (cluster.groups.label ?? 0) > cluster.total_count / 2;
    if (hueName && (lowWeight || formLeaning) && !semantic.some((s) => s.hueName === hueName)) {
      semantic.push({ hueName, cluster });
    } else {
      accent.push(cluster);
    }
  }

  return { primary, secondary, accent, neutral, semantic };
}

export interface ScaleObservation {
  value_px: number;
  count: number;
  used_by: string;
}

/**
 * Merge near-identical px values into scale steps. The representative is the
 * highest-count measured member of each merge group. Steps below minCount are
 * dropped unless used by an exempt group (headings are legitimate singletons).
 */
export function clusterScale(
  observations: ScaleObservation[],
  mergeTolerancePx: number,
  minCount: number,
  exemptGroups: string[] = [],
): ScaleStep[] {
  const byValue = new Map<number, { count: number; used_by: Map<string, number> }>();
  for (const obs of observations) {
    if (!Number.isFinite(obs.value_px) || obs.value_px <= 0) continue;
    const rounded = Math.round(obs.value_px * 2) / 2;
    let entry = byValue.get(rounded);
    if (!entry) {
      entry = { count: 0, used_by: new Map() };
      byValue.set(rounded, entry);
    }
    entry.count += obs.count;
    entry.used_by.set(obs.used_by, (entry.used_by.get(obs.used_by) ?? 0) + obs.count);
  }

  const ordered = [...byValue.entries()]
    .map(([value, e]) => ({ value, count: e.count, used_by: e.used_by }))
    .sort((a, b) => b.count - a.count || a.value - b.value);

  interface Step {
    value: number;
    count: number;
    used_by: Map<string, number>;
  }
  const steps: Step[] = [];
  for (const item of ordered) {
    const target = steps.find((s) => Math.abs(s.value - item.value) <= mergeTolerancePx);
    if (target) {
      target.count += item.count;
      for (const [g, c] of item.used_by) target.used_by.set(g, (target.used_by.get(g) ?? 0) + c);
    } else {
      steps.push({ value: item.value, count: item.count, used_by: new Map(item.used_by) });
    }
  }

  return steps
    .filter((s) => s.count >= minCount || [...s.used_by.keys()].some((g) => exemptGroups.includes(g)))
    .sort((a, b) => a.value - b.value)
    .map((s) => ({
      value_px: s.value,
      count: s.count,
      used_by: [...s.used_by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g]) => g),
    }));
}

export function dedupeShadows(shadows: { css: string; count: number }[]): ShadowValue[] {
  const byNormalized = new Map<string, number>();
  for (const s of shadows) {
    const normalized = s.css.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!normalized || normalized === 'none') continue;
    byNormalized.set(normalized, (byNormalized.get(normalized) ?? 0) + s.count);
  }
  return [...byNormalized.entries()]
    .filter(([, count]) => count >= 2)
    .map(([css, count]) => ({ css, count }))
    .sort((a, b) => b.count - a.count || a.css.localeCompare(b.css));
}

const COMMON_RATIOS: { name: string; value: number }[] = [
  { name: '1:1', value: 1 },
  { name: '4:3', value: 4 / 3 },
  { name: '3:2', value: 3 / 2 },
  { name: '16:9', value: 16 / 9 },
  { name: '2:1', value: 2 },
];

function snapRatio(ratio: number): string {
  for (const common of COMMON_RATIOS) {
    if (Math.abs(ratio - common.value) / common.value <= 0.02) return common.name;
  }
  return ratio.toFixed(2);
}

const PX_VALUE = /^([\d.]+)px$/;

function px(value: string): number | null {
  const m = value.trim().match(PX_VALUE);
  return m ? Number(m[1]) : null;
}

const PILL_RADIUS_PX = 999;

/** Full deterministic raw → clustered tokens transformation. */
export function buildClusteredTokens(raw: RawComputedStyles): ClusteredTokens {
  const colorObs: ColorObservation[] = [];
  const fontSizeObs: ScaleObservation[] = [];
  const spacingObs: ScaleObservation[] = [];
  const radiusObs: ScaleObservation[] = [];
  const shadowObs: { css: string; count: number }[] = [];
  const familyAgg = new Map<string, { stack: string; used_by: Map<ElementGroup, number>; count: number }>();
  const weightSet = new Map<number, number>();
  const ratioAgg = new Map<string, number>();
  let svgCount = 0;
  let rasterCount = 0;
  let hasPillRadius = false;

  for (const page of raw.pages) {
    for (const vp of page.viewports) {
      const where = `${page.role}:${vp.viewport}`;
      for (const sample of vp.element_samples) {
        colorObs.push(
          { css: sample.color, context: 'text', group: sample.group, where, count: sample.count },
          { css: sample.background_color, context: 'background', group: sample.group, where, count: sample.count },
          { css: sample.border_color, context: 'border', group: sample.group, where, count: sample.count },
        );

        const fontSize = px(sample.font_size);
        if (fontSize !== null) fontSizeObs.push({ value_px: fontSize, count: sample.count, used_by: sample.group });

        const weight = Number(sample.font_weight);
        if (Number.isFinite(weight) && weight > 0) weightSet.set(weight, (weightSet.get(weight) ?? 0) + sample.count);

        const firstFamily = sample.font_family.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
        if (firstFamily) {
          let fam = familyAgg.get(firstFamily.toLowerCase());
          if (!fam) {
            fam = { stack: sample.font_family, used_by: new Map(), count: 0 };
            familyAgg.set(firstFamily.toLowerCase(), fam);
          }
          fam.count += sample.count;
          fam.used_by.set(sample.group, (fam.used_by.get(sample.group) ?? 0) + sample.count);
        }

        for (const value of [...sample.margin, ...sample.padding, sample.gap]) {
          const spacing = px(value);
          if (spacing !== null && spacing > 0 && spacing <= 160) {
            spacingObs.push({ value_px: spacing, count: sample.count, used_by: sample.group });
          }
        }

        const radiusValue = sample.border_radius.trim();
        if (radiusValue === '50%' ) {
          hasPillRadius = true;
        } else {
          const radius = px(radiusValue);
          if (radius !== null && radius > 0) {
            if (radius >= PILL_RADIUS_PX) hasPillRadius = true;
            else radiusObs.push({ value_px: radius, count: sample.count, used_by: sample.group });
          }
        }

        if (sample.box_shadow && sample.box_shadow !== 'none') {
          shadowObs.push({ css: sample.box_shadow, count: sample.count });
        }
      }

      for (const img of vp.image_samples) {
        if (img.aspect_ratio > 0) {
          const snapped = snapRatio(img.aspect_ratio);
          ratioAgg.set(snapped, (ratioAgg.get(snapped) ?? 0) + 1);
        }
      }
      svgCount += vp.icon_summary.svg_count;
      rasterCount += vp.icon_summary.raster_count;
    }
  }

  const headings = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

  return {
    colors: assignColorRoles(clusterColors(colorObs)),
    font_families: [...familyAgg.values()]
      .sort((a, b) => b.count - a.count || a.stack.localeCompare(b.stack))
      .map((f) => ({
        family: f.stack.split(',')[0]!.trim().replace(/^["']|["']$/g, ''),
        stack: f.stack,
        used_by: [...f.used_by.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g),
        count: f.count,
      })),
    type_scale: clusterScale(fontSizeObs, 1, 3, headings),
    font_weights: [...weightSet.keys()].sort((a, b) => a - b),
    spacing_scale: clusterScale(spacingObs, 2, 5),
    radius_scale: clusterScale(radiusObs, 1, 2),
    has_pill_radius: hasPillRadius,
    shadows: dedupeShadows(shadowObs),
    icons: { svg_count: svgCount, raster_count: rasterCount },
    image_aspect_ratios: [...ratioAgg.entries()]
      .map(([ratio, count]) => ({ ratio, count }))
      .sort((a, b) => b.count - a.count || a.ratio.localeCompare(b.ratio)),
  };
}
