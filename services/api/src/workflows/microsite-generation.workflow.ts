/**
 * Microsite Generation Workflow — DSL definition.
 *
 * Converts an existing proposal document into a presentation microsite using
 * the microsite-generator-agent.
 *
 * States:
 *   checking_proposal    — locate the target proposal in the namespace (input)
 *   generating_microsite — run microsite-generator-agent on the proposal (agent)
 *   completed            — terminal state, microsite artifact persisted (system)
 */

import type { WorkflowDefinition } from './proposal-generation.workflow.js';

export const MicrositeGenerationWorkflow: WorkflowDefinition = {
  id: 'microsite_generation',
  initialState: 'checking_proposal',
  states: {

    checking_proposal: {
      kind: 'input',
      transitions: { READY: 'generating_microsite' },
    },

    generating_microsite: {
      kind: 'agent',
      transitions: { DONE: 'completed' },
    },

    completed: {
      kind: 'system',
      transitions: {},
    },

  },
};
