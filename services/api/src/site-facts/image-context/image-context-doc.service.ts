// services/api/src/site-facts/image-context/image-context-doc.service.ts
//
// Assembles the single image-context.md output. Fully deterministic — the
// per-image LLM captions already happened in vision-caption.service.ts, so
// no further LLM call is needed just to format a table.

import type { ImageAsset } from './types.js';

export function buildImageContextDoc(siteUrl: string, assets: ImageAsset[]): string {
  const lines: string[] = [`# Image Context — ${siteUrl}`, ''];

  if (assets.length === 0) {
    lines.push('No usable images were found on the crawled pages.');
    return lines.join('\n') + '\n';
  }

  lines.push('## Image Inventory', '', '| Role | Dimensions | Alt | URL |', '|---|---|---|---|');
  for (const asset of assets) {
    const alt = asset.alt.replace(/\|/g, '\\|') || '(none)';
    lines.push(`| ${asset.role} | ${asset.width}×${asset.height} | ${alt} | ${asset.url} |`);
  }

  lines.push('', '## Descriptions', '');
  for (const asset of assets) {
    lines.push(`- **${asset.url}**: ${asset.description ?? '(captioning failed for this image)'}`);
  }

  return lines.join('\n') + '\n';
}
