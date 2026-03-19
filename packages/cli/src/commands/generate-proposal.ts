/**
 * CLI command: generate-proposal (v2)
 *
 * Thin delegation to the proposal-generator processor plugin.
 *
 * Usage:
 *   ai-engine generate-proposal --client <name> --industry <name> \
 *     [--workdir <path>] [--output-dir <path>] [--namespace <name>] \
 *     [--template <name>] [--template-dir <path>] [--overwrite] \
 *     [--team-size <n>] [--duration-weeks <n>] [--rate-per-week <n>]
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { createConsoleReporter } from '../output/console-reporter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GenerateProposalArgs {
  readonly workdir: string;
  readonly outputDir: string | null;
  readonly client: string;
  readonly industry: string;
  readonly namespace: string | null;
  readonly template: string;
  readonly templateDir: string | null;
  readonly overwrite: boolean;
  readonly teamSize: number | null;
  readonly durationWeeks: number | null;
  readonly ratePerWeek: number | null;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(args: readonly string[]): GenerateProposalArgs {
  let workdir = process.cwd();
  let outputDir: string | null = null;
  let client: string | null = null;
  let industry: string | null = null;
  let namespace: string | null = null;
  let template = 'default';
  let templateDir: string | null = null;
  let overwrite = false;
  let teamSize: number | null = null;
  let durationWeeks: number | null = null;
  let ratePerWeek: number | null = null;

  const USAGE =
    'Usage: ai-engine generate-proposal --client <name> --industry <name> ' +
    '[--workdir <path>] [--output-dir <path>] [--namespace <name>] ' +
    '[--template <name>] [--template-dir <path>] [--overwrite] ' +
    '[--team-size <n>] [--duration-weeks <n>] [--rate-per-week <n>]';

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--workdir') {
      i++;
      if (i >= args.length) throw new Error('--workdir requires a path');
      workdir = args[i];
    } else if (arg === '--output-dir') {
      i++;
      if (i >= args.length) throw new Error('--output-dir requires a path');
      outputDir = args[i];
    } else if (arg === '--client') {
      i++;
      if (i >= args.length) throw new Error('--client requires a name');
      client = args[i];
    } else if (arg === '--industry') {
      i++;
      if (i >= args.length) throw new Error('--industry requires a name');
      industry = args[i];
    } else if (arg === '--namespace') {
      i++;
      if (i >= args.length) throw new Error('--namespace requires a name');
      namespace = args[i];
    } else if (arg === '--template') {
      i++;
      if (i >= args.length) throw new Error('--template requires a name');
      template = args[i];
    } else if (arg === '--template-dir') {
      i++;
      if (i >= args.length) throw new Error('--template-dir requires a path');
      templateDir = args[i];
    } else if (arg === '--overwrite') {
      overwrite = true;
    } else if (arg === '--team-size') {
      i++;
      if (i >= args.length) throw new Error('--team-size requires a number');
      teamSize = parseInt(args[i], 10);
      if (Number.isNaN(teamSize) || teamSize <= 0) {
        throw new Error('--team-size must be a positive integer');
      }
    } else if (arg === '--duration-weeks') {
      i++;
      if (i >= args.length) throw new Error('--duration-weeks requires a number');
      durationWeeks = parseInt(args[i], 10);
      if (Number.isNaN(durationWeeks) || durationWeeks <= 0) {
        throw new Error('--duration-weeks must be a positive integer');
      }
    } else if (arg === '--rate-per-week') {
      i++;
      if (i >= args.length) throw new Error('--rate-per-week requires a number');
      ratePerWeek = parseFloat(args[i]);
      if (Number.isNaN(ratePerWeek) || ratePerWeek <= 0) {
        throw new Error('--rate-per-week must be a positive number');
      }
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      throw new Error(`Unexpected positional argument: ${arg}\n${USAGE}`);
    }
    i++;
  }

  if (!client) {
    throw new Error(USAGE);
  }

  return {
    workdir,
    outputDir,
    client,
    industry: industry ?? 'General',
    namespace,
    template,
    templateDir,
    overwrite,
    teamSize,
    durationWeeks,
    ratePerWeek,
  };
}

// ---------------------------------------------------------------------------
// Python spawn
// ---------------------------------------------------------------------------

function spawnProcessor(
  payload: unknown,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(
      'plugins/processor-proposal-generator/processor.py',
    );
    const scriptDir = path.dirname(scriptPath);

    const child = spawn('python3', [scriptPath], {
      cwd: scriptDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(
        new Error(`Failed to spawn python3 for proposal-generator: ${err.message}`),
      );
    });

    child.on('close', (code) => {
      if (code !== 0) {
        let errorMessage = `Proposal generator exited with code ${code}`;
        if (stderr) {
          try {
            const parsed = JSON.parse(stderr) as { error?: string };
            errorMessage = parsed.error ?? errorMessage;
          } catch {
            errorMessage = stderr.trim() || errorMessage;
          }
        }
        reject(new Error(errorMessage));
      } else {
        resolve({ stdout, stderr });
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function generateProposal(
  args: readonly string[],
): Promise<void> {
  const parsed = parseArgs(args);
  const logger = createConsoleReporter();

  const workdir = path.resolve(parsed.workdir);
  const outputDir = parsed.outputDir
    ? path.resolve(parsed.outputDir)
    : path.join(workdir, 'output');

  logger.info(`Client:     ${parsed.client}`);
  logger.info(`Industry:   ${parsed.industry}`);
  logger.info(`Template:   ${parsed.template}`);
  logger.info(`Source dir: ${workdir}`);
  logger.info(`Output dir: ${outputDir}`);
  if (parsed.namespace) {
    logger.info(`Namespace:  ${parsed.namespace} (RAG enabled)`);
  }
  if (parsed.overwrite) {
    logger.info('Overwrite:  enabled (no versioning)');
  }

  // Build pricing input if all three pricing flags are provided.
  let pricing: { teamSize: number; durationWeeks: number; ratePerWeek: number } | null = null;
  if (
    parsed.teamSize !== null &&
    parsed.durationWeeks !== null &&
    parsed.ratePerWeek !== null
  ) {
    pricing = {
      teamSize: parsed.teamSize,
      durationWeeks: parsed.durationWeeks,
      ratePerWeek: parsed.ratePerWeek,
    };
    logger.info(
      `Pricing:    deterministic (${pricing.teamSize} people × ${pricing.durationWeeks} weeks × $${pricing.ratePerWeek}/wk)`,
    );
  } else if (
    parsed.teamSize !== null ||
    parsed.durationWeeks !== null ||
    parsed.ratePerWeek !== null
  ) {
    throw new Error(
      'Deterministic pricing requires all three flags: --team-size, --duration-weeks, --rate-per-week',
    );
  }

  logger.info('Generating proposal sections...');

  const { stdout } = await spawnProcessor({
    workdir,
    outputDir,
    client: parsed.client,
    industry: parsed.industry,
    namespace: parsed.namespace,
    template: parsed.template,
    templateDir: parsed.templateDir ? path.resolve(parsed.templateDir) : null,
    overwrite: parsed.overwrite,
    pricing,
  });

  const output = JSON.parse(stdout) as {
    document?: {
      metadata?: Record<string, unknown>;
    };
  };

  const meta = output.document?.metadata;

  if (meta) {
    logger.info(`Sections generated:  ${String(meta.sections ?? 'unknown')}`);
    logger.info(`Source documents:    ${String(meta.source_documents ?? 'unknown')}`);
    logger.info(`Retrieval mode:      ${String(meta.retrieval_mode ?? 'unknown')}`);
    logger.info(`Pricing mode:        ${String(meta.pricing_mode ?? 'unknown')}`);
    if (meta.version !== null && meta.version !== undefined) {
      logger.info(`Version:             v${String(meta.version)}`);
    }
    logger.info(`Output written to:   ${String(meta.output_path ?? outputDir)}`);

    const retried = meta.retried_sections;
    if (Array.isArray(retried) && retried.length > 0) {
      logger.error(`Sections that failed after retry: ${retried.join(', ')}`);
    }
  }

  process.stdout.write(JSON.stringify(output.document, null, 2) + '\n');
}
