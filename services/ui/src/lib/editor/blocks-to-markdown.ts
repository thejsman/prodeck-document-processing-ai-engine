import type { ProposalBlock, ProposalSectionState } from './block-types';

function serializeBlock(block: ProposalBlock): string {
  switch (block.type) {
    case 'paragraph':
      return block.text;

    case 'heading':
      if (!block.text.trim()) return '';
      return `${'#'.repeat(Math.min(block.level, 6))} ${block.text}`;

    case 'bullet':
      return block.items.map((item) => `- ${item}`).join('\n');

    case 'numbered':
      return block.items.map((item, i) => `${i + 1}. ${item}`).join('\n');

    case 'table': {
      if (block.columns.length === 0) return '';
      const header = `| ${block.columns.join(' | ')} |`;
      const separator = `| ${block.columns.map(() => '---').join(' | ')} |`;
      const rows = block.rows
        .map((row) => `| ${row.join(' | ')} |`)
        .join('\n');
      return [header, separator, rows].filter(Boolean).join('\n');
    }

    case 'callout': {
      const lines = block.text.split('\n');
      return lines.map((line) => `> ${line}`).join('\n');
    }

    case 'pricing_table': {
      const headers = ['Role', 'Qty', 'Rate', 'Duration', 'Total'];
      const header = `| ${headers.join(' | ')} |`;
      const separator = `| ${headers.map(() => '---').join(' | ')} |`;
      const rows = block.rows
        .map(
          (row) =>
            `| ${row.role} | ${row.qty} | ${row.rate} | ${row.duration} | ${row.total} |`,
        )
        .join('\n');
      return [header, separator, rows].filter(Boolean).join('\n');
    }

    case 'timeline': {
      return block.milestones
        .map(
          (m) =>
            `- **${m.date}** — ${m.title}${m.description ? `\n  ${m.description}` : ''}`,
        )
        .join('\n');
    }

    default:
      return '';
  }
}

export function blocksToMarkdown(blocks: ProposalBlock[]): string {
  return blocks
    .map((block) => serializeBlock(block))
    .filter((s) => s !== '')
    .join('\n\n');
}

export function serializeProposalSectionToMarkdown(
  section: ProposalSectionState,
): string {
  const titleLine = `## ${section.title}`;
  const body = blocksToMarkdown(section.blocks);
  return body ? `${titleLine}\n\n${body}` : titleLine;
}
