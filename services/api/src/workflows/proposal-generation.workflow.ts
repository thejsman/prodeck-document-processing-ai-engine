/**
 * Proposal Generation Workflow — DSL definition.
 *
 * Declarative state machine describing the proposal creation flow.
 * No side effects; this is a pure configuration object consumed by the
 * ChatOrchestrator to drive state transitions.
 *
 * States:
 *   collecting_rfp        — wait for user to upload RFP document (input)
 *   collecting_inputs     — gather required fields: industry, timeline, budget (input)
 *   recommend_template    — analyse RFP context and recommend a template (agent)
 *   confirm_generation    — show summary, ask user to confirm before generation (input)
 *   generating_outline    — LLM generates structured outline from RFP (agent)
 *   generating_sections   — plugin expands outline into full proposal draft (tool)
 *   qa_review             — detect cross-section contradictions, offer fix (input)
 *   completed             — terminal state, proposal artifact persisted (system)
 */

export type StateKind = 'input' | 'agent' | 'tool' | 'system';

export interface WorkflowState {
  /** Determines execution strategy: input = wait, agent/tool = execute, system = terminal. */
  kind: StateKind;
  /** Map of signal name → next state name. */
  transitions: Record<string, string>;
}

export interface WorkflowDefinition {
  id: string;
  initialState: string;
  states: Record<string, WorkflowState>;
}

export const ProposalWorkflow: WorkflowDefinition = {
  id: 'proposal_generation',
  initialState: 'collecting_rfp',
  states: {

    collecting_rfp: {
      kind: 'input',
      transitions: { READY: 'collecting_inputs' },
    },

    collecting_inputs: {
      kind: 'input',
      transitions: { READY: 'recommend_template' },
    },

    recommend_template: {
      kind: 'input',
      transitions: {
        DONE: 'confirm_generation',
        /** User chose to pick a different template — re-enter as input. */
        CHOOSE: 'recommend_template',
      },
    },

    confirm_generation: {
      kind: 'input',
      transitions: {
        /** User confirmed — proceed to outline + section generation. */
        CONFIRM: 'generating_outline',
        /** User declined — go back to input collection. */
        DECLINE: 'collecting_inputs',
      },
    },

    generating_outline: {
      kind: 'agent',
      transitions: { DONE: 'generating_sections' },
    },

    generating_sections: {
      kind: 'tool',
      transitions: { DONE: 'qa_review' },
    },

    qa_review: {
      kind: 'input',
      transitions: { DONE: 'completed' },
    },

    completed: {
      kind: 'system',
      transitions: {},
    },

  },
};
