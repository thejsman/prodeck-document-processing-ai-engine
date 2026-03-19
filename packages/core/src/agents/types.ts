/**
 * Core agent interfaces.
 *
 * Agents are simple task workers that sit above the pipeline/provider
 * infrastructure. They receive structured input, call whatever they need
 * (via injected dependencies or spawned processes), and return output.
 *
 * No framework. No magic. Just typed function wrappers.
 */

import type { ToolRegistry } from '../tools/tool-registry.js';

/**
 * Planner interface — agents use this to generate and execute multi-step
 * tool plans instead of manually orchestrating tool calls.
 *
 * Defined here (not in packages/planner) so core types stay self-contained
 * and agents can reference it without depending on the planner package.
 */
export interface Planner {
  generatePlan(input: {
    task: string;
    context?: Record<string, unknown>;
    availableTools: string[];
  }): Promise<{ steps: { tool: string; input: Record<string, unknown>; description?: string }[] }>;

  executePlan(
    plan: { steps: { tool: string; input: Record<string, unknown> }[] },
    toolRegistry: ToolRegistry,
  ): Promise<{
    stepResults: { step: { tool: string; input: Record<string, unknown> }; output: import('../tools/types.js').ToolOutput }[];
  }>;
}

export interface AgentInput {
  namespace: string;
  prompt?: string;
  documents?: string[];
  config?: Record<string, unknown>;
  memory?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tools?: ToolRegistry;
  planner?: Planner;
}

export interface AgentOutput {
  markdown?: string;
  json?: unknown;
  assets?: string[];
}

export interface Agent {
  readonly name: string;
  readonly description: string;
  run(input: AgentInput): Promise<AgentOutput>;
}
