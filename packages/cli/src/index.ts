#!/usr/bin/env node

import { run } from './commands/run.js';
import { ingest } from './commands/ingest.js';
import { query } from './commands/query.js';
import { namespaces } from './commands/namespaces.js';
import { evaluate } from './commands/eval.js';
import { generateProposal } from './commands/generate-proposal.js';
import { interactive } from './commands/interactive.js';
import { agent } from './commands/agent-run.js';
import { tools } from './commands/tools.js';
import { planner } from './commands/planner.js';
import { formatError } from './output/console-reporter.js';

const COMMANDS: Readonly<Record<string, (args: readonly string[]) => Promise<void>>> = {
  run,
  ingest,
  query,
  namespaces,
  eval: evaluate,
  'generate-proposal': generateProposal,
  agent,
  tools,
  planner,
};

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  const globalStream = rawArgs.includes('--stream');
  const args = globalStream
    ? rawArgs.filter((a) => a !== '--stream')
    : rawArgs;

  const commandName = args[0];

  if (commandName === undefined) {
    await interactive(globalStream);
    return;
  }

  if (commandName === '--help' || commandName === '-h') {
    process.stderr.write('Usage: ai-engine [command] [options]\n\n');
    process.stderr.write('Commands:\n');
    process.stderr.write('  run <pipeline.yaml> <inputPath>   Run a pipeline\n');
    process.stderr.write('  ingest <path>                     Ingest documents into FAISS index\n');
    process.stderr.write('  query "<question>"                Query the knowledge base\n');
    process.stderr.write('  eval --dataset <file>             Evaluate retrieval & generation quality\n');
    process.stderr.write('  generate-proposal --client <n>    Generate a structured proposal\n');
    process.stderr.write('  namespaces                        List available namespaces\n');
    process.stderr.write('  agent run <name> --namespace <ns> Run a named agent\n');
    process.stderr.write('  tools list                        List available tools\n');
    process.stderr.write('  planner simulate --task <desc>    Simulate a tool execution plan\n');
    process.stderr.write('  (no command)                      Enter interactive mode\n\n');
    process.stderr.write('Options:\n');
    process.stderr.write('  --plugins <path>   Plugin directory (repeatable)\n');
    process.stderr.write('  --workdir <path>   Working directory (default: cwd)\n');
    process.stderr.write('  --stream           Enable streaming output for AI processors\n');
    process.exit(0);
  }

  const command = COMMANDS[commandName];
  if (command === undefined) {
    process.stderr.write(`Unknown command: ${commandName}\n`);
    process.exit(1);
  }

  const STREAM_COMMANDS = new Set(['run', 'query']);
  const commandArgs =
    globalStream && STREAM_COMMANDS.has(commandName)
      ? [...args.slice(1), '--stream']
      : args.slice(1);
  await command(commandArgs);
}

main().catch((error: unknown) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(1);
});
