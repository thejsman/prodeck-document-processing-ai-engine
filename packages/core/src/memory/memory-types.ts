/**
 * Structured memory types for the JSON-based memory layer.
 *
 * Resolution order (lowest → highest priority):
 *   org → namespace → user
 *
 * This is NOT vector memory. All data is plain JSON.
 */

/** A single entry in the episodic memory array. */
export interface EpisodicEntry {
  timestamp: string;
  source: string;
  content: unknown;
}

/**
 * The shape of a structured memory document.
 *
 * `episodic` holds an ordered list of recorded events / facts.
 * Additional top-level keys are merged across layers.
 */
export interface MemoryData {
  episodic?: EpisodicEntry[];
  [key: string]: unknown;
}

/**
 * Abstraction over memory file I/O.
 *
 * Core never touches the filesystem directly.
 * Runtime supplies an implementation.
 *
 * Expected directory layout under the configured base path:
 *
 *   org.json
 *   namespaces/<namespace>.json
 *   users/<userId>.json
 */
export interface MemoryStore {
  loadOrg(): Promise<MemoryData>;
  loadNamespace(namespace: string): Promise<MemoryData>;
  loadUser(userId: string): Promise<MemoryData>;
  writeNamespace(namespace: string, data: MemoryData): Promise<void>;
}
