import type { MemoryData, MemoryStore, EpisodicEntry } from './memory-types.js';
import { deepMerge } from '../config/config-resolver.js';

/**
 * Structured memory registry.
 *
 * Merges JSON-based memory layers in order: org → namespace → user.
 * Supports appending episodic entries to a namespace layer.
 *
 * Stateless — all I/O is delegated to the injected `MemoryStore`.
 */
export class MemoryRegistry {
  private readonly store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Returns a deep-merged memory object across layers.
   *
   * Resolution order (lowest → highest priority):
   *   org → namespace → user
   *
   * Arrays (e.g. `episodic`) are concatenated, not replaced,
   * so entries from all layers are preserved.
   */
  async getMemory(namespace?: string, userId?: string): Promise<MemoryData> {
    const layers: MemoryData[] = [await this.store.loadOrg()];

    if (namespace) {
      layers.push(await this.store.loadNamespace(namespace));
    }

    if (userId) {
      layers.push(await this.store.loadUser(userId));
    }

    return layers.reduce<MemoryData>(
      (merged, layer) => mergeMemory(merged, layer),
      {},
    );
  }

  /**
   * Appends an episodic entry to the given namespace's memory.
   *
   * Reads the current namespace memory, pushes the entry onto
   * the `episodic` array, and writes the result back via the store.
   */
  async appendNamespaceMemory(
    namespace: string,
    entry: EpisodicEntry,
  ): Promise<void> {
    const current = await this.store.loadNamespace(namespace);
    const episodic = [...(current.episodic ?? []), entry];
    await this.store.writeNamespace(namespace, { ...current, episodic });
  }
}

/**
 * Memory-aware merge that concatenates arrays instead of overwriting them.
 *
 * For plain-object values, delegates to the core `deepMerge`.
 * For array values (like `episodic`), concatenates target + source.
 * For all other values, source wins.
 */
function mergeMemory(target: MemoryData, source: MemoryData): MemoryData {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const targetVal = result[key];
    const sourceVal = (source as Record<string, unknown>)[key];

    if (Array.isArray(targetVal) && Array.isArray(sourceVal)) {
      result[key] = [...targetVal, ...sourceVal];
    } else if (
      isPlainObject(targetVal) &&
      isPlainObject(sourceVal)
    ) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }

  return result as MemoryData;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
