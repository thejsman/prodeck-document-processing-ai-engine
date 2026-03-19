import { createInterface } from 'node:readline';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { run } from './run.js';
import { ingest } from './ingest.js';
import { query } from './query.js';
import { namespaces } from './namespaces.js';
import { formatError } from '../output/console-reporter.js';

const BANNER = `
██████╗ ██████╗  ██████╗ ██████╗ ███████╗ ██████╗██╗  ██╗      █████╗ ██╗
██╔══██╗██╔══██╗██╔═══██╗██╔══██╗██╔════╝██╔════╝██║ ██╔╝     ██╔══██╗██║
██████╔╝██████╔╝██║   ██║██║  ██║█████╗  ██║     █████╔╝█████╗███████║██║
██╔═══╝ ██╔══██╗██║   ██║██║  ██║██╔══╝  ██║     ██╔═██╗╚════╝██╔══██║██║
██║     ██║  ██║╚██████╔╝██████╔╝███████╗╚██████╗██║  ██╗     ██║  ██║██║
╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝     ╚═╝  ╚═╝╚═╝
                                                                         
  Prodeck-ai CLI v0.1
  Local-First AI Workflow Engine

  Type "help" for available commands, "exit" to quit.
`;

const HELP_TEXT = `
  Available commands:

    run <pipeline.yaml> <input> [options]
        Run a pipeline on an input file or directory.
        Options:
          --plugins <dir>   Plugin directory (repeatable)
          --workdir <dir>   Working directory (default: cwd)
          --stream          Enable streaming output

    ingest <path> [options]
        Ingest text files into the persistent FAISS knowledge base.
        Accepts a single file or a directory (recursive).
        Options:
          --workdir <dir>   Directory for index storage (default: cwd)

    query "<question>" [options]
        Query the knowledge base with a natural language question.
        Options:
          --workdir <dir>   Directory containing the FAISS index (default: cwd)
          --stream          Stream the answer as it generates

    namespaces [options]
        List available namespaces in the knowledge base.
        Options:
          --workdir <dir>   Directory containing namespaces (default: cwd)

    help
        Show this help message.

    exit
        Quit the interactive CLI.

    <filepath>
        Process a file using the default pipeline
        (examples/generic-documents/pipeline.yaml).
        Equivalent to:
          run examples/generic-documents/pipeline.yaml <filepath>
              --plugins plugins/extractor-pdf
              --plugins plugins/processor-summarize
              --plugins plugins/exporter-json
`;

const DEFAULT_PIPELINE = 'examples/generic-documents/pipeline.yaml';
const DEFAULT_PLUGINS = ['plugins/extractor-pdf', 'plugins/processor-summarize', 'plugins/exporter-json'];

function buildDefaultRunArgs(filePath: string, stream: boolean): string[] {
  const args = [DEFAULT_PIPELINE, filePath];
  for (const plugin of DEFAULT_PLUGINS) {
    args.push('--plugins', plugin);
  }
  if (stream) {
    args.push('--stream');
  }
  return args;
}

async function looksLikeFilePath(input: string): Promise<boolean> {
  try {
    const resolved = path.resolve(input);
    const s = await stat(resolved);
    return s.isFile() || s.isDirectory();
  } catch {
    return false;
  }
}

function parseLine(line: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (const ch of line) {
    if (inQuote !== null) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }

  const command = tokens[0] ?? '';
  const args = tokens.slice(1);
  return { command, args };
}

async function handleInput(line: string, stream: boolean): Promise<boolean> {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return true;
  }

  const { command, args } = parseLine(trimmed);

  switch (command) {
    case 'exit':
    case 'quit':
      process.stderr.write('Goodbye.\n');
      return false;

    case 'help':
      process.stderr.write(HELP_TEXT);
      return true;

    case 'run': {
      const runArgs = stream && !args.includes('--stream') ? [...args, '--stream'] : args;
      try {
        await run(runArgs);
      } catch (error: unknown) {
        process.stderr.write(`[error] ${formatError(error)}\n`);
      }
      return true;
    }

    case 'ingest': {
      try {
        await ingest(args);
      } catch (error: unknown) {
        process.stderr.write(`[error] ${formatError(error)}\n`);
      }
      return true;
    }

    case 'query': {
      const queryArgs = stream && !args.includes('--stream') ? [...args, '--stream'] : args;
      try {
        await query(queryArgs);
      } catch (error: unknown) {
        process.stderr.write(`[error] ${formatError(error)}\n`);
      }
      return true;
    }

    case 'namespaces': {
      try {
        await namespaces(args);
      } catch (error: unknown) {
        process.stderr.write(`[error] ${formatError(error)}\n`);
      }
      return true;
    }

    default: {
      if (await looksLikeFilePath(trimmed)) {
        process.stderr.write(`[info] Using default pipeline for: ${trimmed}\n`);
        try {
          await run(buildDefaultRunArgs(trimmed, stream));
        } catch (error: unknown) {
          process.stderr.write(`[error] ${formatError(error)}\n`);
        }
      } else {
        process.stderr.write(`Unknown command: "${command}". Type "help" for available commands.\n`);
      }
      return true;
    }
  }
}

export async function interactive(stream = false): Promise<void> {
  process.stderr.write(BANNER);

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: '> ',
    terminal: process.stdin.isTTY === true,
  });

  const lineQueue: string[] = [];
  let processing = false;

  function processNext(): void {
    if (processing) return;

    const line = lineQueue.shift();
    if (line === undefined) {
      rl.prompt();
      return;
    }

    processing = true;
    handleInput(line, stream)
      .then((shouldContinue) => {
        processing = false;
        if (shouldContinue) {
          processNext();
        } else {
          rl.close();
        }
      })
      .catch((error: unknown) => {
        processing = false;
        process.stderr.write(`[error] ${formatError(error)}\n`);
        processNext();
      });
  }

  rl.prompt();

  return new Promise<void>((resolve) => {
    rl.on('line', (line: string) => {
      lineQueue.push(line);
      processNext();
    });

    rl.on('close', () => {
      resolve();
    });
  });
}
