import path from 'node:path';
import { queryKnowledgeBase } from '@ai-engine/runtime';
import { createConsoleReporter } from '../output/console-reporter.js';

interface QueryArgs {
  readonly question: string;
  readonly workdir: string;
  readonly namespace: string;
  readonly stream: boolean;
}

function parseQueryArgs(args: readonly string[]): QueryArgs {
  const positional: string[] = [];
  let workdir = process.cwd();
  let namespace = 'default';
  let stream = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--workdir') {
      i++;
      if (i >= args.length) {
        throw new Error('--workdir requires a path argument');
      }
      workdir = args[i];
    } else if (arg === '--namespace') {
      i++;
      if (i >= args.length) {
        throw new Error('--namespace requires a name argument');
      }
      namespace = args[i];
    } else if (arg === '--stream') {
      stream = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
    i++;
  }

  if (positional.length < 1) {
    throw new Error(
      'Usage: ai-engine query "<question>" [--workdir <path>] [--namespace <name>] [--stream]',
    );
  }

  return {
    question: positional[0],
    workdir,
    namespace,
    stream,
  };
}

export async function query(args: readonly string[]): Promise<void> {
  const parsed = parseQueryArgs(args);
  const logger = createConsoleReporter();

  const workdir = path.resolve(parsed.workdir);
  const storageDir = path.join(workdir, 'namespaces', parsed.namespace);

  logger.info(`Namespace: ${parsed.namespace}`);
  logger.info(`Querying index in: ${storageDir}`);

  const result = await queryKnowledgeBase({
    question: parsed.question,
    storageDir,
    namespace: parsed.namespace,
    stream: parsed.stream,
    onChunk: parsed.stream
      ? (chunk: string) => { process.stdout.write(chunk); }
      : undefined,
  });

  if (!parsed.stream) {
    process.stdout.write(result.answer + '\n');
  }
}
