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

// Presentation-only vocabulary the pptx FORMAT_RULES above don't already cover
// (bare "presentation", "keynote", "slideshow", "present to").
const PRESENTATION_ONLY_PATTERN = /\b(presentations?|keynote|slide\s*shows?|present\s+to)\b/i

// An explicit aspect-ratio mention (e.g. "16:9", "9x16", "9 by 16") is itself a
// slide request — the user is describing slide geometry regardless of the noun
// ("catalog", "document", …) they attach it to.
const ASPECT_TOKEN_PATTERN = /\b(16\s*[:x]\s*9|9\s*[:x]\s*16|16\s+by\s+9|9\s+by\s+16)\b/i
const PORTRAIT_ASPECT_PATTERN = /\b(9\s*[:x]\s*16|9\s+by\s+16)\b/i

/**
 * True when the message is asking for a slide deck / presentation.
 *
 * Single source of truth for slide-request detection: the pptx FORMAT_RULES
 * already cover slides/deck/pitch deck/powerpoint/pptx/"presentation deck"/
 * "as a presentation", so any message that resolves to the `pptx` format is a
 * slide request. The extra patterns pick up presentation-only phrasings and
 * explicit aspect-ratio mentions that don't imply a specific format. Non-pptx
 * formats (pdf, docx, txt) stay false.
 */
export function detectPresentationIntent(message: string): boolean {
  return (
    parseRequestedFormat(message) === 'pptx' ||
    PRESENTATION_ONLY_PATTERN.test(message) ||
    ASPECT_TOKEN_PATTERN.test(message)
  )
}

/**
 * Orientation of a requested slide deck. Portrait only when the message names a
 * 9:16 aspect ratio; every other case (16:9, or no ratio mentioned) is
 * landscape — the historical default that must stay unchanged.
 */
export function detectSlideOrientation(message: string): 'landscape' | 'portrait' {
  return PORTRAIT_ASPECT_PATTERN.test(message) ? 'portrait' : 'landscape'
}
