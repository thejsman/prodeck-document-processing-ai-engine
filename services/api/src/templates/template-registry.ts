/**
 * Template Registry — manages system and derived proposal templates.
 *
 * Two sources:
 *   1. System templates — hardcoded defaults covering common proposal types.
 *   2. Derived templates — read from namespace artifact metadata on disk
 *      (past proposals that have been analysed and stored as template metadata).
 *
 * Placement: services/templates (adapter layer, not core) because derived
 * template loading reads from the filesystem.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ProposalTemplate } from './template-types.js';

// ---------------------------------------------------------------------------
// System templates — built-in defaults
// ---------------------------------------------------------------------------

const SYSTEM_TEMPLATES: ProposalTemplate[] = [
  {
    id: 'enterprise-cloud-migration',
    name: 'Enterprise Cloud Migration',
    tags: ['cloud', 'migration', 'infrastructure', 'enterprise', 'aws', 'azure', 'gcp'],
    industries: ['technology', 'finance', 'healthcare', 'government'],
    capabilities: ['cloud-architecture', 'migration-planning', 'security', 'compliance'],
    structure: [
      'Executive Summary',
      'Current State Assessment',
      'Migration Strategy',
      'Technical Architecture',
      'Security & Compliance',
      'Timeline & Milestones',
      'Risk Mitigation',
      'Team & Resources',
      'Budget & Pricing',
      'Next Steps',
    ],
  },
  {
    id: 'saas-platform-build',
    name: 'SaaS Platform Development',
    tags: ['saas', 'platform', 'software', 'development', 'web', 'application'],
    industries: ['technology', 'fintech', 'edtech', 'healthtech'],
    capabilities: ['full-stack', 'api-design', 'devops', 'ui-ux', 'scalability'],
    structure: [
      'Executive Summary',
      'Problem Statement',
      'Product Vision',
      'Technical Architecture',
      'Feature Roadmap',
      'UX/UI Approach',
      'Development Methodology',
      'Infrastructure & DevOps',
      'Timeline & Milestones',
      'Team Composition',
      'Budget Estimate',
      'Support & Maintenance',
    ],
  },
  {
    id: 'data-analytics-solution',
    name: 'Data & Analytics Solution',
    tags: ['data', 'analytics', 'bi', 'reporting', 'warehouse', 'pipeline', 'etl'],
    industries: ['finance', 'retail', 'healthcare', 'manufacturing'],
    capabilities: ['data-engineering', 'analytics', 'visualization', 'machine-learning'],
    structure: [
      'Executive Summary',
      'Business Objectives',
      'Data Landscape Assessment',
      'Proposed Architecture',
      'Data Pipeline Design',
      'Analytics & Reporting',
      'Security & Governance',
      'Implementation Plan',
      'Team & Expertise',
      'Budget & Licensing',
    ],
  },
  {
    id: 'cybersecurity-assessment',
    name: 'Cybersecurity Assessment & Remediation',
    tags: ['security', 'cybersecurity', 'audit', 'penetration', 'compliance', 'soc'],
    industries: ['finance', 'healthcare', 'government', 'defense'],
    capabilities: ['security-audit', 'penetration-testing', 'compliance', 'incident-response'],
    structure: [
      'Executive Summary',
      'Scope & Objectives',
      'Assessment Methodology',
      'Current Security Posture',
      'Threat Analysis',
      'Remediation Plan',
      'Compliance Mapping',
      'Timeline & Milestones',
      'Team Credentials',
      'Investment Summary',
    ],
  },
  {
    id: 'digital-transformation',
    name: 'Digital Transformation',
    tags: ['digital', 'transformation', 'modernization', 'automation', 'process'],
    industries: ['manufacturing', 'retail', 'logistics', 'government'],
    capabilities: ['process-automation', 'system-integration', 'change-management'],
    structure: [
      'Executive Summary',
      'Current State Analysis',
      'Transformation Vision',
      'Technology Strategy',
      'Process Redesign',
      'Change Management',
      'Implementation Roadmap',
      'Risk & Mitigation',
      'Team & Governance',
      'Investment & ROI',
    ],
  },
  {
    id: 'managed-services',
    name: 'Managed Services',
    tags: ['managed', 'services', 'operations', 'support', 'monitoring', 'sla'],
    industries: ['technology', 'finance', 'healthcare', 'retail'],
    capabilities: ['monitoring', '24x7-support', 'incident-management', 'sla-management'],
    structure: [
      'Executive Summary',
      'Service Overview',
      'Scope of Services',
      'Service Level Agreements',
      'Operational Model',
      'Monitoring & Alerting',
      'Incident Management',
      'Reporting & Governance',
      'Team Structure',
      'Pricing Model',
    ],
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all available templates for a namespace.
 *
 * Combines system templates with any derived templates found in the
 * namespace's `templates/` metadata directory.
 */
export async function listTemplates(
  workdir: string,
  namespace: string,
): Promise<ProposalTemplate[]> {
  const derived = await loadDerivedTemplates(workdir, namespace);
  return [...SYSTEM_TEMPLATES, ...derived];
}

/**
 * Load a single template by ID.
 *
 * Searches system templates first, then derived templates on disk.
 * Returns undefined if the template is not found.
 */
export async function loadTemplate(
  workdir: string,
  namespace: string,
  templateId: string,
): Promise<ProposalTemplate | undefined> {
  const system = SYSTEM_TEMPLATES.find((t) => t.id === templateId);
  if (system) return system;

  const derived = await loadDerivedTemplates(workdir, namespace);
  return derived.find((t) => t.id === templateId);
}

/**
 * Return only the system (built-in) templates — no filesystem access.
 */
export function getSystemTemplates(): ProposalTemplate[] {
  return [...SYSTEM_TEMPLATES];
}

// ---------------------------------------------------------------------------
// Derived template loader
// ---------------------------------------------------------------------------

/**
 * Scan the namespace `templates/` directory for JSON template metadata files.
 *
 * Each file must be a valid JSON object conforming to ProposalTemplate.
 * Invalid files are silently skipped.
 */
async function loadDerivedTemplates(
  workdir: string,
  namespace: string,
): Promise<ProposalTemplate[]> {
  const templatesDir = path.join(workdir, 'namespaces', namespace, 'templates');

  let entries: string[];
  try {
    entries = await readdir(templatesDir);
  } catch {
    // Directory doesn't exist — no derived templates
    return [];
  }

  const jsonFiles = entries.filter((f) => f.endsWith('.json'));
  const templates: ProposalTemplate[] = [];

  for (const file of jsonFiles) {
    try {
      const raw = await readFile(path.join(templatesDir, file), 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // Minimal validation
      if (
        typeof parsed.id === 'string' &&
        typeof parsed.name === 'string' &&
        Array.isArray(parsed.tags) &&
        Array.isArray(parsed.structure)
      ) {
        templates.push(parsed as unknown as ProposalTemplate);
      }
    } catch {
      // Skip invalid files
    }
  }

  return templates;
}
