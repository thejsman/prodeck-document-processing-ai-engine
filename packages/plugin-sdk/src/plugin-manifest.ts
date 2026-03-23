// ── Section types supported by presenter plugins ─────────────────────────

export type PresenterSectionType =
  | 'hero'
  | 'challenge'
  | 'approach'
  | 'deliverables'
  | 'timeline'
  | 'pricing'
  | 'whyus'
  | 'nextsteps'
  | 'testimonials'
  | 'showcase'
  | 'benefits'
  | 'problem'
  | 'stats'
  | 'metrics'
  | 'security'
  | 'techstack'
  | 'testing'
  | 'generic';

export type ImageSourceType = 'unsplash' | 'dalle' | 'gradient' | 'custom-url';

// ── Plugin manifest ───────────────────────────────────────────────────────

export interface PluginManifest {
  /** Unique machine-readable identifier, e.g. "obsidian" */
  name: string;
  /** Human-readable display name, e.g. "Obsidian Luxury" */
  displayName: string;
  /** Semantic version string, e.g. "1.0.0" */
  version: string;
  /**
   * Minimum compatible SDK major.minor, e.g. "0.1".
   * Only the major version is checked for compatibility.
   */
  sdkVersion: string;
  /** Plugin category — "presenter" for visual presentation plugins */
  type: 'presenter';
  /** Relative path from plugin root to its compiled entry point */
  entry: string;
  capabilities: {
    presentation: {
      /** Section types this plugin provides custom layouts for */
      sectionTypes: PresenterSectionType[];
      /** Whether this plugin accepts LLM-synthesized custom token overrides */
      supportsCustomTokens: boolean;
      /** Image source strategies this plugin supports */
      imageSourceTypes: ImageSourceType[];
    };
  };
}
