/**
 * Minimal markdown section parser for proposal documents.
 *
 * Splits on H2 headers ("## Title") which mark top-level proposal sections.
 * Returns an array of sections with slugified ids, titles, and raw markdown content.
 */

export interface ParsedSection {
  readonly id: string;
  readonly title: string;
  readonly content: string;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function parseProposalMarkdown(markdown: string): ParsedSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: ParsedSection[] = [];
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      if (currentTitle !== null) {
        sections.push({
          id: slugify(currentTitle),
          title: currentTitle,
          content: currentLines.join('\n').trim(),
        });
      }
      currentTitle = h2Match[1].trim();
      currentLines = [];
    } else if (currentTitle !== null) {
      currentLines.push(line);
    }
  }

  if (currentTitle !== null) {
    sections.push({
      id: slugify(currentTitle),
      title: currentTitle,
      content: currentLines.join('\n').trim(),
    });
  }

  // Deduplicate: if the same id appears more than once (LLM repeats the heading),
  // merge content — prefer the entry with content, or concatenate if both have content.
  const seen = new Map<string, { index: number; section: { id: string; title: string; content: string } }>();
  const deduped: { id: string; title: string; content: string }[] = [];

  for (const section of sections) {
    const existing = seen.get(section.id);
    if (existing) {
      const merged = [existing.section.content, section.content].filter(Boolean).join('\n\n');
      existing.section = { ...existing.section, content: merged };
      deduped[existing.index] = existing.section;
    } else {
      const entry = { id: section.id, title: section.title, content: section.content };
      seen.set(section.id, { index: deduped.length, section: entry });
      deduped.push(entry);
    }
  }

  return deduped;
}
