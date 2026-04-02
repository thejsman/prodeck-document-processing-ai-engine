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
import type { ProposalTemplate } from './template-types.js';
/**
 * List all available templates for a namespace.
 *
 * Combines system templates with any derived templates found in the
 * namespace's `templates/` metadata directory.
 */
export declare function listTemplates(workdir: string, namespace: string): Promise<ProposalTemplate[]>;
/**
 * Load a single template by ID.
 *
 * Searches system templates first, then derived templates on disk.
 * Returns undefined if the template is not found.
 */
export declare function loadTemplate(workdir: string, namespace: string, templateId: string): Promise<ProposalTemplate | undefined>;
/**
 * Return only the system (built-in) templates — no filesystem access.
 */
export declare function getSystemTemplates(): ProposalTemplate[];
//# sourceMappingURL=template-registry.d.ts.map