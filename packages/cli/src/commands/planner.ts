/**
 * CLI command: planner
 *
 * Subcommands:
 *   simulate   — generate and display a tool execution plan without running it
 *
 * Usage:
 *   ai-engine planner simulate \
 *     --task "Generate microsite diagrams" \
 *     [--tools extract-section,generate-mermaid,save-asset] \
 *     [--context '{"key":"value"}']
 */

import { generatePlan, type GenerateFn } from '@ai-engine/planner';
import { toolRegistry, registerDefaultTools } from '@ai-engine/core';
import { ExtractSectionTool } from '@ai-engine/tool-extract-section';
import { createConsoleReporter } from '../output/console-reporter.js';

// Register default tools so we know the available set
registerDefaultTools([new ExtractSectionTool()]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SimulateArgs {
  readonly task: string;
  readonly tools: string[] | null;
  readonly context: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseSimulateArgs(args: readonly string[]): SimulateArgs {
  const USAGE =
    'Usage: ai-engine planner simulate --task <description> ' +
    '[--tools tool1,tool2,...] [--context \'{"key":"value"}\']';

  let task: string | null = null;
  let tools: string[] | null = null;
  let context: Record<string, unknown> | null = null;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--task') {
      i++;
      if (i >= args.length) throw new Error('--task requires a value');
      task = args[i];
    } else if (arg === '--tools') {
      i++;
      if (i >= args.length) throw new Error('--tools requires a comma-separated list');
      tools = args[i].split(',').map((t) => t.trim()).filter(Boolean);
    } else if (arg === '--context') {
      i++;
      if (i >= args.length) throw new Error('--context requires a JSON string');
      try {
        context = JSON.parse(args[i]) as Record<string, unknown>;
      } catch {
        throw new Error(`--context must be valid JSON. Got: ${args[i]}`);
      }
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}\n${USAGE}`);
    } else {
      throw new Error(`Unexpected argument: ${arg}\n${USAGE}`);
    }
    i++;
  }

  if (!task) throw new Error(`--task is required\n${USAGE}`);

  return { task, tools, context };
}

// ---------------------------------------------------------------------------
// Simulate subcommand
// ---------------------------------------------------------------------------

async function simulate(args: readonly string[]): Promise<void> {
  const logger = createConsoleReporter();
  const parsed = parseSimulateArgs(args);

  // Determine available tools
  const availableTools = parsed.tools ?? toolRegistry.list();

  if (availableTools.length === 0) {
    throw new Error('No tools available. Register tools or pass --tools flag.');
  }

  logger.info(`Task:  ${parsed.task}`);
  logger.info(`Tools: ${availableTools.join(', ')}`);
  logger.info('');
  logger.info('Generating plan...');

  // Stub generateFn — in simulate mode, we use a deterministic mock
  // that produces a reasonable plan without calling any LLM.
  const mockGenerateFn: GenerateFn = async (_prompt: string) => {
    // Return a mock plan based on the task and available tools.
    // This makes `planner simulate` work without an LLM configured.
    const steps = availableTools.map((tool) => ({
      tool,
      input: {},
      description: `Execute ${tool} for: ${parsed.task}`,
    }));
    return JSON.stringify({ steps });
  };

  const plan = await generatePlan(
    {
      task: parsed.task,
      context: parsed.context ?? undefined,
      availableTools,
    },
    mockGenerateFn,
  );

  // Pretty-print the plan
  logger.info('');
  logger.info('Generated Plan:');
  logger.info('─'.repeat(50));

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    logger.info(`  Step ${i + 1}: ${step.tool}`);
    if (step.description) {
      logger.info(`    Description: ${step.description}`);
    }
    if (Object.keys(step.input).length > 0) {
      logger.info(`    Input: ${JSON.stringify(step.input)}`);
    }
  }

  logger.info('─'.repeat(50));
  logger.info(`Total steps: ${plan.steps.length}`);

  // Also write raw JSON to stdout for machine consumption
  process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Exported command: planner
// ---------------------------------------------------------------------------

export async function planner(args: readonly string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stderr.write('Usage: ai-engine planner <subcommand> [options]\n\n');
    process.stderr.write('Subcommands:\n');
    process.stderr.write('  simulate   Generate and display a tool execution plan\n\n');
    process.stderr.write('Examples:\n');
    process.stderr.write(
      '  ai-engine planner simulate \\\n' +
      '    --task "Generate microsite diagrams" \\\n' +
      '    --tools extract-section,generate-mermaid,save-asset\n',
    );
    return;
  }

  if (subcommand === 'simulate') {
    await simulate(args.slice(1));
    return;
  }

  throw new Error(`Unknown planner subcommand: ${subcommand}`);
}
