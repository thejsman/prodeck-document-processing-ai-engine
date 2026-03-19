/**
 * Layout rules — maps section types to presentation components.
 *
 * Each rule defines a component name and a content-matching predicate
 * so the planner can automatically choose the right layout for a section.
 *
 * Pure data — no side effects.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LayoutRule {
  /** MDX component name (e.g. "Hero", "TwoColumn") */
  readonly component: string;
  /** Whether this rule supports an embedded diagram */
  readonly supportsDiagram: boolean;
}

export interface DesignConfig {
  theme?: string;
  layout?: string;
  primaryColor?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Rule table
// ---------------------------------------------------------------------------

/**
 * Canonical mapping from normalised section key → layout rule.
 *
 * Keys are lowercase, trimmed section identifiers. The planner normalises
 * incoming section names before looking them up here.
 */
const RULES: Record<string, LayoutRule> = {
  'executive summary': { component: 'Hero', supportsDiagram: false },
  'hero':              { component: 'Hero', supportsDiagram: false },
  'problem statement': { component: 'TwoColumn', supportsDiagram: false },
  'problem':           { component: 'TwoColumn', supportsDiagram: false },
  'proposed solution': { component: 'TwoColumn', supportsDiagram: false },
  'solution':          { component: 'TwoColumn', supportsDiagram: false },
  'architecture':      { component: 'ArchitectureDiagram', supportsDiagram: true },
  'implementation plan': { component: 'Timeline', supportsDiagram: false },
  'implementation':    { component: 'Timeline', supportsDiagram: false },
  'benefits':          { component: 'FeatureGrid', supportsDiagram: false },
  'next steps':        { component: 'Timeline', supportsDiagram: false },
};

/** Default rule when no explicit match is found. */
const DEFAULT_RULE: LayoutRule = { component: 'Section', supportsDiagram: false };

// ---------------------------------------------------------------------------
// Content heuristics
// ---------------------------------------------------------------------------

/**
 * Detect whether content is primarily a list (bullet points / numbered items).
 * Used to override the default rule with FeatureGrid when appropriate.
 */
export function isListContent(content: string): boolean {
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  const listLines = lines.filter((l) => /^\s*[-*•]\s|^\s*\d+[.)]\s/.test(l));
  return listLines.length / lines.length >= 0.5;
}

/**
 * Detect whether content contains long paragraphs (> 300 chars without a
 * line break), suggesting a two-column layout for readability.
 */
export function hasLongParagraphs(content: string): boolean {
  const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  return paragraphs.some((p) => p.trim().length > 300);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a layout rule for a given section name and content.
 *
 * Resolution order:
 *   1. Exact match on normalised section name
 *   2. Content heuristic (list → FeatureGrid, long text → TwoColumn)
 *   3. Default rule (Section)
 */
export function resolveRule(sectionName: string, content: string): LayoutRule {
  const key = sectionName.trim().toLowerCase();

  // 1. Explicit rule match
  const explicit = RULES[key];
  if (explicit) return explicit;

  // 2. Content-based heuristic
  if (isListContent(content)) {
    return { component: 'FeatureGrid', supportsDiagram: false };
  }
  if (hasLongParagraphs(content)) {
    return { component: 'TwoColumn', supportsDiagram: false };
  }

  // 3. Fallback
  return DEFAULT_RULE;
}
