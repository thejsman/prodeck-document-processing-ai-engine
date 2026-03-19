/**
 * Storage URI resolver.
 *
 * Parses the normalized storage URIs produced by StorageProvider.writeFile()
 * back into their structural components.
 *
 * Supported schemes:
 *   local://namespaces/{ns}/{relativePath}
 *   s3://{bucket}/{...prefix}/namespaces/{ns}/{relativePath}
 */

export interface ResolvedUri {
  /** Which backend owns this URI. */
  provider: 'local' | 's3';

  /**
   * Namespace slug extracted from the URI path.
   * Always present — all URIs must be namespace-scoped.
   */
  namespace: string;

  /**
   * Path relative to the namespace root.
   * This is what gets passed to StorageProvider.readFile() / writeFile().
   * e.g. "assets/diagram-1.mmd"
   */
  relativePath: string;

  /** S3 only: bucket name. */
  bucket?: string;

  /** S3 only: full S3 object key, including prefix. */
  fullKey?: string;
}

// ── Internal helpers ──────────────────────────────────────────────

/**
 * Find the "namespaces/{ns}/{...rest}" segment in a split path array
 * and return the namespace + remaining relative path.
 */
function extractNamespace(segments: string[]): { namespace: string; relativePath: string } {
  const idx = segments.indexOf('namespaces');
  if (idx === -1 || idx + 1 >= segments.length) {
    throw new Error('Storage URI: missing "namespaces/{namespace}" segment');
  }

  const namespace = segments[idx + 1];
  if (!namespace) {
    throw new Error('Storage URI: namespace segment is empty');
  }

  const relSegments = segments.slice(idx + 2);
  if (relSegments.length === 0) {
    throw new Error('Storage URI: no path component after namespace segment');
  }

  const relativePath = relSegments.join('/');

  // Reject traversal attempts in the resolved path
  if (relativePath.includes('..')) {
    throw new Error(`Storage URI: path traversal detected in "${relativePath}"`);
  }
  if (relativePath.startsWith('/')) {
    throw new Error(`Storage URI: absolute path not allowed in "${relativePath}"`);
  }

  return { namespace, relativePath };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Parse a storage URI string into its structural components.
 *
 * @throws {Error} on unknown scheme, malformed URI, or traversal attempt.
 *
 * @example
 * resolveStorageUri('local://namespaces/acme/assets/foo.mmd')
 * // → { provider: 'local', namespace: 'acme', relativePath: 'assets/foo.mmd' }
 *
 * resolveStorageUri('s3://my-bucket/prod/namespaces/acme/assets/foo.mmd')
 * // → { provider: 's3', namespace: 'acme', relativePath: 'assets/foo.mmd',
 * //      bucket: 'my-bucket', fullKey: 'prod/namespaces/acme/assets/foo.mmd' }
 */
export function resolveStorageUri(uri: string): ResolvedUri {
  if (!uri || typeof uri !== 'string') {
    throw new Error('Storage URI: value must be a non-empty string');
  }

  // ── local:// ─────────────────────────────────────────────────
  if (uri.startsWith('local://')) {
    const rest = uri.slice('local://'.length);
    const segments = rest.split('/').filter(Boolean);
    const { namespace, relativePath } = extractNamespace(segments);
    return { provider: 'local', namespace, relativePath };
  }

  // ── s3:// ─────────────────────────────────────────────────────
  if (uri.startsWith('s3://')) {
    const rest = uri.slice('s3://'.length);
    const segments = rest.split('/').filter(Boolean);

    if (segments.length < 3) {
      throw new Error(`Storage URI: S3 URI too short — expected s3://bucket/...prefix.../namespaces/{ns}/{path}, got "${uri}"`);
    }

    const bucket = segments[0];
    const afterBucket = segments.slice(1);
    const { namespace, relativePath } = extractNamespace(afterBucket);
    const fullKey = afterBucket.join('/');

    return { provider: 's3', namespace, relativePath, bucket, fullKey };
  }

  throw new Error(`Storage URI: unsupported scheme in "${uri}" — expected local:// or s3://`);
}
