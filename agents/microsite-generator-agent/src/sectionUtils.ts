/**
 * sectionUtils.ts
 *
 * Pure utility functions for section content validation.
 * No I/O, no side effects.
 */

export function isSectionEmpty(section: any): boolean {
  const c = section?.content
  if (!c) return true

  const hasText = [c.headline, c.body, c.subheadline, c.pullquote, c.quote]
    .some((f: any) => typeof f === 'string' && f.trim().length > 3)

  const hasItems = [c.items, c.pillars, c.stats, c.phases, c.highlights, c.painPoints]
    .some((f: any) => Array.isArray(f) && f.length > 0)

  const hasRows = Array.isArray(c.rows) && c.rows.length > 1

  const hasDiagram = typeof c.diagram === 'string' &&
    (c.diagram.trim().length > 10 || c.diagram.startsWith('__CUSTOM_SVG__'))

  return !hasText && !hasItems && !hasRows && !hasDiagram
}
