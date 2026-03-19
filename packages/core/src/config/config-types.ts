/**
 * Core configuration types for the cascading config resolver.
 *
 * Resolution order (lowest → highest priority):
 *   global → org → namespace → user → invocation overrides
 */

import type { StorageConfig } from '../storage/types.js';

export interface PricingDefaults {
  ratePerWeek?: number;
}

export interface CoreConfig {
  defaultProvider?: string;
  defaultTemplate?: string;
  tone?: string;
  chunkStrategy?: string;
  pricingDefaults?: PricingDefaults;

  /**
   * Namespace-level storage backend configuration.
   *
   * When absent the local filesystem provider is used (default behaviour,
   * no breaking changes for existing namespaces).
   *
   * Example (S3):
   *   { "type": "s3", "bucket": "ai-engine-assets", "region": "ap-south-1", "basePrefix": "prod" }
   */
  storage?: StorageConfig;
}

/** Parameters for resolving a merged configuration. */
export interface ConfigResolveParams {
  namespace?: string;
  userId?: string;
  overrides?: Partial<CoreConfig>;
}

/**
 * Abstraction over config file I/O.
 *
 * Core never reads the filesystem directly.
 * Runtime supplies an implementation that maps layer keys to loaded JSON.
 *
 * Each method returns the parsed config for that layer,
 * or undefined / empty object if the source does not exist.
 */
export interface ConfigLoader {
  loadGlobal(): Promise<Partial<CoreConfig>>;
  loadOrg(): Promise<Partial<CoreConfig>>;
  loadNamespace(namespace: string): Promise<Partial<CoreConfig>>;
  loadUser(userId: string): Promise<Partial<CoreConfig>>;
}
