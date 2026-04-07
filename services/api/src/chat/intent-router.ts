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
 * Reset / start-over triggers.
 * Checked by the orchestrator BEFORE workflow dispatch to allow clearing an
 * active instance and starting fresh.
 */
const RESET_TRIGGERS = [
  'start over',
  'start again',
  'restart',
  'reset',
  'clear workflow',
  'new session',
  'cancel workflow',
  'cancel this',
  'forget this',
  'discard',
  'begin again',
  'start fresh',
];

/**
 * Returns true if the message is a request to reset the current workflow.
 */
export function isResetIntent(message: string): boolean {
  const lower = message.toLowerCase().trim();
  for (const trigger of RESET_TRIGGERS) {
    if (lower.includes(trigger)) return true;
  }
  return false;
}

/**
 * Patterns that signal the user wants to analyse an RFP.
 * Checked before proposal triggers — more specific intent.
 */
const RFP_ANALYSIS_TRIGGERS = [
  'analyze rfp',
  'analyse rfp',
  'analyze this rfp',
  'analyse this rfp',
  'rfp analysis',
  'analyse the rfp',
  'analyze the rfp',
  'should we bid',
  'should we respond',
  'bid or no bid',
  'go no go',
  'go/no-go',
  'evaluate rfp',
  'evaluate the rfp',
  'review rfp',
  'review the rfp',
  'rfp review',
];

/**
 * Patterns that signal the user wants version control or inline editing operations.
 * Checked before proposal triggers — more specific intent.
 */
const VERSION_CONTROL_TRIGGERS = [
  // History / rollback
  'rollback',
  'roll back',
  'revert',
  'revert to',
  'undo changes',
  'undo edit',
  'go back to version',
  'restore version',
  'show history',
  'show versions',
  'version history',
  'proposal history',
  'list versions',
  'proposal versions',
  // Inline section editing
  'update the summary',
  'update the timeline',
  'update the budget',
  'update the team',
  'update the solution',
  'update the approach',
  'update section',
  'edit section',
  'edit the summary',
  'edit the timeline',
  'change the tone',
  'change the summary',
  'change the timeline',
  'change the budget',
  'rewrite the summary',
  'rewrite the timeline',
  'rewrite section',
  'make it more',
  'make the tone',
  'make the summary',
  'make the proposal',
];

/**
 * Patterns that signal the user wants to create a custom proposal template.
 * Checked before proposal triggers — more specific intent.
 */
const TEMPLATE_CREATION_TRIGGERS = [
  'create template',
  'generate template',
  'build template',
  'make a template',
  'create a template',
  'build a template',
  'generate a template',
  'create proposal template',
  'generate proposal template',
  'new template',
  'design a template',
  'design template',
  'make template',
];

/**
 * Patterns that signal the user wants a compliance / legal review of the proposal.
 * Checked before proposal triggers — more specific intent.
 */
const COMPLIANCE_TRIGGERS = [
  'check compliance',
  'compliance check',
  'compliance review',
  'review compliance',
  'review for compliance',
  'review for legal',
  'legal review',
  'legal check',
  'redline',
  'red line',
  'check for legal risks',
  'check for risks',
  'flag legal issues',
  'flag compliance',
  'compliance issues',
  'legal issues',
  'validate proposal',
  'proposal validation',
];

/**
 * Patterns that signal the user wants to generate a presentation microsite
 * from an existing proposal.
 * Checked before proposal triggers — more specific intent.
 */
const MICROSITE_TRIGGERS = [
  'generate microsite',
  'create microsite',
  'build microsite',
  'make microsite',
  'create a microsite',
  'generate a microsite',
  'build a microsite',
  'make a microsite',
  'turn this into a microsite',
  'turn proposal into microsite',
  'convert to microsite',
  'convert proposal to microsite',
  'proposal to microsite',
  'create presentation',
  'generate presentation',
  'build presentation',
  'make a presentation',
  'create a presentation',
  'generate a presentation',
  'proposal presentation',
  'turn this into a presentation',
  'turn proposal into presentation',
  'convert to presentation',
  'microsite from proposal',
  'presentation from proposal',
  'create a site',
  'generate a site',
  'build a site',
  'proposal site',
];

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
  'i need a proposal',
  'help me write a proposal',
  'help me create a proposal',
  'help me build a proposal',
  'prepare a proposal',
];

/**
 * Route the user's message to a workflow ID, or return null.
 *
 * @example
 * routeIntent('Analyze this RFP')           // → { workflowId: 'rfp_analysis' }
 * routeIntent('Create proposal for cloud')  // → { workflowId: 'proposal_generation' }
 * routeIntent('What is RAG?')               // → null
 */
export function routeIntent(message: string): IntentRouteResult | null {
  const lower = message.toLowerCase().trim();

  // RFP analysis checked first — more specific than proposal triggers
  for (const trigger of RFP_ANALYSIS_TRIGGERS) {
    if (lower.includes(trigger)) {
      return { workflowId: 'rfp_analysis' };
    }
  }

  // Microsite generation — checked before proposal triggers
  for (const trigger of MICROSITE_TRIGGERS) {
    if (lower.includes(trigger)) {
      return { workflowId: 'microsite_generation' };
    }
  }

  // Template creation — checked before proposal triggers
  for (const trigger of TEMPLATE_CREATION_TRIGGERS) {
    if (lower.includes(trigger)) {
      return { workflowId: 'template_creation' };
    }
  }

  // Compliance redline — checked before proposal triggers
  for (const trigger of COMPLIANCE_TRIGGERS) {
    if (lower.includes(trigger)) {
      return { workflowId: 'compliance_redline' };
    }
  }

  // Version control — checked before proposal triggers
  for (const trigger of VERSION_CONTROL_TRIGGERS) {
    if (lower.includes(trigger)) {
      return { workflowId: 'proposal_version_control' };
    }
  }

  // Multi-word proposal patterns
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
