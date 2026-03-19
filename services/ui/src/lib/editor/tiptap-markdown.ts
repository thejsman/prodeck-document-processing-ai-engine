/**
 * Bridge between Tiptap's ProseMirror JSON document format and our
 * intermediate ProposalBlock[] model.
 *
 * Flow:
 *   markdown -> markdownToBlocks() -> blocksToTiptapJson() -> editor
 *   editor   -> tiptapJsonToBlocks() -> blocksToMarkdown() -> markdown
 */

import type { JSONContent } from '@tiptap/core';
import type {
  ProposalBlock,
  PricingRow,
  TimelineItem,
} from './block-types';
import { generateBlockId } from './block-types';

// ---------------------------------------------------------------------------
// Tiptap JSON  →  ProposalBlock[]
// ---------------------------------------------------------------------------

function extractText(node: JSONContent): string {
  if (node.text) return node.text;
  if (!node.content) return '';
  return node.content.map(extractText).join('');
}

function extractListItems(node: JSONContent): string[] {
  if (!node.content) return [];
  return node.content.map((listItem: JSONContent) => {
    if (!listItem.content) return '';
    return listItem.content.map(extractText).join('');
  });
}

function tableNodeToBlock(node: JSONContent): ProposalBlock {
  const rows: string[][] = [];
  if (!node.content) {
    return { id: generateBlockId(), type: 'table', columns: [], rows: [] };
  }

  for (const row of node.content) {
    if (!row.content) continue;
    const cells = row.content.map((cell: JSONContent) => extractText(cell));
    rows.push(cells);
  }

  // First row is headers
  const columns = rows.length > 0 ? rows[0] : [];
  const dataRows = rows.slice(1);

  return { id: generateBlockId(), type: 'table', columns, rows: dataRows };
}

export function tiptapJsonToBlocks(doc: JSONContent): ProposalBlock[] {
  const blocks: ProposalBlock[] = [];
  if (!doc.content) return blocks;

  for (const node of doc.content) {
    switch (node.type) {
      case 'paragraph': {
        const text = extractText(node);
        blocks.push({ id: generateBlockId(), type: 'paragraph', text });
        break;
      }

      case 'heading': {
        const text = extractText(node);
        const level = (node.attrs?.level as number) ?? 3;
        blocks.push({ id: generateBlockId(), type: 'heading', level, text });
        break;
      }

      case 'bulletList': {
        const items = extractListItems(node);
        blocks.push({ id: generateBlockId(), type: 'bullet', items });
        break;
      }

      case 'orderedList': {
        const items = extractListItems(node);
        blocks.push({ id: generateBlockId(), type: 'numbered', items });
        break;
      }

      case 'table': {
        blocks.push(tableNodeToBlock(node));
        break;
      }

      case 'blockquote': {
        const text = node.content?.map(extractText).join('\n') ?? '';
        blocks.push({
          id: generateBlockId(),
          type: 'callout',
          tone: 'info',
          text,
        });
        break;
      }

      case 'callout': {
        const tone = (node.attrs?.tone as 'info' | 'warning' | 'success') ?? 'info';
        const text = (node.attrs?.text as string) ?? '';
        blocks.push({ id: generateBlockId(), type: 'callout', tone, text });
        break;
      }

      case 'pricingTable': {
        const rows = (node.attrs?.rows as PricingRow[]) ?? [];
        blocks.push({ id: generateBlockId(), type: 'pricing_table', rows });
        break;
      }

      case 'timeline': {
        const milestones = (node.attrs?.milestones as TimelineItem[]) ?? [];
        blocks.push({ id: generateBlockId(), type: 'timeline', milestones });
        break;
      }

      default:
        // Fallback: treat any unknown node as paragraph
        blocks.push({
          id: generateBlockId(),
          type: 'paragraph',
          text: extractText(node),
        });
        break;
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// ProposalBlock[]  →  Tiptap JSON
// ---------------------------------------------------------------------------

function textContent(text: string): JSONContent[] {
  if (!text) return [];
  return [{ type: 'text', text }];
}

function listItemsToJson(items: string[]): JSONContent[] {
  return items.map((item) => ({
    type: 'listItem',
    content: [{ type: 'paragraph', content: textContent(item) }],
  }));
}

function tableToJson(columns: string[], rows: string[][]): JSONContent {
  const headerRow: JSONContent = {
    type: 'tableRow',
    content: columns.map((col) => ({
      type: 'tableHeader',
      content: [{ type: 'paragraph', content: textContent(col) }],
    })),
  };

  const dataRows: JSONContent[] = rows.map((row) => ({
    type: 'tableRow',
    content: row.map((cell) => ({
      type: 'tableCell',
      content: [{ type: 'paragraph', content: textContent(cell) }],
    })),
  }));

  return {
    type: 'table',
    content: [headerRow, ...dataRows],
  };
}

export function blocksToTiptapJson(blocks: ProposalBlock[]): JSONContent {
  const content: JSONContent[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
        content.push({
          type: 'paragraph',
          content: textContent(block.text),
        });
        break;

      case 'heading':
        content.push({
          type: 'heading',
          attrs: { level: block.level },
          content: textContent(block.text),
        });
        break;

      case 'bullet':
        content.push({
          type: 'bulletList',
          content: listItemsToJson(block.items),
        });
        break;

      case 'numbered':
        content.push({
          type: 'orderedList',
          content: listItemsToJson(block.items),
        });
        break;

      case 'table':
        content.push(tableToJson(block.columns, block.rows));
        break;

      case 'callout':
        content.push({
          type: 'callout',
          attrs: { tone: block.tone, text: block.text },
        });
        break;

      case 'pricing_table':
        content.push({
          type: 'pricingTable',
          attrs: { rows: block.rows },
        });
        break;

      case 'timeline':
        content.push({
          type: 'timeline',
          attrs: { milestones: block.milestones },
        });
        break;
    }
  }

  // Ensure at least one node (Tiptap requires non-empty doc)
  if (content.length === 0) {
    content.push({ type: 'paragraph' });
  }

  return { type: 'doc', content };
}
