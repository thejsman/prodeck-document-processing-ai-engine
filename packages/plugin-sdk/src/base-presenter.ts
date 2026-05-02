import type { PluginManifest } from './plugin-manifest.js';

// ── Presenter token schema ────────────────────────────────────────────────
// Mirrors PluginTokens in services/ui/src/types/presentation.ts
// Kept in the SDK so plugins have no UI dependency.

export interface PresenterTokens {
  bg: string;
  surface: string;
  surfaceAlt: string;
  surfaceCard: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
  accentDim: string;
  accentRgb: string;
  glowColor: string;
  border: string;
  borderSubtle: string;
  heroFont: string;
  bodyFont: string;
  heroWeight: number;
  heroStyle: string;
  labelTracking: string;
  dark: boolean;
  noiseOpacity: number;
  gradientHero: string;
  gradientText: string;
  meshGradient: string;
  cardShadow: string;
  cardShadowHover: string;
  // Optional design-control tokens (LLM-synthesized)
  borderRadius?: string;
  buttonStyle?: string;
  density?: string;
  iconBg?: string;
}

export interface PresenterFont {
  family: string;
  url: string;
}

// ── PresentationPlugin interface ─────────────────────────────────────────

/**
 * The contract every presenter plugin must satisfy.
 *
 * Minimal plugin:
 * ```ts
 * export default {
 *   manifest,
 *   tokens: OBSIDIAN_TOKENS,
 *   fonts: [{ family: 'DM Sans', url: '...' }],
 * } satisfies PresentationPlugin;
 * ```
 */
export interface PresentationPlugin {
  manifest: PluginManifest;
  tokens: PresenterTokens;
  fonts: PresenterFont[];
  /**
   * Optional: return a custom React component for a section type.
   * Return `null` to fall back to the built-in renderer.
   * Type is `unknown` to avoid a React dependency in the SDK.
   */
  getSectionComponent?(sectionType: string): unknown | null;
}
