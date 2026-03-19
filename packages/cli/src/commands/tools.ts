/**
 * CLI command: tools
 *
 * Subcommands:
 *   ai-engine tools list   — list all registered tools
 *
 * Usage:
 *   ai-engine tools list
 */

import { toolRegistry, registerDefaultTools } from '@ai-engine/core';
import { ExtractSectionTool } from '@ai-engine/tool-extract-section';

// Register tools that don't require injected dependencies.
// Tools requiring runtime injection (search-documents, generate-mermaid, save-asset)
// are registered only in contexts where those dependencies are available (API server).
registerDefaultTools([new ExtractSectionTool()]);

function listTools(): void {
  const names = toolRegistry.list();
  if (names.length === 0) {
    process.stderr.write('No tools registered.\n');
    return;
  }
  for (const name of names) {
    process.stdout.write(`${name}\n`);
  }
}

export async function tools(args: readonly string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stderr.write('Usage: ai-engine tools <subcommand>\n\n');
    process.stderr.write('Subcommands:\n');
    process.stderr.write('  list   List all registered tools\n');
    return;
  }

  if (subcommand === 'list') {
    listTools();
    return;
  }

  throw new Error(`Unknown tools subcommand: ${subcommand}`);
}
