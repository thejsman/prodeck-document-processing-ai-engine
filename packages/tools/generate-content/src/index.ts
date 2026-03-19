/**
 * generate-content tool
 *
 * Generates or enhances content using an injected LLM function.
 * Used by agents to produce presentation-quality text from raw proposal sections.
 *
 * Input:
 *   content  — source content (e.g. raw proposal section)
 *   query    — instruction/prompt for how to transform the content
 *   metadata — optional { sectionName, style, ... }
 *
 * Output:
 *   text — the LLM-generated content
 *
 * The `generateFn` is injected at construction time so core stays pure.
 */

import type { Tool, ToolInput, ToolOutput } from '@ai-engine/core';

export interface GenerateContentConfig {
  generateFn: (prompt: string) => Promise<string>;
}

export class GenerateContentTool implements Tool {
  readonly name = 'generate-content';
  readonly description =
    'Generates or enhances content using LLM. Input: content (source text) + query (instruction).';

  private readonly generateFn: GenerateContentConfig['generateFn'];

  constructor(config: GenerateContentConfig) {
    this.generateFn = config.generateFn;
  }

  async run(input: ToolInput): Promise<ToolOutput> {
    const content = input.content ?? '';
    const instruction = input.query ?? '';

    if (!content && !instruction) {
      throw new Error('generate-content tool requires content or query');
    }

    const prompt = instruction
      ? `${instruction}\n\nSource content:\n${content}`
      : content;

    const result = await this.generateFn(prompt);
    return { text: result };
  }
}
