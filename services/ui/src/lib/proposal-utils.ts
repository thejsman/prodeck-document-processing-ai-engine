/**
 * Pure utility functions for proposal document manipulation.
 * No React imports. No side effects (except downloadMarkdown which uses DOM).
 */

export interface ParsedSection {
  title: string;
  content: string;
  failed: boolean;
}

export interface ParsedProposal {
  header: string;
  sections: ParsedSection[];
}

/**
 * Parse a proposal markdown document into header + individual sections.
 *
 * Expected format:
 *   # Proposal for {client}
 *   ...metadata lines...
 *   ---
 *   ## Section Title
 *   ...content...
 *   ## Section Title
 *   ...content...
 *
 * Splits on lines starting with "## ".
 */
export function parseProposalSections(
  content: string,
  retriedSections: string[],
): ParsedProposal {
  const retriedSet = new Set(retriedSections);
  const lines = content.split('\n');

  let header = '';
  const sections: ParsedSection[] = [];
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentTitle !== null) {
        sections.push({
          title: currentTitle,
          content: currentLines.join('\n').trim(),
          failed: retriedSet.has(currentTitle),
        });
      } else {
        header = currentLines.join('\n').trim();
      }
      currentTitle = line.slice(3).trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Flush last section
  if (currentTitle !== null) {
    sections.push({
      title: currentTitle,
      content: currentLines.join('\n').trim(),
      failed: retriedSet.has(currentTitle),
    });
  } else {
    header = currentLines.join('\n').trim();
  }

  return { header, sections };
}

/**
 * Reassemble a parsed proposal back into markdown.
 * Inverse of parseProposalSections.
 */
export function reassembleMarkdown(
  header: string,
  sections: ParsedSection[],
): string {
  let result = header ? header + '\n\n' : '';
  for (const section of sections) {
    result += `## ${section.title}\n\n${section.content}\n\n`;
  }
  return result.trimEnd() + '\n';
}

/**
 * Trigger a browser download of the proposal markdown content.
 */
export function downloadMarkdown(content: string, clientName: string): void {
  const safeName =
    clientName
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 100) || 'proposal';

  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeName}_proposal.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}
