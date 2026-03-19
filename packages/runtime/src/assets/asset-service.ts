import { Readable } from 'node:stream';
import type { StorageProvider } from '@ai-engine/core';
import { resolveStorageUri } from '../storage/storage-uri.js';

// ── Types ──────────────────────────────────────────────────────────

export interface AssetMeta {
  uri: string;
  size: number;
  mimeType: string;
  executionId?: string;
  createdAt: string;
  namespace: string;
}

export type StorageProviderFactory =
  (namespace: string) => StorageProvider | Promise<StorageProvider>;

// ── Constants ──────────────────────────────────────────────────────

/** Hard cap on signed URL TTL to limit blast radius of leaked URLs. */
const MAX_SIGNED_URL_TTL = 3600; // 1 hour

/** Default TTL for signed URLs (5 minutes). */
const DEFAULT_SIGNED_URL_TTL = 300;

// ── AssetService ───────────────────────────────────────────────────

/**
 * Unified asset access layer.
 *
 * Resolves storage URIs and delegates reads to the appropriate
 * StorageProvider (local or S3) without exposing backend details
 * to consumers.
 *
 * Usage in API route handlers:
 *
 *   const service = new AssetService(
 *     async (ns) => getStorageProvider({ namespace: ns, config, workdir }),
 *     '/api/assets/download',
 *   );
 *   const buf = await service.getBuffer(uri);
 */
export class AssetService {
  private readonly factory: StorageProviderFactory;
  private readonly localDownloadBaseUrl: string;

  /**
   * @param factory             - Returns a StorageProvider scoped to the given namespace.
   * @param localDownloadBaseUrl - Base URL for the asset download API endpoint.
   *                              Used as the fallback URL for local assets when
   *                              getSignedReadUrl() is called.
   *                              Defaults to "/api/assets/download".
   */
  constructor(
    factory: StorageProviderFactory,
    localDownloadBaseUrl = '/api/assets/download',
  ) {
    this.factory = factory;
    this.localDownloadBaseUrl = localDownloadBaseUrl;
  }

  // ── Private ──────────────────────────────────────────────────────

  private async providerFor(uri: string): Promise<{ provider: StorageProvider; relativePath: string }> {
    const resolved = resolveStorageUri(uri);
    const provider = await this.factory(resolved.namespace);
    return { provider, relativePath: resolved.relativePath };
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Read the full content of an asset into memory as a Buffer.
   * Suitable for small-to-medium files (documents, diagrams, configs).
   */
  async getBuffer(uri: string): Promise<Buffer> {
    const { provider, relativePath } = await this.providerFor(uri);
    return provider.readFile(relativePath);
  }

  /**
   * Return a Node.js Readable stream for the asset content.
   * For large files prefer streaming to avoid buffering the whole object.
   */
  async getReadStream(uri: string): Promise<Readable> {
    const buffer = await this.getBuffer(uri);
    return Readable.from(buffer);
  }

  /**
   * Return a URL suitable for direct client-side download.
   *
   * - S3 assets: generates a pre-signed URL (direct S3 access, bypasses API).
   * - Local assets: returns the API download endpoint URL with encoded URI.
   *
   * @param uri        - Storage URI as returned by SaveAssetTool.
   * @param ttlSeconds - How long the URL remains valid.  Clamped to 1 hour max.
   *                     Defaults to 5 minutes.
   */
  async getSignedReadUrl(
    uri: string,
    ttlSeconds: number = DEFAULT_SIGNED_URL_TTL,
  ): Promise<string> {
    const clampedTtl = Math.min(Math.max(ttlSeconds, 1), MAX_SIGNED_URL_TTL);
    const resolved = resolveStorageUri(uri);
    const provider = await this.factory(resolved.namespace);

    if (resolved.provider === 's3' && typeof provider.getSignedUrl === 'function') {
      return provider.getSignedUrl(resolved.relativePath, clampedTtl);
    }

    // Local (or S3 without signed URL support): return download endpoint URL
    return `${this.localDownloadBaseUrl}?uri=${encodeURIComponent(uri)}`;
  }
}
