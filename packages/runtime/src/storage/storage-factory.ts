import type { CoreConfig, StorageProvider } from '@ai-engine/core';
import { LocalStorageProvider } from './local-storage-provider.js';
import { S3StorageProvider } from './s3-storage-provider.js';

export interface StorageProviderOptions {
  /** Namespace slug — all stored paths are isolated under this namespace. */
  namespace: string;

  /**
   * Resolved namespace config.  The factory reads config.storage to decide
   * which backend to instantiate.  Missing or undefined → local (default).
   */
  config: CoreConfig;

  /**
   * Absolute path to the workspace root directory.
   * Required by LocalStorageProvider; ignored for S3.
   */
  workdir: string;
}

/**
 * Return a StorageProvider scoped to the given namespace.
 *
 * Decision logic:
 *   config.storage.type === "s3"  →  S3StorageProvider
 *   anything else                  →  LocalStorageProvider  (safe default)
 *
 * Migration safety: existing namespaces with no "storage" key in their config
 * continue to use local storage — behaviour is identical to before.
 */
export function getStorageProvider({
  namespace,
  config,
  workdir,
}: StorageProviderOptions): StorageProvider {
  const storageConfig = config.storage;

  if (storageConfig?.type === 's3') {
    const { bucket, region, basePrefix } = storageConfig;

    if (!bucket) {
      throw new Error(
        `Storage: "bucket" is required for S3 storage (namespace: "${namespace}")`,
      );
    }
    if (!region) {
      throw new Error(
        `Storage: "region" is required for S3 storage (namespace: "${namespace}")`,
      );
    }

    return new S3StorageProvider({
      bucketName: bucket,
      region,
      basePrefix: basePrefix ?? 'ai-engine',
      namespace,
    });
  }

  // Default: local filesystem
  return new LocalStorageProvider({ workdir, namespace });
}
