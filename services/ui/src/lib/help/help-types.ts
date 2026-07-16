import type { LucideIcon } from 'lucide-react';

/**
 * Help & FAQ content contract.
 *
 * All copy lives in the typed registry under `src/content/help/`; these
 * interfaces are the single shape every topic must follow. Nothing here has
 * side effects, so this module is safe to import from server or client code.
 */

export type HelpCategoryId =
  | 'getting-started'
  | 'super-client'
  | 'proposals'
  | 'microsites'
  | 'content-knowledge'
  | 'inspiration-skills'
  | 'publishing-export'
  | 'insights'
  | 'admin'
  | 'account';

export interface HelpCategory {
  id: HelpCategoryId;
  label: string;
  /** Sort order in the Help Center and drawer nav (ascending). */
  order: number;
  icon?: LucideIcon;
}

export interface HelpSection {
  heading: string;
  /** Markdown (GitHub-flavored). Rendered via HelpMarkdown. */
  body: string;
}

export interface Faq {
  q: string;
  /** Markdown answer. */
  a: string;
}

export interface HelpTopic {
  id: string;
  title: string;
  category: HelpCategoryId;
  /**
   * Route patterns this topic answers for, e.g. `/artifacts`,
   * `/super-client/:name`, `/microsite-editor/:namespace/:proposalId`.
   * An empty array marks a "concept" topic reachable only via search,
   * related links, or the Help Center (not resolved from a route).
   */
  routePatterns: string[];
  icon?: LucideIcon;
  /** One-to-two sentence plain-language overview shown at the top. */
  summary: string;
  sections: HelpSection[];
  faqs: Faq[];
  /** IDs of related topics (validated in dev by the registry). */
  related: string[];
  /** Extra search terms not already in the title/summary. */
  keywords: string[];
}
