/**
 * Compliance Redline Workflow — DSL definition.
 *
 * States:
 *   analyzing    — LLM analyses the full proposal for compliance issues (agent)
 *   reviewing    — present issues grouped by severity, await user action (input)
 *   applying_fix — apply a chosen fix and re-present remaining issues (agent)
 *   completed    — terminal state (system)
 *
 * Transitions:
 *   analyzing  → READY   → reviewing
 *   analyzing  → DONE    → completed (no issues found)
 *   reviewing  → APPLY   → applying_fix
 *   reviewing  → DONE    → completed
 *   applying_fix → REVIEW → reviewing
 *   applying_fix → DONE  → completed
 */

import type { WorkflowDefinition } from './proposal-generation.workflow.js';

export const ComplianceRedlineWorkflow: WorkflowDefinition = {
  id: 'compliance_redline',
  initialState: 'analyzing',
  states: {

    analyzing: {
      kind: 'agent',
      transitions: {
        READY: 'reviewing',
        DONE:  'completed',
      },
    },

    reviewing: {
      kind: 'input',
      transitions: {
        APPLY: 'applying_fix',
        DONE:  'completed',
      },
    },

    applying_fix: {
      kind: 'agent',
      transitions: {
        REVIEW: 'reviewing',
        DONE:   'completed',
      },
    },

    completed: {
      kind: 'system',
      transitions: {},
    },

  },
};
