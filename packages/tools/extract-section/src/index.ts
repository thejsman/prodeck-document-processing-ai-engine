/**
 * extract-section tool
 *
 * Extracts a named section from a markdown document.
 *
 * Input:
 *   content              — full markdown document
 *   metadata.sectionName — the ## heading to extract
 *
 * Output:
 *   text — the extracted section including its ## heading
 *
 * Returns empty text if the section is not found.
 */

import type { Tool, ToolInput, ToolOutput } from '@ai-engine/core';

export class ExtractSectionTool implements Tool {
  readonly name = 'extract-section';
  readonly description = 'Extracts a named section from a markdown document.';

  async run(input: ToolInput): Promise<ToolOutput> {
    const content = input.content ?? '';
    const sectionName = (input.metadata?.sectionName as string | undefined) ?? '';

    if (!sectionName) {
      throw new Error('extract-section tool requires metadata.sectionName');
    }

    const extracted = extractSection(content, sectionName);
    return { text: extracted };
  }
}

/**
 * Extract a ## section from markdown by heading title.
 *
 * Returns the full section including its ## heading line, up to (but not
 * including) the next ## heading or end of document. Returns empty string
 * if the section is not found.
 */
function extractSection(markdown: string, sectionName: string): string {
  const lines = markdown.split('\n');
  const normalised = sectionName.trim().toLowerCase();

  let capturing = false;
  const result: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const title = line.slice(3).trim().toLowerCase();
      if (title === normalised) {
        capturing = true;
        result.push(line);
        continue;
      }
      // Hit the next ## heading — stop capturing.
      if (capturing) break;
    }

    if (capturing) {
      result.push(line);
    }
  }

  return result.join('\n').trim();
}
