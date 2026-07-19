// services/api/src/site-facts/image-context/page-selection.ts
//
// Own lightweight page pick — independent of design/page-selection.ts by
// design (this module must not share internals with design/). Homepage
// first (most likely to carry the logo/hero), then a couple more pages in
// manifest order for image variety.

import type { SiteManifest } from '../types.js';
import { MAX_PAGES } from './types.js';

export function selectImagePages(manifest: SiteManifest): string[] {
  const urls = manifest.page_urls;
  if (urls.length === 0) return [];

  const withPath = urls
    .map((url) => {
      try {
        return { url, depth: new URL(url).pathname.split('/').filter(Boolean).length };
      } catch {
        return null;
      }
    })
    .filter((x): x is { url: string; depth: number } => x !== null);
  if (withPath.length === 0) return [];

  const homepage = [...withPath].sort((a, b) => a.depth - b.depth)[0];
  const rest = withPath.filter((p) => p.url !== homepage.url).map((p) => p.url);

  return [homepage.url, ...rest].slice(0, MAX_PAGES);
}
