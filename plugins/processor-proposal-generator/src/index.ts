/**
 * Proposal generator processor plugin (v2).
 *
 * TypeScript wrapper that spawns the Python processor with config
 * drawn from the pipeline step's config and the ExecutionContext.
 *
 * When used via pipeline YAML:
 *   - type: process
 *     ref: proposal-generator
 *     config:
 *       client: "Acme Corp"
 *       industry: "Financial Services"
 *       outputDir: "./output"       # optional, defaults to <workdir>/output
 *       namespace: "acme"           # optional, enables RAG retrieval
 *       template: "default"         # optional, YAML template name
 *       overwrite: false            # optional, skip versioning
 *       pricing:                    # optional, deterministic pricing
 *         teamSize: 5
 *         durationWeeks: 12
 *         ratePerWeek: 2500
 *
 * When invoked directly from the CLI generate-proposal command the
 * same Python script is spawned with an identical JSON payload.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExecutionContext } from '@ai-engine/runtime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Document {
  readonly type: string;
  readonly source: string;
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface PricingInput {
  readonly teamSize: number;
  readonly durationWeeks: number;
  readonly ratePerWeek: number;
}

export interface MemoryPayload {
  readonly preferredTone?: string;
  readonly clientProfile?: unknown;
  readonly pastLessons?: unknown[];
  readonly avoidPhrases?: string[];
}

export interface ProcessorPayload {
  readonly workdir: string;
  readonly outputDir: string;
  readonly client: string;
  readonly industry: string;
  readonly namespace: string | null;
  readonly template: string;
  readonly templateDir: string | null;
  readonly overwrite: boolean;
  readonly pricing: PricingInput | null;
  readonly tone: string | null;
  readonly memory: MemoryPayload | null;
}

// ---------------------------------------------------------------------------
// Script path resolution
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.resolve(__dirname, '..', 'processor.py');

function resolvePython(scriptDir: string): string {
  const faissPluginDir = path.resolve(__dirname, '../../processor-local-faiss-rag');
  const faissVenv = path.join(faissPluginDir, '.venv', 'bin', 'python3');
  if (existsSync(faissVenv)) return faissVenv;
  const rootVenv = path.resolve(__dirname, '../../../.venv/bin/python3');
  if (existsSync(rootVenv)) return rootVenv;
  return 'python3';
}

// ---------------------------------------------------------------------------
// Python subprocess
// ---------------------------------------------------------------------------

export function spawnProposalGenerator(
  payload: ProcessorPayload,
): Promise<Document> {
  return new Promise((resolve, reject) => {
    const scriptDir = path.dirname(SCRIPT_PATH);

    const child = spawn(resolvePython(scriptDir), [SCRIPT_PATH], {
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
      reject(new Error(`Failed to spawn python3 for proposal-generator: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        let errorMessage = `Proposal generator exited with code ${code}`;
        if (stderr) {
          try {
            const parsed = JSON.parse(stderr) as { error?: string; type?: string };
            const msg = parsed.error || '';
            // Include exception type when message is empty (e.g. bare AssertionError)
            errorMessage = msg || (parsed.type ? `${parsed.type} (no message)` : errorMessage);
          } catch {
            errorMessage = stderr.trim() || errorMessage;
          }
        }
        reject(new Error(errorMessage));
        return;
      }

      try {
        const output = JSON.parse(stdout) as { document?: Document };
        if (!output.document || typeof output.document !== 'object') {
          reject(new Error('Proposal generator output missing "document" field'));
          return;
        }
        resolve(output.document);
      } catch (err) {
        reject(
          new Error(
            `Proposal generator output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

const processor = {
  name: 'proposal-generator' as const,

  async process(
    _data: unknown,
    config?: Readonly<Record<string, unknown>>,
    context?: ExecutionContext,
  ): Promise<Document> {
    if (!context) {
      throw new Error('ExecutionContext is required for proposal-generator');
    }

    const coreConfig = context.config;
    const ctxMemory = context.memory as Record<string, unknown> | undefined;

    // Pipeline config → context.config fallback → hard default
    const workdir = (config?.workdir as string) ?? context.workingDirectory;
    const outputDir =
      (config?.outputDir as string) ??
      path.join(context.workingDirectory, 'output');
    const client = (config?.client as string) ?? 'Client';
    const industry = (config?.industry as string) ?? 'General';
    const namespace = (config?.namespace as string) ?? context.namespace ?? null;
    const template =
      (config?.template as string) ??
      coreConfig?.defaultTemplate ??
      'default';
    const templateDir =
      (config?.templateDir as string) ??
      path.join(context.workingDirectory, 'data', 'templates');
    const overwrite = (config?.overwrite as boolean) ?? false;

    // Pricing: pipeline config → context.config.pricingDefaults fallback
    const pricingFromConfig = config?.pricing as PricingInput | undefined;
    const pricingDefaults = coreConfig?.pricingDefaults;
    const pricing: PricingInput | null = pricingFromConfig
      ?? (pricingDefaults?.ratePerWeek != null
        ? {
            teamSize: (config?.teamSize as number) ?? 1,
            durationWeeks: (config?.durationWeeks as number) ?? 1,
            ratePerWeek: pricingDefaults.ratePerWeek,
          }
        : null);

    // Tone: pipeline config → context.config → memory.preferredTone
    const tone: string | null =
      (config?.tone as string) ??
      coreConfig?.tone ??
      (ctxMemory?.preferredTone as string) ??
      null;

    // Memory payload for Python
    const memory: MemoryPayload | null = ctxMemory
      ? {
          preferredTone: ctxMemory.preferredTone as string | undefined,
          clientProfile: ctxMemory.clientProfile,
          pastLessons: ctxMemory.pastLessons as unknown[] | undefined,
          avoidPhrases: ctxMemory.avoidPhrases as string[] | undefined,
        }
      : null;

    context.logger.info(`Generating proposal for: ${client} (${industry})`);
    context.logger.info(`Source documents: ${workdir}`);
    context.logger.info(`Template: ${template}`);
    if (tone) {
      context.logger.info(`Tone: ${tone}`);
    }
    context.logger.info(`Output directory: ${outputDir}`);

    const document = await spawnProposalGenerator({
      workdir,
      outputDir,
      client,
      industry,
      namespace,
      template,
      templateDir,
      overwrite,
      pricing,
      tone,
      memory,
    });

    const meta = document.metadata as Record<string, unknown>;
    context.logger.info(`Proposal written to: ${String(meta.output_path)}`);
    if (meta.version !== null && meta.version !== undefined) {
      context.logger.info(`Version: v${String(meta.version)}`);
    }

    return document;
  },
};

export default processor;
