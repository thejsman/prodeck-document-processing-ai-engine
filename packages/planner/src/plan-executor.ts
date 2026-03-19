/**
 * Plan executor — runs each step of a Plan sequentially against the ToolRegistry.
 *
 * Pure: no filesystem, no network, no env vars.
 * All side effects happen inside the tools themselves (which are injected).
 */

import type { ToolRegistry } from '@ai-engine/core';
import type { Plan, PlanExecutionResult, StepResult } from './planner-types.js';

/**
 * Execute every step in a plan, in order, collecting results.
 *
 * Each step's output is available to the caller for post-processing.
 * Steps run sequentially — a future version could support parallel
 * execution for independent steps, but sequential is the safe default.
 *
 * @param plan          The plan to execute (from generatePlan)
 * @param toolRegistry  Registry containing all registered tools
 * @returns             Results for every step, in order
 */
export async function executePlan(
  plan: Plan,
  toolRegistry: ToolRegistry,
): Promise<PlanExecutionResult> {
  const stepResults: StepResult[] = [];

  for (const step of plan.steps) {
    const tool = toolRegistry.get(step.tool);
    const output = await tool.run(step.input);
    stepResults.push({ step, output });
  }

  return { stepResults };
}
