export interface SectionLimitRequest {
  hasLimit: boolean
  requestedCount?: number
  requestedSections?: string[]
  limitType: 'none' | 'count' | 'explicit-list' | 'exclude-list'
  rawMatch?: string
}

export function detectSectionLimitRequest(
  customPrompt: string
): SectionLimitRequest {
  if (!customPrompt || customPrompt.trim().length === 0) {
    return { hasLimit: false, limitType: 'none' }
  }

  const lower = customPrompt.toLowerCase()

  // PATTERN 1: Explicit count
  // Must NOT match "1. Hero Section" style numbered layout descriptions
  const countPatterns = [
    /\b(only|just|use|generate|create|make|limit\s+to|max|maximum)\s+(\d+)\s+sections?\b/i,
    /\b(\d+)\s+sections?\s+(only|max|maximum|total)\b/i,
    /\bsections?\s*:\s*(\d+)\b/i,
    /\bnumber\s+of\s+sections?\s*[=:]\s*(\d+)\b/i,
    /\b(\d+)-section\s+microsite\b/i,
    /\bkeep\s+it\s+to\s+(\d+)\s+sections?\b/i,
  ]

  for (const pattern of countPatterns) {
    const match = lower.match(pattern)
    if (match) {
      const numStr = match.find(m => /^\d+$/.test(m ?? ''))
      const count = numStr ? parseInt(numStr, 10) : undefined
      if (count && count > 0 && count <= 13) {
        return {
          hasLimit: true,
          requestedCount: count,
          limitType: 'count',
          rawMatch: match[0],
        }
      }
    }
  }

  // PATTERN 2: Explicit section list
  const sectionNames = [
    'hero', 'challenge', 'approach', 'deliverables', 'timeline',
    'pricing', 'whyus', 'why us', 'nextsteps', 'next steps',
    'testimonials', 'showcase', 'benefits', 'problem', 'stats',
    'statistics', 'executive summary', 'solution', 'overview',
  ]

  const listPatterns = [
    /\b(include\s+only|only\s+include|show\s+only|sections?\s*:)\s*([a-z,\s]+)/i,
    /\b(include\s+these\s+sections?|these\s+sections?\s+only)\s*:?\s*([a-z,\s]+)/i,
  ]

  for (const pattern of listPatterns) {
    const match = lower.match(pattern)
    if (match && match[2]) {
      const mentioned = sectionNames.filter(s => match[2].includes(s))
      if (mentioned.length >= 2) {
        return {
          hasLimit: true,
          requestedSections: mentioned,
          limitType: 'explicit-list',
          rawMatch: match[0],
        }
      }
    }
  }

  // PATTERN 3: Exclude list
  const excludePattern = /\b(no|skip|remove|hide|exclude|without)\s+(the\s+)?(timeline|pricing|stats|testimonials|showcase|benefits|problem|challenge|approach|deliverables|whyus|nextsteps)\b/gi
  const excluded: string[] = []
  let em: RegExpExecArray | null
  while ((em = excludePattern.exec(lower)) !== null) {
    if (em[3]) excluded.push(em[3])
  }

  if (excluded.length > 0) {
    return {
      hasLimit: true,
      requestedSections: excluded,
      limitType: 'exclude-list',
      rawMatch: excluded.join(', '),
    }
  }

  return { hasLimit: false, limitType: 'none' }
}
