/**
 * CLI command: generate-microsite
 *
 * Thin wrapper around the microsite-generator-agent.
 *
 * Usage:
 *   ai-engine generate-microsite --namespace <ns> \
 *     [--proposal-id <id>] [--plugin <theme>] \
 *     [--prompt <text>] [--workdir <path>]
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
import { MicrositeGeneratorAgent } from '@ai-engine/agent-microsite-generator';
import { ExtractSectionTool } from '@ai-engine/tool-extract-section';
import { createConsoleReporter } from '../output/console-reporter.js';

registerDefaultAgents([new MicrositeGeneratorAgent()]);
registerDefaultTools([new ExtractSectionTool()]);

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface GenerateMicrositeArgs {
  readonly namespace: string;
  readonly proposalId: string | null;
  readonly plugin: string | null;
  readonly prompt: string | null;
  readonly workdir: string;
}

function parseArgs(args: readonly string[]): GenerateMicrositeArgs {
  const USAGE =
    'Usage: ai-engine generate-microsite --namespace <ns> ' +
    '[--proposal-id <id>] [--plugin <theme>] [--prompt <text>] [--workdir <path>]';

  let namespace: string | null = null;
  let proposalId: string | null = null;
  let plugin: string | null = null;
  let prompt: string | null = null;
  let workdir = process.cwd();

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--namespace') {
      i++;
      if (i >= args.length) throw new Error('--namespace requires a value');
      namespace = args[i];
    } else if (arg === '--proposal-id') {
      i++;
      if (i >= args.length) throw new Error('--proposal-id requires a value');
      proposalId = args[i];
    } else if (arg === '--plugin') {
      i++;
      if (i >= args.length) throw new Error('--plugin requires a theme name');
      plugin = args[i];
    } else if (arg === '--prompt') {
      i++;
      if (i >= args.length) throw new Error('--prompt requires a value');
      prompt = args[i];
    } else if (arg === '--workdir') {
      i++;
      if (i >= args.length) throw new Error('--workdir requires a path');
      workdir = args[i];
    } else if (arg === '--help' || arg === '-h') {
      process.stderr.write(USAGE + '\n');
      process.exit(0);
    } else {
      throw new Error(`Unknown flag: ${arg}\n${USAGE}`);
    }
    i++;
  }

  if (!namespace) throw new Error(`--namespace is required\n${USAGE}`);

  return { namespace, proposalId, plugin, prompt, workdir };
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function generateMicrosite(args: readonly string[]): Promise<void> {
  const logger = createConsoleReporter();
  const parsed = parseArgs(args);
  const workdir = path.resolve(parsed.workdir);

  logger.info(`Namespace:   ${parsed.namespace}`);
  if (parsed.proposalId) logger.info(`Proposal ID: ${parsed.proposalId}`);
  if (parsed.plugin) logger.info(`Plugin:      ${parsed.plugin}`);
  logger.info('Generating microsite...');

  const configBasePath = path.join(workdir, 'config');
  const memoryBasePath = path.join(workdir, 'memory');
  const usageEventsPath = path.join(workdir, 'data', 'usage', 'events.jsonl');

  const configLoader = createNodeConfigLoader(configBasePath);
  const configResolver = new ConfigResolver(configLoader);
  const memoryStore = new FileMemoryStore(memoryBasePath);
  const memoryRegistry = new MemoryRegistry(memoryStore);

  let usageRecorder = noopUsageRecorder;
  try {
    await mkdir(path.dirname(usageEventsPath), { recursive: true });
    usageRecorder = createUsageRecorder(async (line) => {
      await appendFile(usageEventsPath, line + '\n', 'utf-8');
    });
  } catch {
    // Non-fatal
  }

  const runner = new AgentRunner(agentRegistry, configResolver, memoryRegistry, usageRecorder, toolRegistry);

  const metadata: Record<string, string> = {};
  if (parsed.proposalId) metadata.proposalId = parsed.proposalId;
  if (parsed.plugin) metadata.plugin = parsed.plugin;

  const input: AgentInput = {
    namespace: parsed.namespace,
    ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
    metadata,
  };

  const output = await runner.run('microsite-generator-agent', input);

  if (output.markdown) {
    process.stdout.write(output.markdown + '\n');
  } else if (output.json !== undefined) {
    process.stdout.write(JSON.stringify(output.json, null, 2) + '\n');
  } else {
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  }
}
