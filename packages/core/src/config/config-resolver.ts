import type {
  CoreConfig,
  ConfigLoader,
  ConfigResolveParams,
} from './config-types.js';

/**
 * Checks whether a value is a plain object (not an array, null, Date, etc.).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Recursively merges `source` into `target`.
 *
 * - Plain objects are merged key-by-key.
 * - All other values in `source` overwrite the corresponding key in `target`.
 * - Neither input is mutated; a new object is returned.
 */
export function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target } as Record<string, unknown>;
  const src = source as Record<string, unknown>;

  for (const key of Object.keys(src)) {
    const sourceVal = src[key];
    const targetVal = result[key];

    if (isPlainObject(targetVal) && isPlainObject(sourceVal)) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }

  return result as T;
}

/**
 * Cascading configuration resolver.
 *
 * Accepts a `ConfigLoader` (injected) and merges config layers in order:
 *   global → org → namespace → user → invocation overrides
 *
 * Stateless — every call to `resolve` produces an independent result.
 */
export class ConfigResolver {
  private readonly loader: ConfigLoader;

  constructor(loader: ConfigLoader) {
    this.loader = loader;
  }

  async resolve(params: ConfigResolveParams = {}): Promise<CoreConfig> {
    const { namespace, userId, overrides } = params;

    const layers: Partial<CoreConfig>[] = [
      await this.loader.loadGlobal(),
      await this.loader.loadOrg(),
    ];

    if (namespace) {
      layers.push(await this.loader.loadNamespace(namespace));
    }

    if (userId) {
      layers.push(await this.loader.loadUser(userId));
    }

    if (overrides) {
      layers.push(overrides);
    }

    return layers.reduce<CoreConfig>(
      (merged, layer) => deepMerge(merged, layer),
      {} as CoreConfig,
    );
  }
}
