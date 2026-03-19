/**
 * Core tool interfaces.
 *
 * Tools are deterministic, single-purpose operations that agents call to
 * interact with data — extracting sections, searching documents, generating
 * diagrams, saving assets, etc.
 *
 * Agents must NOT access filesystem or services directly.
 * All such actions go through tools.
 */

export interface ToolInput {
  namespace?: string;
  query?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolOutput {
  text?: string;
  json?: unknown;
  files?: string[];
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  run(input: ToolInput): Promise<ToolOutput>;
}
