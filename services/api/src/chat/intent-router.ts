/**
 * Intent router v1 — rule-based message classification.
 *
 * Determines whether an incoming chat message should trigger a workflow,
 * and if so, which one.  No ML or embeddings — deterministic pattern matching
 * on lowercased message text.
 *
 * Returns null for messages that do not match any known workflow trigger,
 * allowing callers to fall through to generic RAG query handling.
 */

export interface IntentRouteResult {
  workflowId: string;
}

/**
 * Patterns that signal the user wants to create a proposal.
 * Checked in order; first match wins.
 */
const PROPOSAL_TRIGGERS = [
  'create proposal',
  'generate proposal',
  'make a proposal',
  'write a proposal',
  'build a proposal',
  'draft a proposal',
  'proposal for',
  'proposal about',
  'new proposal',
];

/**
 * Route the user's message to a workflow ID, or return null.
 *
 * @example
 * routeIntent('Create proposal for cloud migration') // → { workflowId: 'proposal_generation' }
 * routeIntent('What is RAG?')                        // → null
 */
export function routeIntent(message: string): IntentRouteResult | null {
  const lower = message.toLowerCase().trim();

  // Multi-word patterns checked first (more specific)
  for (const trigger of PROPOSAL_TRIGGERS) {
    if (lower.includes(trigger)) {
      return { workflowId: 'proposal_generation' };
    }
  }

  // Fallback: any message containing the word "proposal"
  if (lower.includes('proposal')) {
    return { workflowId: 'proposal_generation' };
  }

  return null;
}
