import { toolRegistry } from './tool-registry.js';
import type { Tool } from './types.js';

/**
 * Register default tools into the module-level singleton registry.
 *
 * The caller (CLI, API server) is responsible for importing and instantiating
 * the concrete tool implementations. This function inserts them into
 * the shared registry.
 *
 * Example:
 *   import { ExtractSectionTool } from '@ai-engine/tool-extract-section';
 *   import { SearchDocumentsTool } from '@ai-engine/tool-search-documents';
 *   registerDefaultTools([new ExtractSectionTool(), new SearchDocumentsTool(...)]);
 */
export function registerDefaultTools(tools: Tool[]): void {
  for (const tool of tools) {
    toolRegistry.register(tool);
  }
}
