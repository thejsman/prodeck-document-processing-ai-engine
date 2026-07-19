// services/api/src/site-facts/design/types.ts
//
// Shared types for the design-tokens + layout-vision extraction module.
// Deliberately decoupled from fact-extraction (only SiteManifest/
// SiteFactsLogger and readManifest are shared) AND from the image-context
// module (no shared code — this module's vision pass describes overall page
// layout/composition; image-context captions individual real image assets).

export const DESIGN_VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

export type ViewportName = (typeof DESIGN_VIEWPORTS)[number]['name'];

export type PageRole = 'homepage' | 'listing' | 'detail' | 'form' | 'notfound';

export type ElementGroup =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'p' | 'a' | 'button' | 'input' | 'label'
  | 'container' | 'card';

export const MAX_DESIGN_PAGES = 5;

// ---------------------------------------------------------------------------
// Raw computed-style capture (deterministic, pre-clustering)
// ---------------------------------------------------------------------------

export interface ElementSample {
  group: ElementGroup;
  tag: string;
  /** Number of elements collapsed into this unique style tuple. */
  count: number;
  color: string;
  background_color: string;
  border_color: string;
  font_family: string;
  font_size: string;
  font_weight: string;
  line_height: string;
  letter_spacing: string;
  margin: [string, string, string, string];
  padding: [string, string, string, string];
  gap: string;
  border_radius: string;
  box_shadow: string;
}

export interface ImageSample {
  kind: 'img' | 'svg';
  rendered_w: number;
  rendered_h: number;
  aspect_ratio: number;
}

export interface RawViewportStyles {
  viewport: ViewportName;
  width: number;
  element_samples: ElementSample[];
  image_samples: ImageSample[];
  icon_summary: { svg_count: number; raster_count: number };
}

export interface RawPageStyles {
  url: string;
  role: PageRole;
  viewports: RawViewportStyles[];
}

export interface RawComputedStyles {
  site_url: string;
  captured_at: string;
  pages: RawPageStyles[];
}

// ---------------------------------------------------------------------------
// Clustered tokens (deterministic, pre-LLM)
// ---------------------------------------------------------------------------

export interface Lab {
  L: number;
  a: number;
  b: number;
}

export interface ColorCluster {
  /** Most-frequent measured member — never an average. */
  hex: string;
  lab: Lab;
  total_count: number;
  /** Max delta-E from the representative within the cluster. */
  delta_e_spread: number;
  usage: { text: number; background: number; border: number };
  groups: Partial<Record<ElementGroup, number>>;
  /** e.g. "homepage:desktop:button:background" — capped at 5. */
  sources: string[];
}

export interface RoleAssignedColors {
  primary: ColorCluster | null;
  secondary: ColorCluster | null;
  accent: ColorCluster[];
  /** Ordered light → dark. */
  neutral: ColorCluster[];
  semantic: { hueName: 'red' | 'green' | 'amber'; cluster: ColorCluster }[];
}

export interface ScaleStep {
  value_px: number;
  count: number;
  used_by: string[];
}

export interface ShadowValue {
  css: string;
  count: number;
}

export interface ClusteredTokens {
  colors: RoleAssignedColors;
  font_families: { family: string; stack: string; used_by: ElementGroup[]; count: number }[];
  /** Ascending px. */
  type_scale: ScaleStep[];
  font_weights: number[];
  spacing_scale: ScaleStep[];
  radius_scale: ScaleStep[];
  has_pill_radius: boolean;
  shadows: ShadowValue[];
  icons: { svg_count: number; raster_count: number };
  image_aspect_ratios: { ratio: string; count: number }[];
}

export interface SelectedPage {
  url: string;
  role: PageRole;
}

// ---------------------------------------------------------------------------
// Layout/component-pattern vision analysis. Screenshots are transient — held
// in memory only for the duration of a vision call, never written to disk.
// ---------------------------------------------------------------------------

export interface ScreenshotSpec {
  id: string;
  kind: 'fullpage' | 'crop';
  /** Which selected page to shoot (matched by role). */
  pageRole: PageRole;
  viewport: ViewportName;
  /** For crops: deterministic CSS selector of the region. */
  cropSelector?: string;
}

export interface CapturedScreenshot {
  id: string;
  pageUrl: string;
  viewport: ViewportName;
  kind: 'fullpage' | 'crop';
  /** In-memory only — never persisted to disk. */
  base64Jpeg: string;
}

export const VISION_COMPONENTS = ['nav', 'hero', 'card', 'button', 'form', 'footer', 'section', 'other'] as const;
export type VisionComponent = (typeof VISION_COMPONENTS)[number];

export interface VisionScreenshotAnalysis {
  screenshot_id: string;
  style_adjectives: string[];
  components: { component: VisionComponent; description: string }[];
  layout_notes: string[];
}

export interface VisionAnalysis {
  analyzed_at: string;
  screenshots: VisionScreenshotAnalysis[];
  failed_screenshot_ids: string[];
  merged: {
    adjectives: { term: string; seen_in: string[] }[];
    component_inventory: { component: VisionComponent; descriptions: { text: string; screenshot_id: string }[] }[];
    layout_notes: { text: string; screenshot_id: string }[];
  };
}

// ---------------------------------------------------------------------------
// W3C DTCG design tokens
// ---------------------------------------------------------------------------

export interface DtcgToken {
  $type: string;
  $value: unknown;
  $extensions?: { 'com.prodeck.design': Record<string, unknown> };
}

export interface DtcgGroup {
  [key: string]: DtcgToken | DtcgGroup;
}

export interface DtcgDocument {
  $description: string;
  [group: string]: DtcgToken | DtcgGroup | string;
}
