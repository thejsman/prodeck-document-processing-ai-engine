// services/api/src/chat/cost-control.ts
//
// Budget-enforcing wrapper around GenerateFn.
//
// Tracks LLM and tool call counts per pipeline turn and rejects calls that
// exceed the configured budget.  The pipeline creates one CostTracker per
// runChatAgent() invocation so budgets are strictly per-turn.
//
// Spec section 12.

import type { GenerateFn } from '@ai-engine/planner';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CostConfig {
  /** Maximum LLM calls allowed in a single chat turn. Default: 4. */
  maxLLMCallsPerTurn: number;
  /** Maximum LLM calls allowed during a single document ingestion run. Default: 4. */
  maxLLMCallsPerIngestion: number;
  /** Maximum tool calls allowed in a single chat turn. Default: 3. */
  maxToolCallsPerTurn: number;
  /** Soft upper bound on tokens per individual LLM call. Default: 2000.
   *  Enforced only by the bridge layer, not this tracker. */
  maxTokensPerLLMCall: number;
  /** Maximum knowledge entries retained per namespace. Default: 200. */
  maxKnowledgeEntriesPerNamespace: number;
  /** When true, emits cost summaries to the console. Default: true. */
  enableCostTracking: boolean;
}

export const DEFAULT_COST_CONFIG: CostConfig = {
  maxLLMCallsPerTurn: 4,
  maxLLMCallsPerIngestion: 4,
  maxToolCallsPerTurn: 3,
  maxTokensPerLLMCall: 2000,
  maxKnowledgeEntriesPerNamespace: 200,
  enableCostTracking: true,
};

// ---------------------------------------------------------------------------
// CostTracker
// ---------------------------------------------------------------------------

export class CostTracker {
  private llmCalls = 0;
  private toolCalls = 0;

  constructor(private readonly config: CostConfig = DEFAULT_COST_CONFIG) {}

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  get llmCallCount(): number {
    return this.llmCalls;
  }

  get toolCallCount(): number {
    return this.toolCalls;
  }

  // ---------------------------------------------------------------------------
  // Budget checks
  // ---------------------------------------------------------------------------

  hasLLMBudget(): boolean {
    return this.llmCalls < this.config.maxLLMCallsPerTurn;
  }

  hasToolBudget(): boolean {
    return this.toolCalls < this.config.maxToolCallsPerTurn;
  }

  // ---------------------------------------------------------------------------
  // Manual increments (for code paths that call tools outside the wrapper)
  // ---------------------------------------------------------------------------

  incrementLLM(): void {
    this.llmCalls += 1;
  }

  incrementTool(): void {
    this.toolCalls += 1;
  }

  // ---------------------------------------------------------------------------
  // GenerateFn wrapper — increments counter and enforces budget
  // ---------------------------------------------------------------------------

  /**
   * Returns a new GenerateFn that increments this tracker's LLM counter on
   * every call and throws before delegating when the budget is exhausted.
   *
   * Usage: pass `tracker.wrap(rawGenerateFn)` wherever a GenerateFn is needed
   * so every LLM call — intent classifier, extractor, planner, response builder
   * — is counted against the same per-turn budget.
   */
  wrap(generateFn: GenerateFn): GenerateFn {
    return async (prompt: string): Promise<string> => {
      if (!this.hasLLMBudget()) {
        throw new Error(
          `LLM budget exceeded: ${this.llmCalls}/${this.config.maxLLMCallsPerTurn} calls used this turn`,
        );
      }
      this.llmCalls += 1;
      return generateFn(prompt);
    };
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  summary(): { llmCalls: number; toolCalls: number } {
    return { llmCalls: this.llmCalls, toolCalls: this.toolCalls };
  }

  log(label: string): void {
    if (this.config.enableCostTracking) {
      console.log(
        `[CostTracker] ${label} — LLM: ${this.llmCalls}/${this.config.maxLLMCallsPerTurn}, ` +
          `tools: ${this.toolCalls}/${this.config.maxToolCallsPerTurn}`,
      );
    }
  }
}
