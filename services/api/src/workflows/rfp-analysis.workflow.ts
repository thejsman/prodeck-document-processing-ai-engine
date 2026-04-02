/**
 * RFP Analysis Workflow — DSL definition.
 *
 * Six-state machine that takes a user from RFP detection through structured
 * requirement extraction, capability gap analysis, and a go/no-go decision.
 *
 * States:
 *   checking_rfp       — system auto-checks namespace for an RFP (system)
 *   await_rfp_upload   — prompts user to upload if no RFP found (input)
 *   extract_requirements — semantic extraction into structured matrix (tool)
 *   gap_analysis       — LLM identifies capability + input gaps (agent)
 *   go_no_go           — LLM produces bid viability recommendation (agent)
 *   completed          — terminal, all artifacts persisted (system)
 */

import type { WorkflowDefinition } from './proposal-generation.workflow.js';

export const RfpAnalysisWorkflow: WorkflowDefinition = {
  id: 'rfp_analysis',
  initialState: 'checking_rfp',
  states: {

    checking_rfp: {
      kind: 'system',
      transitions: {
        READY: 'extract_requirements',
        MISSING: 'await_rfp_upload',
      },
    },

    await_rfp_upload: {
      kind: 'input',
      transitions: {
        READY: 'extract_requirements',
      },
    },

    extract_requirements: {
      kind: 'tool',
      transitions: {
        DONE: 'gap_analysis',
      },
    },

    gap_analysis: {
      kind: 'agent',
      transitions: {
        DONE: 'go_no_go',
      },
    },

    go_no_go: {
      kind: 'agent',
      transitions: {
        DONE: 'completed',
      },
    },

    completed: {
      kind: 'system',
      transitions: {},
    },

  },
};
