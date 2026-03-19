import type { StorageProvider } from '@ai-engine/core';
import type { AssetMeta } from './asset-service.js';
import { getMimeType } from './mime-types.js';

// ── Types ──────────────────────────────────────────────────────────

export interface AssetListItem {
  /** Normalized storage URI (local:// or s3://). */
  uri: string;
  /** File size in bytes, if available from metadata. */
  size?: number;
  /** ISO 8601 creation timestamp, if available from metadata. */
  createdAt?: string;
  /** MIME type derived from metadata or file extension. */
  mimeType: string;
  /** Namespace the asset belongs to. */
  namespace: string;
}

// ── Helper ────────────────────────────────────────────────────────

/**
 * Derive the metadata file path for a given asset path.
 *
 * Convention: strip the extension, append ".meta.json".
 *   "assets/diagram-1.mmd"  →  "assets/diagram-1.meta.json"
 *   "assets/report"         →  "assets/report.meta.json"
 */
function metaPathFor(relativePath: string): string {
  const dot = relativePath.lastIndexOf('.');
  const stem = dot > 0 ? relativePath.slice(0, dot) : relativePath;
  return `${stem}.meta.json`;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * List all assets under a storage prefix for a namespace.
 *
 * For each asset, attempts to read the companion `.meta.json` file.
 * Falls back to extension-based MIME detection when metadata is absent.
 *
 * @param provider  - StorageProvider already scoped to the namespace.
 * @param namespace - Namespace slug (used to construct fallback URIs).
 * @param prefix    - Subtree to list.  Defaults to "assets".
 */
export async function listAssets(
  provider: StorageProvider,
  namespace: string,
  prefix = 'assets',
): Promise<AssetListItem[]> {
  const paths = await provider.list(prefix);
  const items: AssetListItem[] = [];

  for (const relativePath of paths) {
    // Skip metadata sidecar files — they are not user-facing assets
    if (relativePath.endsWith('.meta.json')) continue;

    const metaPath = metaPathFor(relativePath);

    try {
      const metaBuf = await provider.readFile(metaPath);
      const meta = JSON.parse(metaBuf.toString('utf-8')) as Partial<AssetMeta>;
      items.push({
        uri:       meta.uri ?? `local://namespaces/${namespace}/${relativePath}`,
        size:      meta.size,
        createdAt: meta.createdAt,
        mimeType:  meta.mimeType ?? getMimeType(relativePath),
        namespace,
      });
    } catch {
      // No metadata sidecar — build a basic item from the path alone
      const dot = relativePath.lastIndexOf('/');
      const fileName = dot >= 0 ? relativePath.slice(dot + 1) : relativePath;
      items.push({
        uri:      `local://namespaces/${namespace}/${relativePath}`,
        mimeType: getMimeType(fileName),
        namespace,
      });
    }
  }

  return items;
}
