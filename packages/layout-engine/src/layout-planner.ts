/**
 * Layout planner — analyses proposal sections and produces a layout plan.
 *
 * Pure function: deterministic, no side effects, no I/O.
 */

import { resolveRule, type DesignConfig } from './layout-rules.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input section provided by the caller (e.g. microsite-generator agent). */
export interface InputSection {
  name: string;
  content: string;
  diagram?: string;
}

/** A single planned layout entry ready for the MDX composer. */
export interface PlannedSection {
  component: string;
  props: PlannedProps;
}

export interface PlannedProps {
  title: string;
  content: string;
  diagram?: string;
  [key: string]: unknown;
}

/** Full layout plan output. */
export interface LayoutPlan {
  sections: PlannedSection[];
  design: DesignConfig;
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/**
 * Analyse sections and produce a structured layout plan.
 *
 * @param sections  Array of named content sections (from proposal extraction)
 * @param config    Optional design configuration (theme, colors, etc.)
 * @returns         A deterministic layout plan ready for MDX composition
 */
export function planLayout(
  sections: readonly InputSection[],
  config?: DesignConfig,
): LayoutPlan {
  const design: DesignConfig = { theme: 'modern', layout: 'slide', ...config };
  const planned: PlannedSection[] = [];

  for (const section of sections) {
    const rule = resolveRule(section.name, section.content);

    const props: PlannedProps = {
      title: section.name,
      content: section.content,
    };

    // Attach diagram if the rule supports it and one was provided
    if (rule.supportsDiagram && section.diagram) {
      props.diagram = section.diagram;
    }

    planned.push({ component: rule.component, props });
  }

  return { sections: planned, design };
}
