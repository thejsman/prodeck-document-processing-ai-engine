import { readFile, readdir, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ingestDocuments } from '@ai-engine/runtime';
import { createConsoleReporter } from '../output/console-reporter.js';

const INGESTABLE_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm',
  '.log', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.ts', '.js', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.rs', '.go', '.rb', '.php', '.sh', '.bash', '.zsh',
  '.css', '.scss', '.less', '.sql', '.r', '.m', '.swift',
  '.kt', '.scala', '.ex', '.exs', '.erl', '.hs', '.lua',
  '.pl', '.pm', '.tex', '.rst', '.adoc', '.org',
  '.pdf',
]);

interface IngestArgs {
  readonly inputPath: string;
  readonly workdir: string;
  readonly namespace: string;
}

function parseIngestArgs(args: readonly string[]): IngestArgs {
  const positional: string[] = [];
  let workdir = process.cwd();
  let namespace = 'default';

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
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
    i++;
  }

  if (positional.length < 1) {
    throw new Error(
      'Usage: ai-engine ingest <path> [--workdir <path>] [--namespace <name>]',
    );
  }

  return {
    inputPath: positional[0],
    workdir,
    namespace,
  };
}

function isIngestable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return INGESTABLE_EXTENSIONS.has(ext);
}

async function readFileContent(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') {
    const buffer = await readFile(filePath);
    return buffer.toString('utf-8');
  }
  return readFile(filePath, 'utf-8');
}

async function collectFiles(inputPath: string): Promise<{ fileName: string; content: string }[]> {
  const resolved = path.resolve(inputPath);
  const inputStat = await stat(resolved);

  if (inputStat.isFile()) {
    if (!isIngestable(resolved)) {
      throw new Error(`Not a recognized file type: ${resolved}`);
    }
    const content = await readFileContent(resolved);
    return [{ fileName: path.basename(resolved), content }];
  }

  if (inputStat.isDirectory()) {
    return collectFromDirectory(resolved);
  }

  throw new Error(`Input path is neither a file nor a directory: ${resolved}`);
}

async function collectFromDirectory(dirPath: string): Promise<{ fileName: string; content: string }[]> {
  const results: { fileName: string; content: string }[] = [];
  const entries = (await readdir(dirPath, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  );

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isFile() && isIngestable(fullPath)) {
      const content = await readFileContent(fullPath);
      results.push({ fileName: entry.name, content });
    } else if (entry.isDirectory()) {
      const nested = await collectFromDirectory(fullPath);
      for (const item of nested) {
        results.push({
          fileName: path.join(entry.name, item.fileName),
          content: item.content,
        });
      }
    }
  }

  return results;
}

export async function ingest(args: readonly string[]): Promise<void> {
  const parsed = parseIngestArgs(args);
  const logger = createConsoleReporter();

  const workdir = path.resolve(parsed.workdir);
  const inputPath = path.resolve(parsed.inputPath);
  const storageDir = path.join(workdir, 'namespaces', parsed.namespace);

  await mkdir(storageDir, { recursive: true });

  logger.info(`Namespace: ${parsed.namespace}`);
  logger.info(`Collecting text files from: ${inputPath}`);
  const documents = await collectFiles(inputPath);

  if (documents.length === 0) {
    logger.info('No ingestable files found');
    return;
  }

  logger.info(`Found ${documents.length} text file(s), sending to FAISS index...`);

  const result = await ingestDocuments({
    documents,
    storageDir,
    namespace: parsed.namespace,
  });

  const providerNote = result.provider ? ` via ${result.provider}` : '';
  process.stdout.write(
    `Indexed ${result.documents} documents, ${result.chunks} chunks into namespace "${parsed.namespace}"${providerNote}\n`,
  );
}
