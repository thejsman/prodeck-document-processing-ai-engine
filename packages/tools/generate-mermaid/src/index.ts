/**
 * generate-mermaid tool
 *
 * Generates a Mermaid architecture diagram from a text description.
 *
 * Input:
 *   content — description of the diagram to generate
 *
 * Output:
 *   text — Mermaid diagram source code
 *
 * Delegates to an LLM via a Python bridge (same pattern as the rest of the
 * system). The `generateFn` is injected at construction time so core stays pure.
 */

import type { Tool, ToolInput, ToolOutput } from '@ai-engine/core';

export interface GenerateMermaidConfig {
  /**
   * Function that calls the LLM to generate a Mermaid diagram.
   * Injected by the CLI/API layer.
   */
  generateFn: (description: string) => Promise<string>;
}

export class GenerateMermaidTool implements Tool {
  readonly name = 'generate-mermaid';
  readonly description =
    'Generates a Mermaid architecture diagram from a text description using LLM.';

  private readonly generateFn: GenerateMermaidConfig['generateFn'];

  constructor(config: GenerateMermaidConfig) {
    this.generateFn = config.generateFn;
  }

  async run(input: ToolInput): Promise<ToolOutput> {
    const description = input.content ?? input.query ?? '';

    if (!description) {
      throw new Error('generate-mermaid tool requires content or query describing the diagram');
    }

    const diagram = await this.generateFn(description);
    return { text: diagram };
  }
}
