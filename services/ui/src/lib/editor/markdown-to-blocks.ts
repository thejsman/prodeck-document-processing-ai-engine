import type { ProposalBlock, PricingRow, TimelineItem } from './block-types';
import { generateBlockId } from './block-types';

/**
 * Parse a markdown string (section body, no ## title) into ProposalBlock[].
 *
 * Supports: headings, paragraphs, bullet lists, numbered lists, tables,
 * blockquote callouts, pricing tables (Role|Qty|Rate|Duration|Total),
 * and timeline bullet items (- **Date** — Title).
 */
export function markdownToBlocks(markdown: string): ProposalBlock[] {
  const lines = markdown.split('\n');
  const blocks: ProposalBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        id: generateBlockId(),
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // Table detection: look for header + separator rows
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const result = parseTable(lines, i);
      blocks.push(result.block);
      i = result.nextIndex;
      continue;
    }

    // Blockquote / callout
    if (line.startsWith('> ') || line === '>') {
      const result = parseBlockquote(lines, i);
      blocks.push(result.block);
      i = result.nextIndex;
      continue;
    }

    // Bullet list — check for timeline pattern first
    if (/^[-*]\s+/.test(line)) {
      const result = parseBulletOrTimeline(lines, i);
      blocks.push(result.block);
      i = result.nextIndex;
      continue;
    }

    // Numbered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ id: generateBlockId(), type: 'numbered', items });
      continue;
    }

    // Paragraph: collect consecutive non-blank, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6}\s/) &&
      !isTableRow(lines[i]) &&
      !lines[i].startsWith('> ') &&
      lines[i] !== '>' &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({
        id: generateBlockId(),
        type: 'paragraph',
        text: paraLines.join('\n'),
      });
    } else {
      // Safety: no parser consumed this line — skip it to prevent infinite loop
      i++;
    }
  }

  return blocks;
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes(' | ');
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^\|(\s*-{2,}\s*\|)+$/.test(trimmed) || /^\|(\s*:?-{2,}:?\s*\|)+$/.test(trimmed);
}

function parseCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

const PRICING_HEADERS = ['role', 'qty', 'rate', 'duration', 'total'];

function isPricingTable(columns: string[]): boolean {
  if (columns.length !== 5) return false;
  return columns.every(
    (col, idx) => col.toLowerCase() === PRICING_HEADERS[idx],
  );
}

function parseTable(
  lines: string[],
  start: number,
): { block: ProposalBlock; nextIndex: number } {
  const columns = parseCells(lines[start]);
  // Skip header and separator
  let i = start + 2;
  const dataRows: string[][] = [];
  while (i < lines.length && isTableRow(lines[i])) {
    dataRows.push(parseCells(lines[i]));
    i++;
  }

  if (isPricingTable(columns)) {
    const pricingRows: PricingRow[] = dataRows.map((row) => ({
      role: row[0] ?? '',
      qty: parseInt(row[1] ?? '0', 10) || 0,
      rate: row[2] ?? '',
      duration: row[3] ?? '',
      total: row[4] ?? '',
    }));
    return {
      block: { id: generateBlockId(), type: 'pricing_table', rows: pricingRows },
      nextIndex: i,
    };
  }

  return {
    block: { id: generateBlockId(), type: 'table', columns, rows: dataRows },
    nextIndex: i,
  };
}

function parseBlockquote(
  lines: string[],
  start: number,
): { block: ProposalBlock; nextIndex: number } {
  const contentLines: string[] = [];
  let i = start;
  while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
    contentLines.push(lines[i].replace(/^>\s?/, ''));
    i++;
  }
  return {
    block: {
      id: generateBlockId(),
      type: 'callout',
      tone: 'info',
      text: contentLines.join('\n'),
    },
    nextIndex: i,
  };
}

const TIMELINE_PATTERN = /^\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/;

function parseBulletOrTimeline(
  lines: string[],
  start: number,
): { block: ProposalBlock; nextIndex: number } {
  // First pass: check if all items match timeline pattern
  const rawItems: { text: string; continuation: string[] }[] = [];
  let i = start;
  while (i < lines.length) {
    const match = lines[i].match(/^[-*]\s+(.*)/);
    if (!match) break;
    const item = { text: match[1], continuation: [] as string[] };
    i++;
    // Gather continuation lines (indented)
    while (i < lines.length && /^\s{2,}/.test(lines[i]) && lines[i].trim() !== '') {
      item.continuation.push(lines[i].trim());
      i++;
    }
    rawItems.push(item);
  }

  // Check if timeline
  const timelineMatches = rawItems.map((item) => TIMELINE_PATTERN.exec(item.text));
  const allTimeline = timelineMatches.every((m) => m !== null);

  if (allTimeline && rawItems.length > 0) {
    const milestones: TimelineItem[] = rawItems.map((item, idx) => {
      const m = timelineMatches[idx]!;
      return {
        date: m[1],
        title: m[2],
        description: item.continuation.join(' '),
      };
    });
    return {
      block: { id: generateBlockId(), type: 'timeline', milestones },
      nextIndex: i,
    };
  }

  // Regular bullet list
  const items = rawItems.map((item) =>
    [item.text, ...item.continuation].join(' '),
  );
  return {
    block: { id: generateBlockId(), type: 'bullet', items },
    nextIndex: i,
  };
}
