import type { Tool } from './types.js';

/**
 * Registry for named tools.
 *
 * Tools are registered at startup and retrieved by name at invocation time.
 * The registry is a pure name-to-instance map with no side effects.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(
        `Tool not found: "${name}". Available: ${this.list().join(', ') || '(none)'}`,
      );
    }
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): string[] {
    return [...this.tools.keys()];
  }
}

/** Module-level singleton. CLI and API both import this directly. */
export const toolRegistry = new ToolRegistry();
