import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PipelineRegistry } from '@ai-engine/core';
import {
  loadPipelineFromFile,
  loadPlugins,
  runPipeline,
  type ExecutionContext,
} from '@ai-engine/runtime';
import { createConsoleReporter } from '../output/console-reporter.js';

interface RunArgs {
  readonly pipelinePath: string;
  readonly inputPath: string;
  readonly pluginDirs: readonly string[];
  readonly workdir: string;
  readonly stream: boolean;
}

interface FileInput {
  readonly fileName: string;
  readonly content: Buffer;
}

function parseRunArgs(args: readonly string[]): RunArgs {
  const positional: string[] = [];
  const pluginDirs: string[] = [];
  let workdir = process.cwd();
  let stream = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--plugins') {
      i++;
      if (i >= args.length) {
        throw new Error('--plugins requires a path argument');
      }
      pluginDirs.push(args[i]);
    } else if (arg === '--workdir') {
      i++;
      if (i >= args.length) {
        throw new Error('--workdir requires a path argument');
      }
      workdir = args[i];
    } else if (arg === '--stream') {
      stream = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
    i++;
  }

  if (positional.length < 2) {
    throw new Error(
      'Usage: ai-engine run <pipeline.yaml> <inputPath> [--plugins <path>]... [--workdir <path>] [--stream]',
    );
  }

  return {
    pipelinePath: positional[0],
    inputPath: positional[1],
    pluginDirs,
    workdir,
    stream,
  };
}

async function prepareInputs(inputPath: string): Promise<FileInput[]> {
  const inputStat = await stat(inputPath);

  if (inputStat.isFile()) {
    return [
      {
        fileName: path.basename(inputPath),
        content: await readFile(inputPath),
      },
    ];
  }

  if (inputStat.isDirectory()) {
    const entries = (await readdir(inputPath))
      .filter((name) => !name.startsWith('.'))
      .sort();

    const inputs: FileInput[] = [];
    for (const entry of entries) {
      const fullPath = path.join(inputPath, entry);
      const entryStat = await stat(fullPath);
      if (entryStat.isFile()) {
        inputs.push({
          fileName: entry,
          content: await readFile(fullPath),
        });
      }
    }
    return inputs;
  }

  throw new Error(`Input path is neither a file nor a directory: ${inputPath}`);
}

function serializeOutput(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (typeof data === 'string') {
    return Buffer.from(data, 'utf-8');
  }
  return Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
}

export async function run(args: readonly string[]): Promise<void> {
  const parsed = parseRunArgs(args);

  const workdir = path.resolve(parsed.workdir);
  const pipelinePath = path.resolve(parsed.pipelinePath);
  const inputPath = path.resolve(parsed.inputPath);
  const pluginDirs = parsed.pluginDirs.map((d) => path.resolve(d));

  const logger = createConsoleReporter();
  const context: ExecutionContext = {
    runId: randomUUID(),
    workingDirectory: workdir,
    logger,
    stream: parsed.stream,
    onStreamChunk: parsed.stream
      ? (content: string) => {
          process.stdout.write(content);
        }
      : undefined,
    config: {},
    memory: {},
  };

  logger.info(`Run ID: ${context.runId}`);

  const registry = new PipelineRegistry();

  if (pluginDirs.length > 0) {
    logger.info(`Loading plugins from ${pluginDirs.length} director(ies)`);
    await loadPlugins(pluginDirs, registry);
    logger.info('Plugins loaded');
  }

  logger.info(`Loading pipeline: ${pipelinePath}`);
  const pipeline = await loadPipelineFromFile(pipelinePath);
  logger.info(`Pipeline "${pipeline.name}" v${pipeline.version} loaded`);

  const inputs = await prepareInputs(inputPath);
  logger.info(`Found ${inputs.length} input file(s)`);

  if (inputs.length === 0) {
    logger.info('No input files to process');
    return;
  }

  const outputDir = path.join(workdir, 'output', context.runId);
  await mkdir(outputDir, { recursive: true });

  for (const input of inputs) {
    logger.info(`Processing: ${input.fileName}`);
    const result = await runPipeline(pipeline, input.content, registry, context);
    if (parsed.stream) {
      process.stdout.write('\n');
    }
    const output = serializeOutput(result);
    const outputPath = path.join(outputDir, input.fileName);
    await writeFile(outputPath, output);
    logger.info(`Output written: ${outputPath}`);
  }

  logger.info(
    `Pipeline "${pipeline.name}" completed: ${inputs.length} file(s) processed`,
  );
}
