import path from 'node:path';
import { listNamespaces } from '@ai-engine/runtime';

interface NamespacesArgs {
  readonly workdir: string;
}

function parseNamespacesArgs(args: readonly string[]): NamespacesArgs {
  let workdir = process.cwd();

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--workdir') {
      i++;
      if (i >= args.length) {
        throw new Error('--workdir requires a path argument');
      }
      workdir = args[i];
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    i++;
  }

  return { workdir };
}

export async function namespaces(args: readonly string[]): Promise<void> {
  const parsed = parseNamespacesArgs(args);
  const workdir = path.resolve(parsed.workdir);

  const names = await listNamespaces(workdir);

  if (names.length === 0) {
    process.stdout.write('No namespaces found.\n');
    return;
  }

  for (const name of names) {
    process.stdout.write(`${name}\n`);
  }
}
