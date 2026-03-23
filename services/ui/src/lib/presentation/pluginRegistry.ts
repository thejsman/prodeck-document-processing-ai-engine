import type { PluginMeta, PluginTokens } from '../../types/presentation';

// ── Plugin definitions ───────────────────────────────────────────────────────

const OBSIDIAN_TOKENS: PluginTokens = {
  bg: '#080808',
  surface: '#111111',
  surfaceAlt: '#1A1A1A',
  surfaceCard: '#161616',
  text: '#E8E4DC',
  textMuted: '#9A9590',
  textSubtle: '#5A5550',
  accent: '#C8A96E',
  accentDim: '#8B7744',
  accentRgb: '200,169,110',
  glowColor: 'rgba(200,169,110,0.28)',
  border: '#2A2520',
  borderSubtle: '#1E1B18',
  heroFont: 'Cormorant Garamond',
  bodyFont: 'DM Sans',
  heroWeight: 300,
  heroStyle: 'italic',
  labelTracking: '0.18em',
  dark: true,
  noiseOpacity: 0.03,
  gradientHero: 'radial-gradient(ellipse 80% 60% at 50% 40%, #1A1510 0%, #080808 100%)',
  gradientText: 'linear-gradient(135deg, #E8C87A 0%, #C8A96E 50%, #F0D898 100%)',
  meshGradient: 'radial-gradient(ellipse 80% 60% at 20% 30%, rgba(200,169,110,0.12) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 70%, rgba(200,169,110,0.08) 0%, transparent 55%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.5)',
  cardShadowHover: '0 8px 40px rgba(0,0,0,0.7), 0 0 20px rgba(200,169,110,0.18)',
};

const IVORY_TOKENS: PluginTokens = {
  bg: '#F8F5EF',
  surface: '#FFFFFF',
  surfaceAlt: '#F0ECE4',
  surfaceCard: '#FAFAF7',
  text: '#1A1612',
  textMuted: '#6B6560',
  textSubtle: '#A09890',
  accent: '#1A1612',
  accentDim: '#3A3530',
  accentRgb: '26,22,18',
  glowColor: 'rgba(26,22,18,0.15)',
  border: '#DDD8D0',
  borderSubtle: '#E8E4DC',
  heroFont: 'Playfair Display',
  bodyFont: 'Libre Franklin',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.15em',
  dark: false,
  noiseOpacity: 0.025,
  gradientHero: 'radial-gradient(ellipse 70% 50% at 50% 35%, #FFFFFF 0%, #F8F5EF 100%)',
  gradientText: 'linear-gradient(135deg, #1A1612 0%, #4A3F38 50%, #1A1612 100%)',
  meshGradient: 'radial-gradient(ellipse 70% 50% at 20% 30%, rgba(26,22,18,0.06) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 80% 70%, rgba(26,22,18,0.04) 0%, transparent 55%)',
  cardShadow: '0 2px 16px rgba(26,22,18,0.08)',
  cardShadowHover: '0 8px 32px rgba(26,22,18,0.14), 0 0 0 1px rgba(26,22,18,0.1)',
};

const COBALT_TOKENS: PluginTokens = {
  bg: '#01112A',
  surface: '#071D3F',
  surfaceAlt: '#0C2650',
  surfaceCard: '#091E42',
  text: '#E4ECF7',
  textMuted: '#8AA4C8',
  textSubtle: '#4A6A8F',
  accent: '#4FA3E8',
  accentDim: '#2D6CA8',
  accentRgb: '79,163,232',
  glowColor: 'rgba(79,163,232,0.3)',
  border: '#1A3558',
  borderSubtle: '#122A48',
  heroFont: 'Syne',
  bodyFont: 'DM Sans',
  heroWeight: 800,
  heroStyle: 'normal',
  labelTracking: '0.2em',
  dark: true,
  noiseOpacity: 0.035,
  gradientHero: 'radial-gradient(ellipse 80% 60% at 50% 30%, #0C2650 0%, #01112A 100%)',
  gradientText: 'linear-gradient(135deg, #7EC8F8 0%, #4FA3E8 50%, #A0D8FF 100%)',
  meshGradient: 'radial-gradient(ellipse 80% 60% at 20% 25%, rgba(79,163,232,0.15) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 75%, rgba(79,163,232,0.1) 0%, transparent 55%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.6)',
  cardShadowHover: '0 8px 40px rgba(0,0,0,0.8), 0 0 24px rgba(79,163,232,0.22)',
};

const SAGE_TOKENS: PluginTokens = {
  bg: '#F2F0EB',
  surface: '#FAFAF7',
  surfaceAlt: '#E8E5DE',
  surfaceCard: '#F5F3EE',
  text: '#2A3228',
  textMuted: '#5A6858',
  textSubtle: '#8A9888',
  accent: '#4A6741',
  accentDim: '#3A5230',
  accentRgb: '74,103,65',
  glowColor: 'rgba(74,103,65,0.25)',
  border: '#D0CEC5',
  borderSubtle: '#E0DDD5',
  heroFont: 'Fraunces',
  bodyFont: 'Nunito Sans',
  heroWeight: 300,
  heroStyle: 'italic',
  labelTracking: '0.16em',
  dark: false,
  noiseOpacity: 0.02,
  gradientHero: 'radial-gradient(ellipse 70% 50% at 50% 40%, #FAFAF7 0%, #F2F0EB 100%)',
  gradientText: 'linear-gradient(135deg, #5A8050 0%, #4A6741 50%, #6A9060 100%)',
  meshGradient: 'radial-gradient(ellipse 70% 50% at 20% 30%, rgba(74,103,65,0.1) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 80% 70%, rgba(74,103,65,0.07) 0%, transparent 55%)',
  cardShadow: '0 2px 16px rgba(42,50,40,0.1)',
  cardShadowHover: '0 8px 32px rgba(42,50,40,0.18), 0 0 16px rgba(74,103,65,0.15)',
};

// ── Plugin registry ──────────────────────────────────────────────────────────

export const PLUGINS: PluginMeta[] = [
  {
    id: 'obsidian',
    name: 'Obsidian Luxury',
    description: 'Dark editorial with refined gold accents',
    character: 'WSJ meets Bottega Veneta',
    tokens: OBSIDIAN_TOKENS,
    fonts: [
      { family: 'Cormorant Garamond', url: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap' },
      { family: 'DM Sans', url: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'ivory',
    name: 'Ivory Editorial',
    description: 'Light magazine with confident ink black',
    character: 'The Economist meets Kinfolk',
    tokens: IVORY_TOKENS,
    fonts: [
      { family: 'Playfair Display', url: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap' },
      { family: 'Libre Franklin', url: 'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'cobalt',
    name: 'Cobalt Executive',
    description: 'Deep navy with electric blue command',
    character: 'Bloomberg meets McKinsey',
    tokens: COBALT_TOKENS,
    fonts: [
      { family: 'Syne', url: 'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap' },
      { family: 'DM Sans', url: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'sage',
    name: 'Sage Organic',
    description: 'Warm earth tones with forest greens',
    character: 'Patagonia meets IDEO',
    tokens: SAGE_TOKENS,
    fonts: [
      { family: 'Fraunces', url: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap' },
      { family: 'Nunito Sans', url: 'https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@300;400;500;600&display=swap' },
    ],
  },
];

export function getPlugin(id: string): PluginMeta {
  return PLUGINS.find((p) => p.id === id) ?? PLUGINS[0];
}

/**
 * Fetch the live plugin list from the API.
 * Falls back to the static PLUGINS array on error.
 */
export async function fetchPluginsFromApi(apiKey: string): Promise<PluginMeta[]> {
  try {
    const res = await fetch('/api/plugins', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return PLUGINS;
    const data = (await res.json()) as { plugins?: unknown[] };
    if (!Array.isArray(data.plugins) || data.plugins.length === 0) return PLUGINS;

    return (data.plugins as Array<{
      id: string;
      manifest: { displayName: string; [k: string]: unknown };
      tokens: PluginTokens;
      fonts: { family: string; url: string }[];
    }>).map(p => ({
      id: p.id,
      name: p.manifest.displayName ?? p.id,
      description: String((p.manifest as Record<string, unknown>).description ?? ''),
      character: String((p.manifest as Record<string, unknown>).character ?? ''),
      tokens: p.tokens,
      fonts: p.fonts ?? [],
    }));
  } catch {
    return PLUGINS;
  }
}

/** Apply brand primaryColor as accent override */
export function applyBrandOverride(tokens: PluginTokens, brandPrimary: string): PluginTokens {
  if (!brandPrimary) return tokens;
  return { ...tokens, accent: brandPrimary };
}

// ── Color utilities (pure math, no deps) ─────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  try {
    const n = parseInt(hex.replace('#', ''), 16);
    if (isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } catch { return null; }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
      case gn: h = ((bn - rn) / d + 2) / 6; break;
      case bn: h = ((rn - gn) / d + 4) / 6; break;
    }
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function shiftL(hex: string, delta: number, fallback: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return fallback;
  const [h, s, l] = rgbToHsl(...rgb);
  const [r, g, b] = hslToRgb(h, s, Math.max(0, Math.min(1, l + delta)));
  return rgbToHex(r, g, b);
}

function blendHex(hexA: string, hexB: string, t: number, fallback: string): string {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  if (!a || !b) return fallback;
  return rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

/**
 * Derive a full PluginTokens set from LLM-synthesized tier-1 fields.
 *
 * Two-layer resolution:
 *   Layer 1 — Concrete hex/font/weight values from tier1 (bg, text, accent, etc.)
 *   Layer 2 — Semantic design system signals (visualStyle, typography.style,
 *             colorStrategy, componentStyle) actively shape computed tokens
 *             (gradients, shadows, glow, noise, mesh) to create VISUAL
 *             distinctiveness between editorial / bold / minimal personalities.
 *
 * Any parse failure falls back to the corresponding base token.
 */
export function deriveTokens(base: PluginTokens, tier1: Partial<PluginTokens>): PluginTokens {
  // ── Layer 1: concrete base values ─────────────────────────────────────────
  const bg     = (typeof tier1.bg     === 'string' && hexToRgb(tier1.bg))     ? tier1.bg     : base.bg;
  const text   = (typeof tier1.text   === 'string' && hexToRgb(tier1.text))   ? tier1.text   : base.text;
  const accent = (typeof tier1.accent === 'string' && hexToRgb(tier1.accent)) ? tier1.accent : base.accent;
  const dark   = typeof tier1.dark === 'boolean' ? tier1.dark : base.dark;

  // ── Layer 2: semantic design system signals ────────────────────────────────
  // tier1 is typed as Partial<PluginTokens> but at runtime contains the full
  // LLM rawTokens object which includes extra semantic fields.
  const ds             = tier1 as Record<string, unknown>;
  const dsTypography   = ds.typography   as Record<string, unknown> | undefined;
  const dsColor        = ds.colorStrategy as Record<string, unknown> | undefined;
  const dsComponent    = ds.componentStyle as Record<string, unknown> | undefined;

  const visualStyle     = typeof ds.visualStyle          === 'string' ? ds.visualStyle.toLowerCase()          : '';
  const typographyStyle = typeof dsTypography?.style     === 'string' ? dsTypography.style.toLowerCase()      : '';
  const contrastLevel   = typeof dsColor?.contrast       === 'string' ? dsColor.contrast.toLowerCase()        : 'moderate';
  const accentUsage     = typeof dsColor?.accentUsage    === 'string' ? dsColor.accentUsage.toLowerCase()     : 'moderate';
  const shadowStyle     = typeof dsComponent?.shadow     === 'string' ? dsComponent.shadow.toLowerCase()      : 'subtle';
  const dsDensity       = typeof tier1.density           === 'string' ? tier1.density                         : 'comfortable';

  // Intent flags — drive the computed-token switches below
  const isEditorial = typographyStyle.includes('editorial') || typographyStyle.includes('serif') || visualStyle.includes('editorial');
  const isBold      = visualStyle.includes('bold') || visualStyle.includes('monumental') || contrastLevel === 'extreme';
  const isMinimal   = (dsDensity === 'compact' && shadowStyle === 'none') || visualStyle.includes('minimal');

  // ── Surface colors ─────────────────────────────────────────────────────────
  const surface     = shiftL(bg, dark ? 0.04 : -0.03, base.surface);
  const surfaceAlt  = shiftL(bg, dark ? 0.08 : -0.06, base.surfaceAlt);
  const surfaceCard = blendHex(bg, surface, 0.5, base.surfaceCard);

  // ── Text colors — contrast-aware ──────────────────────────────────────────
  // extreme contrast → less blending with bg → crisper text hierarchy
  const textBlendMuted  = contrastLevel === 'extreme' ? 0.32 : contrastLevel === 'high' ? 0.40 : 0.45;
  const textBlendSubtle = contrastLevel === 'extreme' ? 0.56 : contrastLevel === 'high' ? 0.65 : 0.68;
  const textMuted  = blendHex(text, bg, textBlendMuted,  base.textMuted);
  const textSubtle = blendHex(text, bg, textBlendSubtle, base.textSubtle);

  // ── Accent — accentUsage boosts or subdues saturation ─────────────────────
  const accentBoost   = accentUsage === 'dominant' ? 0.08 : accentUsage === 'sparingly' ? -0.06 : 0;
  const accentFinal   = accentBoost !== 0 ? shiftL(accent, accentBoost, accent) : accent;
  const accentDim     = shiftL(accentFinal, -0.15, base.accentDim);
  const accentRgb     = (() => { const rgb = hexToRgb(accentFinal); return rgb ? `${rgb[0]},${rgb[1]},${rgb[2]}` : base.accentRgb; })();

  // ── Glow — personality-driven opacity ─────────────────────────────────────
  //   editorial → whisper glow (typography carries the weight)
  //   bold      → blazing glow (accent is dominant)
  //   minimal   → near-none
  const glowOpacity = isEditorial ? 0.10 : isBold ? 0.42 : isMinimal ? 0.08 : 0.28;
  const glowColor   = `rgba(${accentRgb},${glowOpacity})`;

  // ── Borders ─────────────────────────────────────────────────────────────────
  const border       = shiftL(surfaceAlt, dark ? 0.04 : -0.04, base.border);
  const borderSubtle = blendHex(surface, surfaceAlt, 0.4, base.borderSubtle);

  // ── Hero gradient ──────────────────────────────────────────────────────────
  //   editorial → nearly flat, barely-there gradient (typography lives in clean air)
  //   bold      → dramatic angled, directional — high visual energy
  //   minimal   → solid colour, zero gradient
  //   default   → balanced radial
  const gradientHero = isEditorial
    ? `radial-gradient(ellipse 140% 100% at 50% 60%, ${surfaceAlt}44 0%, ${bg} 55%)`
    : isBold
      ? `radial-gradient(ellipse 110% 90% at 18% 12%, ${surfaceAlt} 0%, ${bg} 68%), radial-gradient(ellipse 60% 50% at 82% 82%, ${shiftL(bg, dark ? 0.06 : -0.04, bg)} 0%, transparent 55%)`
      : isMinimal
        ? bg  // solid — no gradient whatsoever
        : `radial-gradient(ellipse 80% 60% at 50% 40%, ${surfaceAlt} 0%, ${bg} 100%)`;

  // ── Gradient text ──────────────────────────────────────────────────────────
  //   editorial → solid accent (no gradient — typographic purity)
  //   bold      → wide, high-contrast spread
  //   default   → standard spread
  const accentLight = shiftL(accentFinal, 0.12, accentFinal);
  const gradientText = isEditorial
    ? `linear-gradient(135deg, ${accentFinal} 0%, ${accentFinal} 100%)`
    : isBold
      ? `linear-gradient(135deg, ${accentLight} 0%, ${accentFinal} 35%, ${shiftL(accentFinal, 0.16, accentFinal)} 100%)`
      : `linear-gradient(135deg, ${accentLight} 0%, ${accentFinal} 50%, ${shiftL(accentFinal, 0.08, accentFinal)} 100%)`;

  // ── Mesh gradient ──────────────────────────────────────────────────────────
  //   editorial / minimal → '' (falsy → components skip rendering it)
  //   bold      → large, high-opacity blobs — strong ambient colour field
  //   default   → standard soft blobs
  const meshGradient = (isEditorial || isMinimal)
    ? ''
    : isBold
      ? `radial-gradient(ellipse 110% 85% at 14% 18%, rgba(${accentRgb},0.22) 0%, transparent 52%), radial-gradient(ellipse 85% 75% at 86% 82%, rgba(${accentRgb},0.16) 0%, transparent 48%)`
      : `radial-gradient(ellipse 80% 60% at 20% 25%, rgba(${accentRgb},0.12) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 75%, rgba(${accentRgb},0.08) 0%, transparent 55%)`;

  // ── Shadows ────────────────────────────────────────────────────────────────
  //   none / minimal   → flat, outline only
  //   colored / bold   → accent-tinted depth
  //   strong           → deep monochrome
  //   editorial        → whisper — barely lifted
  //   default          → standard depth
  let cardShadow: string;
  let cardShadowHover: string;

  if (shadowStyle === 'none' || isMinimal) {
    cardShadow      = 'none';
    cardShadowHover = `0 0 0 1px ${border}`;
  } else if (shadowStyle === 'colored' || isBold) {
    cardShadow      = dark
      ? `0 6px 32px rgba(0,0,0,0.60), 0 0 0 1px rgba(${accentRgb},0.12)`
      : `0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(${accentRgb},0.15)`;
    cardShadowHover = dark
      ? `0 12px 48px rgba(0,0,0,0.75), 0 0 28px rgba(${accentRgb},0.28)`
      : `0 12px 40px rgba(0,0,0,0.18), 0 0 20px rgba(${accentRgb},0.22)`;
  } else if (shadowStyle === 'strong') {
    cardShadow      = dark ? '0 8px 40px rgba(0,0,0,0.70)' : '0 4px 24px rgba(0,0,0,0.15)';
    cardShadowHover = dark ? '0 16px 56px rgba(0,0,0,0.85)' : '0 8px 40px rgba(0,0,0,0.22)';
  } else if (isEditorial) {
    cardShadow      = dark ? '0 1px 8px rgba(0,0,0,0.25)' : '0 1px 6px rgba(0,0,0,0.06)';
    cardShadowHover = dark ? '0 4px 20px rgba(0,0,0,0.40)' : '0 4px 16px rgba(0,0,0,0.10)';
  } else {
    cardShadow      = dark ? '0 4px 24px rgba(0,0,0,0.50)' : '0 2px 16px rgba(0,0,0,0.08)';
    cardShadowHover = dark
      ? `0 8px 40px rgba(0,0,0,0.70), 0 0 20px rgba(${accentRgb},0.18)`
      : `0 8px 32px rgba(0,0,0,0.14), 0 0 0 1px rgba(${accentRgb},0.10)`;
  }

  // ── Noise opacity — style-modulated ───────────────────────────────────────
  //   editorial → capped low (clean surface)
  //   bold      → amplified (more tactile texture)
  const baseNoise    = typeof tier1.noiseOpacity === 'number' ? tier1.noiseOpacity : base.noiseOpacity;
  const noiseOpacity = isEditorial ? Math.min(baseNoise, 0.015) : isBold ? Math.min(baseNoise * 1.5, 0.06) : baseNoise;

  return {
    bg, surface, surfaceAlt, surfaceCard,
    text, textMuted, textSubtle,
    accent: accentFinal, accentDim, accentRgb, glowColor,
    border, borderSubtle,
    heroFont:      typeof tier1.heroFont      === 'string' ? tier1.heroFont      : base.heroFont,
    bodyFont:      typeof tier1.bodyFont      === 'string' ? tier1.bodyFont      : base.bodyFont,
    heroWeight:    typeof tier1.heroWeight    === 'number' ? tier1.heroWeight    : base.heroWeight,
    heroStyle:     typeof tier1.heroStyle     === 'string' ? tier1.heroStyle     : base.heroStyle,
    labelTracking: typeof tier1.labelTracking === 'string' ? tier1.labelTracking : base.labelTracking,
    dark,
    noiseOpacity,
    gradientHero, gradientText, meshGradient,
    cardShadow, cardShadowHover,
    ...(typeof tier1.borderRadius === 'string' ? { borderRadius: tier1.borderRadius } : {}),
    ...(typeof tier1.buttonStyle  === 'string' ? { buttonStyle:  tier1.buttonStyle  } : {}),
    ...(typeof tier1.density      === 'string' ? { density:      tier1.density      } : {}),
  };
}

/**
 * Single token resolution point for the renderer.
 * Applies brand override first, then LLM-generated tokens if present.
 *
 * Gate hardened: if customTokens is provided at all, deriveTokens() always runs.
 * Any missing/invalid hex colors are supplemented from the base theme so the
 * LLM's semantic fields (visualStyle, typography, componentStyle, etc.) still
 * drive the computed tokens even when color fields are absent or malformed.
 */
export function resolveTokens(
  pluginId: string,
  brandPrimaryColor: string,
  customTokens?: Partial<PluginTokens>,
): PluginTokens {
  const base = getPlugin(pluginId).tokens;
  const withBrand = applyBrandOverride(base, brandPrimaryColor);
  if (!customTokens) return withBrand;

  // Validate hex colors, fall back to base theme values when invalid.
  // This ensures deriveTokens() runs unconditionally and semantic fields
  // (visualStyle, typography.style, colorStrategy, etc.) always take effect.
  const enriched: Partial<PluginTokens> = {
    ...customTokens,
    bg:    (typeof customTokens.bg     === 'string' && hexToRgb(customTokens.bg))     ? customTokens.bg     : withBrand.bg,
    text:  (typeof customTokens.text   === 'string' && hexToRgb(customTokens.text))   ? customTokens.text   : withBrand.text,
    accent:(typeof customTokens.accent === 'string' && hexToRgb(customTokens.accent)) ? customTokens.accent : withBrand.accent,
    dark:  typeof customTokens.dark === 'boolean' ? customTokens.dark : withBrand.dark,
  };
  return deriveTokens(withBrand, enriched);
}

/** Get gradient for a section type (fallback imagery) */
export function getSectionGradient(type: string, tokens: PluginTokens): string {
  switch (type) {
    case 'hero':        return tokens.gradientHero;
    case 'challenge':   return `radial-gradient(ellipse 70% 50% at 50% 50%, ${tokens.surfaceCard} 0%, ${tokens.bg} 100%)`;
    case 'approach':    return `linear-gradient(180deg, ${tokens.bg} 0%, ${tokens.surfaceAlt} 100%)`;
    case 'pricing':     return `radial-gradient(ellipse 60% 40% at 50% 20%, ${tokens.surfaceAlt} 0%, ${tokens.bg} 100%)`;
    case 'whyus':       return `linear-gradient(180deg, ${tokens.surfaceCard} 0%, ${tokens.surface} 100%)`;
    default:            return `linear-gradient(180deg, ${tokens.bg} 0%, ${tokens.surfaceAlt} 50%, ${tokens.bg} 100%)`;
  }
}
