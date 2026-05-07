/**
 * smart-excerptors.ts — deterministic section targeting per document type.
 *
 * Before sending content to the LLM, extract only the sections most likely to
 * contain requirements. This is entirely deterministic — no LLM involved.
 * The result is passed to unifiedExtract() instead of the full document.
 *
 * Reduces LLM input by ~50–65% depending on document type.
 */

import type { DocumentType } from '../chat/context.types.js';

const MAX_EXCERPT_CHARS = parseInt(process.env['MAX_EXCERPT_CHARS'] ?? '32000', 10);

// ── Public API ────────────────────────────────────────────────────

export function extractSmartExcerpt(content: string, docType: DocumentType): string {
  switch (docType) {
    case 'rfp':
      return extractRFPExcerpt(content);
    case 'meeting_transcript':
      return extractTranscriptExcerpt(content);
    case 'technical_spec':
      return extractSpecExcerpt(content);
    case 'email':
      return truncate(content, MAX_EXCERPT_CHARS); // emails are already short
    default:
      return truncate(content, MAX_EXCERPT_CHARS);
  }
}

// ── Document-type extractors ──────────────────────────────────────

function extractRFPExcerpt(content: string): string {
  const targetPatterns = [
    /scope\s+of\s+work/i,
    /project\s+(overview|description|summary)/i,
    /requirements?/i,
    /budget|compensation|fees?|pricing/i,
    /timeline|schedule|deadline|milestones?/i,
    /about\s+(the\s+)?(company|organization|client|us)/i,
    /objectives?|goals?/i,
    /deliverables?/i,
    /technical\s+(requirements?|specifications?|stack)/i,
    /evaluation\s+(criteria|factors)/i,
    /background|overview/i,
  ];

  const sections = splitBySections(content);
  const targeted = sections.filter((s) =>
    targetPatterns.some((pattern) => pattern.test(s.heading)),
  );

  // Always include first 2500 chars (usually has client/project intro)
  const intro = content.slice(0, 2500);
  const targetedText = targeted.map((s) => `## ${s.heading}\n${s.content}`).join('\n\n');

  return truncate([intro, targetedText].filter(Boolean).join('\n\n'), MAX_EXCERPT_CHARS);
}

function extractTranscriptExcerpt(content: string): string {
  // Split on speaker turn headers: "Jake Walker  0:00"
  const turnPattern = /\n(?=[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\s+\d+:\d+)/;
  const turns = content
    .split(turnPattern)
    .map((turn) =>
      // Strip speaker name + timestamp line from the start of each turn
      turn.replace(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\s+\d+:\d+\s*/m, '').trim(),
    )
    .filter((turn) => turn.length > 20);

  return truncate(turns.join('\n'), MAX_EXCERPT_CHARS);
}

function extractSpecExcerpt(content: string): string {
  const targetPatterns = [
    /requirements?/i,
    /architecture|system\s+design/i,
    /api|endpoints?|interface/i,
    /data\s+model|schema|database/i,
    /constraints?|limitations?/i,
    /assumptions?/i,
    /objectives?|goals?|purpose/i,
    /scope/i,
    /non.functional/i,
    /performance|security|scalability/i,
  ];

  const sections = splitBySections(content);
  const targeted = sections.filter((s) =>
    targetPatterns.some((pattern) => pattern.test(s.heading)),
  );

  const intro = content.slice(0, 2000);
  const targetedText = targeted.map((s) => `## ${s.heading}\n${s.content}`).join('\n\n');

  return truncate([intro, targetedText].filter(Boolean).join('\n\n'), MAX_EXCERPT_CHARS);
}

// ── Section splitter ──────────────────────────────────────────────

interface Section {
  heading: string;
  content: string;
}

export function splitBySections(content: string): Section[] {
  // Match markdown headings (## Heading) or ALL-CAPS lines (SCOPE OF WORK)
  const headingPattern = /^(#{1,4}\s+.+|[A-Z][A-Z\s]{3,}[A-Z])$/m;
  const lines = content.split('\n');
  const sections: Section[] = [];

  let currentHeading = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    if (headingPattern.test(line.trim())) {
      if (currentHeading || currentLines.some((l) => l.trim())) {
        sections.push({
          heading: currentHeading || '(intro)',
          content: currentLines.join('\n').trim(),
        });
      }
      currentHeading = line.trim().replace(/^#{1,4}\s+/, '');
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentHeading || currentLines.some((l) => l.trim())) {
    sections.push({
      heading: currentHeading || '(intro)',
      content: currentLines.join('\n').trim(),
    });
  }

  return sections.filter((s) => s.content.trim().length > 0);
}

// ── Helpers ───────────────────────────────────────────────────────

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}
