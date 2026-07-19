// services/api/src/site-facts/image-context/types.ts
//
// Shared types for the image-context module. Fully disjoint from design/
// (no shared internals) and from fact-extraction — the only permitted
// imports from the parent are SiteManifest/SiteFactsLogger (../types.js)
// and readManifest (../store.js), same rule design/ already follows.

export const MAX_PAGES = 3;
export const MAX_IMAGES = 6;
/** Below this rendered size (either dimension), an image is treated as an icon and skipped. */
export const MIN_IMAGE_DIMENSION_PX = 100;

export interface ImageAsset {
  url: string;
  alt: string;
  width: number;
  height: number;
  role: 'logo' | 'content';
  /** Short factual caption from a vision call — null if captioning failed for this image. */
  description: string | null;
}
