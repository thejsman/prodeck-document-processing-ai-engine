/**
 * Template YAML Bridge — ensures every ProposalTemplate has a corresponding
 * YAML file in workdir/data/templates/ that @ai-engine/plugin-proposal-generator
 * can consume.
 *
 * System templates (hardcoded in template-registry.ts) only carry section
 * titles.  This module generates a reasonable query + instruction for each
 * section so the Python plugin can perform targeted RAG retrieval per section.
 */

import { writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import type { ProposalTemplate } from './template-types.js';

// ---------------------------------------------------------------------------
// Section query/instruction auto-generation
// ---------------------------------------------------------------------------

/**
 * Derive a RAG search query for a section title.
 * The query is kept intentionally short so the vector store returns broad,
 * relevant results rather than over-fitting to exact phrasing.
 */
function deriveQuery(sectionTitle: string): string {
  const lower = sectionTitle.toLowerCase();
  // A few common section mappings → targeted queries
  const mappings: [RegExp, string][] = [
    [/executive\s*summary/i, 'company overview value proposition summary'],
    [/problem|challenge|current\s*state/i, 'client problem challenge pain point current situation'],
    [/solution|approach|methodology/i, 'proposed solution technical approach methodology'],
    [/architecture|technical/i, 'technical architecture system design infrastructure'],
    [/timeline|milestone|schedule/i, 'project timeline milestones delivery schedule'],
    [/budget|pricing|investment|cost/i, 'pricing budget cost investment commercials'],
    [/team|resource|staff|personnel/i, 'team composition roles responsibilities expertise'],
    [/risk|mitigation/i, 'project risks assumptions mitigation strategy'],
    [/security|compliance/i, 'security compliance regulatory requirements'],
    [/next\s*step|recommendation|action/i, 'next steps recommendations action items'],
  ];

  for (const [pattern, query] of mappings) {
    if (pattern.test(lower)) return query;
  }

  // Fallback: use the title itself as the query
  return sectionTitle;
}

/**
 * Derive a writing instruction for a section title.
 */
function deriveInstruction(sectionTitle: string): string {
  const lower = sectionTitle.toLowerCase();
  const mappings: [RegExp, string][] = [
    [/executive\s*summary/i, 'Write a concise executive summary highlighting key value propositions and outcomes.'],
    [/problem|challenge|current\s*state/i, 'Describe the client\'s current challenges and the problems this proposal addresses.'],
    [/solution|approach|methodology/i, 'Detail the proposed solution, methodology, and how it addresses the stated requirements.'],
    [/architecture|technical/i, 'Describe the technical architecture, key components, and design decisions.'],
    [/timeline|milestone|schedule/i, 'Present a realistic project timeline with key milestones and delivery dates.'],
    [/budget|pricing|investment|cost/i, 'Provide a clear, itemised budget or pricing structure with justification.'],
    [/team|resource|staff|personnel/i, 'Introduce the core team members, their roles, and relevant experience.'],
    [/risk|mitigation/i, 'Identify key project risks and describe mitigation strategies for each.'],
    [/security|compliance/i, 'Address security controls, compliance requirements, and certification status.'],
    [/next\s*step|recommendation|action/i, 'Outline the recommended next steps and immediate actions for the client.'],
  ];

  for (const [pattern, instruction] of mappings) {
    if (pattern.test(lower)) return instruction;
  }

  return `Write the ${sectionTitle} section clearly and professionally, with specific and actionable content.`;
}

// ---------------------------------------------------------------------------
// YAML builder
// ---------------------------------------------------------------------------

function buildYaml(template: ProposalTemplate): string {
  const lines: string[] = [
    `name: ${template.name}`,
    `version: "1.0"`,
    `description: >`,
    `  Proposal template for ${template.name}.`,
    ``,
    `sections:`,
  ];

  for (const title of template.structure) {
    const query = deriveQuery(title);
    const instruction = deriveInstruction(title);
    lines.push(`  - title: ${title}`);
    lines.push(`    query: >-`);
    lines.push(`      ${query}`);
    lines.push(`    instruction: >-`);
    lines.push(`      ${instruction}`);
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure workdir/data/templates/{template.id}.yaml exists.
 *
 * - If the file already exists (user-created or previously synced) → no-op.
 * - If missing → generate from the template structure and write it.
 *
 * Returns the template slug (= template.id) ready to pass to spawnProposalGenerator.
 */
export async function ensureTemplateYaml(
  workdir: string,
  template: ProposalTemplate,
): Promise<string> {
  const templateDir = path.join(workdir, 'data', 'templates');
  await mkdir(templateDir, { recursive: true });

  const filePath = path.join(templateDir, `${template.id}.yaml`);

  try {
    await access(filePath);
    // File already exists — nothing to do
  } catch {
    // File missing — generate from section titles
    await writeFile(filePath, buildYaml(template), 'utf-8');
  }

  return template.id;
}
