/**
 * Template Creation Workflow — DSL definition.
 *
 * Interactive chat flow for generating a new proposal template when no
 * existing template closely matches the current RFP.
 *
 * States:
 *   analyzing_rfp         — extract RFP requirements and stream a draft template (agent)
 *   review_template       — pause for user approval or revision request (input)
 *   generating_template   — re-generate template with revision instructions (agent)
 *   name_template         — pause to capture a name for the new template (input)
 *   saving_template       — write YAML to disk (tool)
 *   completed             — terminal state (system)
 */

import type { WorkflowDefinition } from './proposal-generation.workflow.js';

export const TemplateCreationWorkflow: WorkflowDefinition = {
  id: 'template_creation',
  initialState: 'analyzing_rfp',
  states: {

    analyzing_rfp: {
      kind: 'agent',
      transitions: { DRAFT_READY: 'review_template' },
    },

    review_template: {
      kind: 'input',
      transitions: {
        APPROVED: 'name_template',
        REVISE: 'generating_template',
      },
    },

    generating_template: {
      kind: 'agent',
      transitions: { DRAFT_READY: 'review_template' },
    },

    name_template: {
      kind: 'input',
      transitions: { NAMED: 'saving_template' },
    },

    saving_template: {
      kind: 'tool',
      transitions: { DONE: 'completed' },
    },

    completed: {
      kind: 'system',
      transitions: {},
    },

  },
};
