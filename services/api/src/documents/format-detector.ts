// services/api/src/documents/format-detector.ts
//
// Detects the requested output format from a natural-language user message.
// Returns null when no format is mentioned (caller defaults to 'md').

import type { OutputFormat } from '../skills/skill.types.js'

const FORMAT_RULES: Array<{ pattern: RegExp; format: OutputFormat }> = [
  // PPTX — check before generic "deck" / "presentation" which could also mean pdf
  {
    pattern: /\b(powerpoint|pptx?|\.pptx?|as\s+(a\s+)?powerpoint|presentation\s+deck)\b/i,
    format: 'pptx',
  },
  // DOCX
  {
    pattern: /\b(word\s+doc(ument)?|docx|\.docx|microsoft\s+word|as\s+(a\s+)?word)\b/i,
    format: 'docx',
  },
  // PDF
  {
    pattern: /\b(\.pdf|as\s+(a\s+)?pdf|in\s+pdf(\s+format)?|pdf\s+file|pdf\s+format)\b/i,
    format: 'pdf',
  },
  // TXT
  {
    pattern: /\b(plain\s+text|\.txt|\btxt\b|text\s+file|text\s+format|as\s+(a\s+)?text\s+file)\b/i,
    format: 'txt',
  },
  // Notion
  {
    pattern: /\b(notion|notion\s+format|for\s+notion)\b/i,
    format: 'notion',
  },
  // Markdown (explicit — bare "md" is ambiguous so require a qualifier)
  {
    pattern: /\b(\.md|markdown|md\s+format|as\s+(a\s+)?markdown)\b/i,
    format: 'md',
  },
  // Slides / deck / presentation — maps to pptx (after the more-specific powerpoint rule above)
  {
    pattern: /\b(slides?|deck|as\s+(a\s+)?(slides?|deck|presentation)|slides?\s+format|pitch\s+deck|generate\s+ppt|make\s+ppt|create\s+ppt)\b/i,
    format: 'pptx',
  },
]

export function parseRequestedFormat(message: string): OutputFormat | null {
  for (const { pattern, format } of FORMAT_RULES) {
    if (pattern.test(message)) return format
  }
  return null
}
