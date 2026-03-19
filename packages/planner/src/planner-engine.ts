/**
 * Planner engine — generates tool execution plans using an injected LLM.
 *
 * Pure: no filesystem, no network, no env vars.
 * The LLM call is provided via GenerateFn dependency injection.
 */

import type { Plan, PlannerInput, PlanStep, GenerateFn } from './planner-types.js';

/**
 * Build the prompt sent to the LLM to generate a plan.
 */
function buildPrompt(input: PlannerInput): string {
  const toolList = input.availableTools.map((t) => `  - ${t}`).join('\n');

  const contextBlock = input.context
    ? `\nContext:\n${JSON.stringify(input.context, null, 2)}\n`
    : '';

  return `You are planning tool usage for an AI agent.

Available tools:
${toolList}

Task:
${input.task}
${contextBlock}
Return a JSON object with this exact structure:

{
  "steps": [
    {
      "tool": "tool-name",
      "input": { ... },
      "description": "what this step does"
    }
  ]
}

Rules:
- Only use tools from the available tools list above
- Keep steps minimal — do not add unnecessary steps
- Each step must have a "tool" and "input" field
- Return valid JSON only — no markdown fences, no commentary`;
}

/**
 * Parse the LLM response into a validated Plan.
 *
 * Strips markdown code fences if present, then parses JSON.
 * Validates that every step references a tool from the available list.
 */
function parsePlan(raw: string, availableTools: string[]): Plan {
  // Strip markdown fences (```json ... ``` or ``` ... ```)
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Planner returned invalid JSON. Raw response:\n${raw.slice(0, 500)}`,
    );
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).steps)
  ) {
    throw new Error(
      `Planner response missing "steps" array. Got: ${JSON.stringify(parsed).slice(0, 500)}`,
    );
  }

  const toolSet = new Set(availableTools);
  const steps: PlanStep[] = [];

  for (const entry of (parsed as { steps: unknown[] }).steps) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Invalid plan step: ${JSON.stringify(entry)}`);
    }

    const step = entry as Record<string, unknown>;

    if (typeof step.tool !== 'string') {
      throw new Error(`Plan step missing "tool" field: ${JSON.stringify(step)}`);
    }

    if (!toolSet.has(step.tool)) {
      throw new Error(
        `Plan references unknown tool "${step.tool}". Available: ${availableTools.join(', ')}`,
      );
    }

    steps.push({
      tool: step.tool,
      input: (typeof step.input === 'object' && step.input !== null
        ? step.input
        : {}) as Record<string, unknown>,
      description: typeof step.description === 'string' ? step.description : undefined,
    });
  }

  if (steps.length === 0) {
    throw new Error('Planner returned an empty plan (no steps).');
  }

  return { steps };
}

/**
 * Generate an execution plan for a given task.
 *
 * @param input       Task description, context, and available tools
 * @param generateFn  Injected LLM call — planner has no direct LLM access
 * @returns           Validated Plan with ordered tool steps
 */
export async function generatePlan(
  input: PlannerInput,
  generateFn: GenerateFn,
): Promise<Plan> {
  const prompt = buildPrompt(input);
  const raw = await generateFn(prompt);
  return parsePlan(raw, input.availableTools);
}

// Exported for testing
export { buildPrompt as _buildPrompt, parsePlan as _parsePlan };
