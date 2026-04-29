// services/api/src/chat/tool-router.ts
//
// Chat Pipeline Stage 7 — Tool Router.
//
// Executes a sequence of CALL_TOOL actions from the validated plan.
// Runs sequentially, wraps each handler in try/catch, tracks durationMs,
// and emits lifecycle events. A failed tool returns an error result and
// does NOT crash the pipeline — subsequent tools still run.

import type { AgentAction, ToolName } from './planner.js';
import type { ToolContext, ToolExecutionResult } from './tool-handlers.js';
import {
  handleGenerateProposal,
  handleEditProposalSection,
  handleGenerateMicrosite,
  handleGenerateTemplate,
  handleModifyTemplate,
  handleSearchDocuments,
  handleListProposals,
  handleListTemplates,
  handleGetProposalStatus,
  handleSetProposalStatus,
  handleRecommendTemplate,
} from './tool-handlers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CallToolAction = Extract<AgentAction, { type: 'CALL_TOOL' }>;

export interface ToolEvent {
  tool: ToolName;
  phase: 'start' | 'complete' | 'error';
  durationMs?: number;
  message?: string;
}

export interface RouterContext extends ToolContext {
  onPhase?: (phase: string) => void;
  onToolEvent?: (event: ToolEvent) => void;
}

// ---------------------------------------------------------------------------
// Tool dispatch table
// ---------------------------------------------------------------------------

type ToolHandler = (
  params: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<Omit<ToolExecutionResult, 'tool' | 'durationMs'>>;

const TOOL_HANDLERS: Record<ToolName, ToolHandler> = {
  generate_proposal: handleGenerateProposal,
  edit_proposal_section: handleEditProposalSection,
  generate_microsite: handleGenerateMicrosite,
  generate_template: handleGenerateTemplate,
  modify_template: handleModifyTemplate,
  search_documents: handleSearchDocuments,
  list_proposals: handleListProposals,
  list_templates: handleListTemplates,
  get_proposal_status: handleGetProposalStatus,
  set_proposal_status: handleSetProposalStatus,
  recommend_template: handleRecommendTemplate,
};

// ---------------------------------------------------------------------------
// executeToolActions
// ---------------------------------------------------------------------------

export async function executeToolActions(
  actions: CallToolAction[],
  context: RouterContext,
): Promise<ToolExecutionResult[]> {
  const { onPhase, onToolEvent, ...toolCtx } = context;
  const results: ToolExecutionResult[] = [];

  for (const action of actions) {
    const { tool, params } = action;
    const handler = TOOL_HANDLERS[tool];

    onPhase?.(`Running: ${tool.replace(/_/g, ' ')}`);
    onToolEvent?.({ tool, phase: 'start' });

    const startMs = Date.now();

    try {
      const partial = await handler(params, toolCtx);
      const durationMs = Date.now() - startMs;

      const result: ToolExecutionResult = { ...partial, tool, durationMs };
      results.push(result);

      onToolEvent?.({
        tool,
        phase: result.success ? 'complete' : 'error',
        durationMs,
        message: result.message,
      });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const message = err instanceof Error ? err.message : String(err);

      results.push({
        tool,
        success: false,
        message: `Tool "${tool}" failed: ${message}`,
        durationMs,
      });

      onToolEvent?.({ tool, phase: 'error', durationMs, message });
    }
  }

  return results;
}
