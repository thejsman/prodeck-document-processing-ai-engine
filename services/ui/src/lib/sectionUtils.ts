import type { LayoutSection, SectionContent } from '../types/presentation';

/**
 * Returns true if the section has no meaningful content to display.
 *
 * A section is considered empty when it has none of:
 * - items / categories / layers / stats / phases / highlights / painPoints (non-empty arrays)
 * - a diagram
 * - a non-whitespace body text
 */
export function isSectionEmpty(section: LayoutSection): boolean {
  const c = section.content as unknown as Record<string, unknown>;

  // Array fields that carry the primary content of a section
  const arrayFields = [
    'items',
    'categories',
    'layers',
    'stats',
    'phases',
    'highlights',
    'painPoints',
    'pillars',
    'rows',
    'strategies',
  ] as const;

  for (const field of arrayFields) {
    const val = c[field];
    if (Array.isArray(val) && val.length > 0) return false;
  }

  // A diagram counts as meaningful content
  if (typeof c.diagram === 'string' && c.diagram.trim().length > 0) return false;

  // Body text counts as meaningful content
  for (const field of ['body', 'subheadline', 'headline'] as const) {
    const val = c[field];
    if (typeof val === 'string' && val.trim().length > 0) return false;
  }

  return true;
}
