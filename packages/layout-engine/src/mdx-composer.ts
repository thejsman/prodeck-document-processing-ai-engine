/**
 * MDX composer — converts a layout plan into a renderable MDX string.
 *
 * Pure function: deterministic, no side effects, no I/O.
 */

import type { LayoutPlan, PlannedSection } from './layout-planner.js';
import type { DesignConfig } from './layout-rules.js';

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

/**
 * Convert a layout plan into an MDX document string.
 *
 * @param plan  The layout plan produced by `planLayout`
 * @returns     Complete MDX source including imports and component markup
 */
export function composeMDX(plan: LayoutPlan): string {
  const lines: string[] = [];

  // Collect unique components for the import statement
  const components = uniqueComponents(plan.sections);

  // Frontmatter
  lines.push('---');
  lines.push(`title: "Proposal Presentation"`);
  if (plan.design.theme) lines.push(`theme: "${plan.design.theme}"`);
  if (plan.design.primaryColor) lines.push(`primaryColor: "${plan.design.primaryColor}"`);
  lines.push(`generatedAt: "${new Date().toISOString()}"`);
  lines.push('---');
  lines.push('');

  // Component imports
  if (components.length > 0) {
    lines.push(`import { ${components.join(', ')} } from "@/components"`);
    lines.push('');
  }

  // Render each section
  for (const section of plan.sections) {
    lines.push(renderSection(section, plan.design));
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderSection(section: PlannedSection, _design: DesignConfig): string {
  const { component, props } = section;

  switch (component) {
    case 'Hero':
      return renderHero(props.title, props.content);
    case 'TwoColumn':
      return renderTwoColumn(props.title, props.content);
    case 'ArchitectureDiagram':
      return renderArchitectureDiagram(props.title, props.content, props.diagram);
    case 'FeatureGrid':
      return renderFeatureGrid(props.title, props.content);
    case 'Timeline':
      return renderTimeline(props.title, props.content);
    default:
      return renderGenericSection(component, props.title, props.content);
  }
}

function renderHero(title: string, content: string): string {
  return [
    `<Hero title=${attr(title)}>`,
    '',
    content,
    '',
    '</Hero>',
  ].join('\n');
}

function renderTwoColumn(title: string, content: string): string {
  // Split content at the midpoint paragraph for two-column display
  const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim());
  const mid = Math.ceil(paragraphs.length / 2);
  const left = paragraphs.slice(0, mid).join('\n\n');
  const right = paragraphs.slice(mid).join('\n\n');

  if (!right) {
    // Single paragraph — render as regular section with TwoColumn wrapper
    return [
      `<TwoColumn title=${attr(title)}>`,
      '',
      content,
      '',
      '</TwoColumn>',
    ].join('\n');
  }

  return [
    `<TwoColumn title=${attr(title)}>`,
    '',
    '<Column>',
    '',
    left,
    '',
    '</Column>',
    '',
    '<Column>',
    '',
    right,
    '',
    '</Column>',
    '',
    '</TwoColumn>',
  ].join('\n');
}

function renderArchitectureDiagram(
  title: string,
  content: string,
  diagram?: string,
): string {
  const lines: string[] = [
    `<ArchitectureDiagram title=${attr(title)}>`,
    '',
    content,
    '',
  ];

  if (diagram) {
    lines.push(`<MermaidChart>`);
    lines.push(diagram);
    lines.push('</MermaidChart>');
    lines.push('');
  }

  lines.push('</ArchitectureDiagram>');
  return lines.join('\n');
}

function renderFeatureGrid(title: string, content: string): string {
  // Parse list items into feature entries
  const items = parseListItems(content);

  if (items.length === 0) {
    return renderGenericSection('FeatureGrid', title, content);
  }

  const lines: string[] = [
    `<FeatureGrid title=${attr(title)}>`,
    '',
  ];

  for (const item of items) {
    lines.push(`  <Feature>${item}</Feature>`);
  }

  lines.push('');
  lines.push('</FeatureGrid>');
  return lines.join('\n');
}

function renderTimeline(title: string, content: string): string {
  const items = parseListItems(content);

  if (items.length === 0) {
    return renderGenericSection('Timeline', title, content);
  }

  const lines: string[] = [
    `<Timeline title=${attr(title)}>`,
    '',
  ];

  for (let i = 0; i < items.length; i++) {
    lines.push(`  <Step number={${i + 1}}>${items[i]}</Step>`);
  }

  lines.push('');
  lines.push('</Timeline>');
  return lines.join('\n');
}

function renderGenericSection(
  component: string,
  title: string,
  content: string,
): string {
  return [
    `<${component} title=${attr(title)}>`,
    '',
    content,
    '',
    `</${component}>`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueComponents(sections: readonly PlannedSection[]): string[] {
  const set = new Set<string>();
  for (const s of sections) {
    set.add(s.component);
    // Add sub-components used by specific renderers
    if (s.component === 'TwoColumn') set.add('Column');
    if (s.component === 'ArchitectureDiagram' && s.props.diagram) set.add('MermaidChart');
    if (s.component === 'FeatureGrid') set.add('Feature');
    if (s.component === 'Timeline') set.add('Step');
  }
  return [...set].sort();
}

/** Wrap a value in JSX attribute syntax: {`value`} */
function attr(value: string): string {
  // Use template literal syntax to avoid escaping issues
  return '{`' + value.replace(/`/g, '\\`').replace(/\$/g, '\\$') + '`}';
}

/** Extract list items (- or * or numbered) from markdown content. */
function parseListItems(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s|^\d+[.)]\s/.test(l))
    .map((l) => l.replace(/^[-*•]\s+|^\d+[.)]\s+/, '').trim());
}
