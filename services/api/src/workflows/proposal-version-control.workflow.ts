/**
 * Proposal Version Control Workflow — DSL definition.
 *
 * Single-step workflow that detects whether the user wants to view
 * version history or rollback, executes the action, and completes.
 *
 * States:
 *   resolve_action — detect sub-intent (history vs rollback), execute (system)
 *   completed      — terminal state (system)
 */

import type { WorkflowDefinition } from './proposal-generation.workflow.js';

export const ProposalVersionControlWorkflow: WorkflowDefinition = {
  id: 'proposal_version_control',
  initialState: 'resolve_action',
  states: {

    resolve_action: {
      kind: 'system',
      transitions: { DONE: 'completed' },
    },

    completed: {
      kind: 'system',
      transitions: {},
    },

  },
};
