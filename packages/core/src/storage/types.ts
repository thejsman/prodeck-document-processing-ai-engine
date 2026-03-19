/**
 * StorageProvider — abstract interface for all storage backends.
 *
 * Implementations live in packages/runtime:
 *   - LocalStorageProvider  (default, filesystem under workdir)
 *   - S3StorageProvider     (AWS S3, configurable per namespace)
 *
 * All paths passed to provider methods are relative to the namespace root.
 * The provider maps them to the correct backend location and returns a
 * normalized storage URI.
 *
 * URI formats:
 *   local  →  local://namespaces/{ns}/assets/foo.mmd
 *   S3     →  s3://{bucket}/{prefix}/namespaces/{ns}/assets/foo.mmd
 *
 * Future extension points (not implemented yet):
 *   signedUrl(path, ttlSeconds): Promise<string>
 *   createUploadStream(path):    Promise<WritableStream>
 *   createReadStream(path):      Promise<ReadableStream>
 */
export interface StorageProvider {
  /**
   * Write content to storage and return the normalized URI.
   * Creates any intermediate directories / key prefixes automatically.
   */
  writeFile(path: string, content: Buffer | string): Promise<string>

  /** Read file content as a Buffer. */
  readFile(path: string): Promise<Buffer>

  /**
   * List all file paths under the given prefix (non-recursive for local,
   * prefix-filtered for S3).  Returns relative paths, not URIs.
   */
  list(prefix: string): Promise<string[]>

  /**
   * Delete a file.  Resolves without error if the file does not exist.
   */
  delete(path: string): Promise<void>

  /** Return true if the path exists in storage. */
  exists(path: string): Promise<boolean>

  /**
   * Generate a time-limited pre-signed URL for direct client access.
   *
   * Optional — only implemented by S3StorageProvider.
   * LocalStorageProvider does not implement this; the AssetService falls back
   * to the API download endpoint URL for local assets.
   *
   * @param path      - Relative path within the namespace root.
   * @param ttlSeconds - How long the URL remains valid (max enforced by AssetService).
   */
  getSignedUrl?(path: string, ttlSeconds: number): Promise<string>;

  /**
   * Write content from a Readable stream directly to storage.
   *
   * Optional — avoids buffering large files in memory.
   * Local: pipes to fs.createWriteStream.
   * S3: uses @aws-sdk/lib-storage Upload for multipart upload (≥5 MB parts).
   *
   * Falls back to writeFile() when not implemented.
   *
   * @returns Normalized storage URI (same format as writeFile).
   */
  writeStream?(path: string, stream: import('node:stream').Readable): Promise<string>;

  /**
   * Open a Readable stream to stored content.
   *
   * Optional — enables progressive processing without fully buffering a file.
   * Falls back to readFile() when not implemented.
   */
  readStream?(path: string): Promise<import('node:stream').Readable>;
}

/**
 * Namespace-level storage configuration.
 *
 * Placed under the "storage" key in a namespace config JSON:
 *
 * ```json
 * {
 *   "storage": {
 *     "type": "s3",
 *     "bucket": "ai-engine-assets",
 *     "region": "ap-south-1",
 *     "basePrefix": "prod"
 *   }
 * }
 * ```
 *
 * When omitted the local filesystem provider is used.
 */
export interface StorageConfig {
  /** "local" (default) or "s3" */
  type?: 'local' | 's3'

  /** S3 bucket name — required when type === "s3" */
  bucket?: string

  /** AWS region — required when type === "s3" */
  region?: string

  /**
   * Key prefix inside the bucket (e.g. "prod" or "ai-engine").
   * Defaults to "ai-engine" when omitted.
   */
  basePrefix?: string
}
