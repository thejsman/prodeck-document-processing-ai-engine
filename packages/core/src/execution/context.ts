import type { CoreConfig } from '../config/config-types.js';
import type { MemoryData } from '../memory/memory-types.js';

/**
 * Minimal logging interface injected into the execution context.
 * Core defines the shape; runtime supplies the implementation.
 */
export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

/**
 * Fully enriched context passed to every plugin step.
 *
 * `config` and `memory` are always present — resolved from the layered
 * config/memory system before any step runs. Plugins never need to guard
 * against undefined.
 *
 * Resolution order:
 *   global → org → namespace → user → invocation overrides  (config)
 *   org → namespace → user                                   (memory)
 */
export interface ExecutionContext {
  /** Unique identifier for this pipeline run. */
  readonly runId: string;
  /** Absolute path to the working directory for this run. */
  readonly workingDirectory: string;
  /** Logger for structured output during execution. */
  readonly logger: Logger;
  /** Enable streaming output from AI providers. */
  readonly stream?: boolean;
  /** Called with each streamed token when stream is true. */
  readonly onStreamChunk?: (content: string) => void;
  /** Namespace scope for config and memory resolution. */
  readonly namespace?: string;
  /** User scope for config and memory resolution. */
  readonly user?: string;
  /** Effective configuration after all layers are merged. */
  readonly config: CoreConfig;
  /** Effective memory after all layers are merged. */
  readonly memory: MemoryData;
}
