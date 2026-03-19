/**
 * CLI command: agent
 *
 * Dispatches agent subcommands. Currently supports:
 *   ai-engine agent run <agentName> [options]
 *
 * Usage:
 *   ai-engine agent run proposal-section \
 *     --namespace acme \
 *     --section "Implementation Plan" \
 *     --instruction "Make it shorter" \
 *     [--workdir <path>]
 */

import path from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';
import {
  ConfigResolver,
  MemoryRegistry,
  AgentRunner,
  agentRegistry,
  registerDefaultAgents,
  toolRegistry,
  registerDefaultTools,
  createUsageRecorder,
  noopUsageRecorder,
} from '@ai-engine/core';
import type { AgentInput } from '@ai-engine/core';
import { createNodeConfigLoader, FileMemoryStore } from '@ai-engine/runtime';
import { ProposalSectionAgent } from '@ai-engine/agent-proposal-section';
import { MicrositeGeneratorAgent } from '@ai-engine/agent-microsite-generator';
import { ExtractSectionTool } from '@ai-engine/tool-extract-section';
import { createConsoleReporter } from '../output/console-reporter.js';

// Register all default agents and tools once at import time.
registerDefaultAgents([new ProposalSectionAgent(), new MicrositeGeneratorAgent()]);
registerDefaultTools([new ExtractSectionTool()]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentRunArgs {
  readonly agentName: string;
  readonly namespace: string;
  readonly workdir: string;
  readonly section: string | null;
  readonly instruction: string | null;
  readonly prompt: string | null;
  readonly metadata: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseRunArgs(args: readonly string[]): AgentRunArgs {
  const USAGE =
    'Usage: ai-engine agent run <agentName> --namespace <ns> ' +
    '[--section <title>] [--instruction <text>] [--prompt <text>] ' +
    '[--workdir <path>] [--meta <key=value> ...]';

  if (args.length === 0) throw new Error(USAGE);

  const agentName = args[0];
  let namespace: string | null = null;
  let workdir = process.cwd();
  let section: string | null = null;
  let instruction: string | null = null;
  let prompt: string | null = null;
  const metadata: Record<string, string> = {};

  let i = 1;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--namespace') {
      i++;
      if (i >= args.length) throw new Error('--namespace requires a value');
      namespace = args[i];
    } else if (arg === '--workdir') {
      i++;
      if (i >= args.length) throw new Error('--workdir requires a path');
      workdir = args[i];
    } else if (arg === '--section') {
      i++;
      if (i >= args.length) throw new Error('--section requires a value');
      section = args[i];
    } else if (arg === '--instruction') {
      i++;
      if (i >= args.length) throw new Error('--instruction requires a value');
      instruction = args[i];
    } else if (arg === '--prompt') {
      i++;
      if (i >= args.length) throw new Error('--prompt requires a value');
      prompt = args[i];
    } else if (arg === '--meta') {
      i++;
      if (i >= args.length) throw new Error('--meta requires a key=value pair');
      const pair = args[i];
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) throw new Error(`--meta value must be key=value, got: ${pair}`);
      metadata[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}\n${USAGE}`);
    } else {
      throw new Error(`Unexpected argument: ${arg}\n${USAGE}`);
    }
    i++;
  }

  if (!namespace) throw new Error(`--namespace is required\n${USAGE}`);

  return { agentName, namespace, workdir, section, instruction, prompt, metadata };
}

// ---------------------------------------------------------------------------
// Runner setup
// ---------------------------------------------------------------------------

async function buildRunner(workdir: string) {
  const configBasePath = path.join(workdir, 'config');
  const memoryBasePath = path.join(workdir, 'memory');
  const usageEventsPath = path.join(workdir, 'data', 'usage', 'events.jsonl');

  const configLoader = createNodeConfigLoader(configBasePath);
  const configResolver = new ConfigResolver(configLoader);

  const memoryStore = new FileMemoryStore(memoryBasePath);
  const memoryRegistry = new MemoryRegistry(memoryStore);

  // Best-effort usage recording — failures are swallowed so CLI never blocks.
  let usageRecorder = noopUsageRecorder;
  try {
    await mkdir(path.dirname(usageEventsPath), { recursive: true });
    usageRecorder = createUsageRecorder(async (line) => {
      await appendFile(usageEventsPath, line + '\n', 'utf-8');
    });
  } catch {
    // Non-fatal — proceed without recording
  }

  return new AgentRunner(agentRegistry, configResolver, memoryRegistry, usageRecorder, toolRegistry);
}

// ---------------------------------------------------------------------------
// Subcommand: run
// ---------------------------------------------------------------------------

async function runAgent(args: readonly string[]): Promise<void> {
  const logger = createConsoleReporter();
  const parsed = parseRunArgs(args);
  const workdir = path.resolve(parsed.workdir);

  // Build AgentInput
  const meta: Record<string, string | undefined> = { ...parsed.metadata };
  if (parsed.section) meta.sectionName = parsed.section;
  if (parsed.instruction) meta.instruction = parsed.instruction;

  const input: AgentInput = {
    namespace: parsed.namespace,
    ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
    metadata: meta,
  };

  logger.info(`Agent:     ${parsed.agentName}`);
  logger.info(`Namespace: ${parsed.namespace}`);
  if (parsed.section) logger.info(`Section:   ${parsed.section}`);
  if (parsed.instruction) logger.info(`Instruction: ${parsed.instruction}`);
  logger.info('Running agent...');

  const runner = await buildRunner(workdir);
  const output = await runner.run(parsed.agentName, input);

  if (output.markdown) {
    process.stdout.write(output.markdown + '\n');
  } else if (output.json !== undefined) {
    process.stdout.write(JSON.stringify(output.json, null, 2) + '\n');
  } else {
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  }
}

// ---------------------------------------------------------------------------
// Exported command: agent
// Dispatches subcommands: run | (future: list, describe)
// ---------------------------------------------------------------------------

export async function agent(args: readonly string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stderr.write('Usage: ai-engine agent <subcommand> [options]\n\n');
    process.stderr.write('Subcommands:\n');
    process.stderr.write('  run <agentName>   Execute a named agent\n\n');
    process.stderr.write('Examples:\n');
    process.stderr.write(
      '  ai-engine agent run proposal-section \\\n' +
      '    --namespace acme \\\n' +
      '    --section "Implementation Plan" \\\n' +
      '    --instruction "Make it shorter"\n',
    );
    return;
  }

  if (subcommand === 'run') {
    await runAgent(args.slice(1));
    return;
  }

  throw new Error(`Unknown agent subcommand: ${subcommand}`);
}
