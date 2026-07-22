import { DocumentMemoryService } from './document-memory.service.js';

/**
 * Strips markdown structure (headings, horizontal rules, table rows, bullet
 * markers, bold) down to plain text and truncates at a clean word boundary.
 * Deliberately format-agnostic — client-knowledge.md varies a lot in shape
 * (prose-and-citations from the crawl pipeline vs. heading/table/bullet-heavy
 * briefs from the single-shot URL/notes prompts), so picking "the first
 * paragraph" is too fragile; stripping the whole document is robust to both.
 */
function extractDescription(markdown: string, fallback: string): string {
  const plain = markdown
    .replace(/^#{1,6}\s.*$/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/^\|.*\|\s*$/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (!plain) return fallback;
  if (plain.length <= 300) return plain;

  const truncated = plain.slice(0, 300);
  const lastSpace = truncated.lastIndexOf(' ');
  return `${lastSpace > 200 ? truncated.slice(0, lastSpace) : truncated}…`;
}

/**
 * Mirrors the site-facts-crawl-derived client-knowledge.md (which lives at
 * super-clients/{name}/client-knowledge.md) into the unified memory folder,
 * so the chat relevance scanner can scan it alongside uploaded docs and
 * chat-derived knowledge. One-way sync — the source file is untouched.
 */
export async function syncClientKnowledge(
  workdir: string,
  clientSlug: string,
  markdown: string,
): Promise<void> {
  const description = extractDescription(markdown, `Site-crawl knowledge for ${clientSlug}`);

  await new DocumentMemoryService(workdir).upsertFile(clientSlug, {
    id: 'client-knowledge',
    type: 'site-crawl',
    fileName: 'client-knowledge.md',
    description,
    markdown,
  });
}
