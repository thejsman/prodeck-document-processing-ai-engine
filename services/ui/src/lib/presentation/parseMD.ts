import type { ParsedProposal, ParsedSection, SectionType } from '../../types/presentation';

/** Slugify a heading for use as an ID */
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Classify a heading into a SectionType */
function classifySectionType(heading: string): SectionType {
  const h = heading.toLowerCase();
  if (/executive\s*summary|overview/.test(h)) return 'hero';
  if (/challenge|problem/.test(h)) return 'challenge';
  if (/approach|solution|method|proposed/.test(h)) return 'approach';
  if (/deliverable|scope/.test(h)) return 'deliverables';
  if (/timeline|schedule|phase|implementation|plan/.test(h)) return 'timeline';
  if (/invest|pric|cost|commercial/.test(h)) return 'pricing';
  if (/why|about\s*us|credential|team|experience/.test(h)) return 'whyus';
  if (/next|step|start|action/.test(h)) return 'nextsteps';
  return 'generic';
}

/** Extract bullet list items from a body string */
function extractItems(body: string): string[] {
  return body.split('\n')
    .filter((l) => /^\s*[-*]\s/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trim());
}

/** Extract table rows from a body string */
function extractTable(body: string): string[][] {
  const lines = body.split('\n').filter((l) => l.includes('|'));
  if (lines.length < 2) return [];
  return lines
    .filter((l) => !/^[\s|:-]+$/.test(l)) // skip separator rows
    .map((l) => l.split('|').map((c) => c.trim()).filter(Boolean));
}

/** Extract ### subheadings from a body string */
function extractSubheads(body: string): { heading: string; body: string }[] {
  const parts: { heading: string; body: string }[] = [];
  const lines = body.split('\n');
  let currentHead: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (currentHead !== null) {
        parts.push({ heading: currentHead, body: currentLines.join('\n').trim() });
      }
      currentHead = line.slice(4).trim();
      currentLines = [];
    } else if (currentHead !== null) {
      currentLines.push(line);
    }
  }
  if (currentHead !== null) {
    parts.push({ heading: currentHead, body: currentLines.join('\n').trim() });
  }
  return parts;
}

/** Extract metadata from the proposal header (everything before the first ## ) */
function extractMeta(header: string): ParsedProposal['meta'] {
  const meta = { title: '', client: '', date: '', author: '' };

  // Title from # heading
  const titleMatch = header.match(/^#\s+(.+)$/m);
  if (titleMatch) meta.title = titleMatch[1].trim();

  // "Proposal for X" pattern
  const forMatch = meta.title.match(/proposal\s+for\s+(.+)/i);
  if (forMatch) meta.client = forMatch[1].trim();

  // Look for metadata fields
  const clientMatch = header.match(/\*\*(?:Client|For|Company)\s*:\*\*\s*(.+)/i);
  if (clientMatch) meta.client = clientMatch[1].trim();

  const dateMatch = header.match(/\*\*Date\s*:\*\*\s*(.+)/i);
  if (dateMatch) meta.date = dateMatch[1].trim();

  const authorMatch = header.match(/\*\*(?:Prepared\s*by|Author|By)\s*:\*\*\s*(.+)/i);
  if (authorMatch) meta.author = authorMatch[1].trim();

  // Fallback date
  if (!meta.date) {
    const isoMatch = header.match(/\d{4}-\d{2}-\d{2}/);
    if (isoMatch) meta.date = isoMatch[0];
  }

  return meta;
}

/** Parse proposal markdown into a typed section graph */
export function parseProposalMD(mdContent: string): ParsedProposal {
  const lines = mdContent.split('\n');
  const sections: ParsedSection[] = [];

  let headerLines: string[] = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];
  let foundFirstSection = false;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentHeading !== null) {
        const rawBody = currentLines.join('\n').trim();
        sections.push({
          id: slugify(currentHeading),
          heading: currentHeading,
          rawBody,
          rawItems: extractItems(rawBody),
          rawTable: extractTable(rawBody),
          subheads: extractSubheads(rawBody),
          detectedType: classifySectionType(currentHeading),
        });
      }
      currentHeading = line.slice(3).trim();
      currentLines = [];
      foundFirstSection = true;
    } else if (!foundFirstSection) {
      headerLines.push(line);
    } else if (currentHeading !== null) {
      currentLines.push(line);
    }
  }

  // Flush last section
  if (currentHeading !== null) {
    const rawBody = currentLines.join('\n').trim();
    sections.push({
      id: slugify(currentHeading),
      heading: currentHeading,
      rawBody,
      rawItems: extractItems(rawBody),
      rawTable: extractTable(rawBody),
      subheads: extractSubheads(rawBody),
      detectedType: classifySectionType(currentHeading),
    });
  }

  const meta = extractMeta(headerLines.join('\n'));

  return { meta, sections };
}
