/**
 * Design Kit — pure types for Phase 2 of the org-level "Inspiration & Global Context"
 * feature. Assets are uploaded, vision-tagged, and projected into a DesignKit that
 * is gap-filled into microsite generation metadata.
 *
 * Pure module: no fs, no net, no env, no clock.
 */

export type AssetType =
  | 'logo'
  | 'hero'
  | 'background'
  | 'palette'
  | 'typography'
  | 'inspiration'
  | 'other';

/** Metadata for a single uploaded design asset, enriched by vision tagging. */
export interface AssetMetadata {
  id: string;
  fileName: string;
  mediaType: string;       // MIME type, e.g. 'image/png'
  size: number;
  uploadedAt: string;
  assetType: AssetType;
  isPrimary: boolean;      // user-marked primary for its type (logo, hero, etc.)
  palette: string[];       // HEX colors only, e.g. ['#1A2B3C', '#E5F0FA']
  fontHints: string[];     // typography observations, e.g. ['sans-serif', 'bold headings']
  tags: string[];          // descriptive keyword tags for brand character
  description: string;     // one-sentence description from vision
  status: 'processing' | 'tagged' | 'failed';
  error?: string;
}

/**
 * The pure projection output — what `projectDesignKit` returns.
 * The persistence adapter adds `logoBase64`, `heroBase64`, `dominantColors`, and `updatedAt`.
 */
export interface ComputedDesignKit {
  primaryColor: string | null;   // dominant brand color (HEX), from primary logo/palette
  palette: string[];             // deduplicated merged palette, max 6 HEX
  fontHints: string[];           // aggregated typography hints, max 5
  logoAssetId: string | null;    // id of the chosen logo asset
  heroAssetId: string | null;    // id of the chosen hero/background asset
  designBrief: string;           // auto-generated design guidance sentence
}

/** Full persisted design kit — pure projection + adapter-supplied fields. */
export interface DesignKit extends ComputedDesignKit {
  logoBase64?: string;           // base64 content of logo file (for referenceFile injection)
  logoMediaType?: string;
  heroBase64?: string;           // base64 content of hero/background file
  heroMediaType?: string;
  dominantColors: string[];      // ≥2 HEX for referenceFile.dominantColors fast path
  updatedAt: string;
}
