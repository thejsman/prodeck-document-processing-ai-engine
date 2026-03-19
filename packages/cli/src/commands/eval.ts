/**
 * Evaluation harness — measures retrieval and generation quality
 * against a labeled dataset.
 *
 * Usage:
 *   ai-engine eval --dataset eval.json --namespace <name> [--workdir <path>] [--source-dir <path>]
 *
 * Dataset format (JSON array):
 *   [
 *     {
 *       "question": "What are the key risk factors?",
 *       "expectedKeywords": ["risk", "liability"],
 *       "expectedSources": ["contract1.txt"]
 *     }
 *   ]
 *
 * For retrieval overlap, expectedSources are file paths relative to
 * --source-dir (defaults to --workdir).  The harness reads each
 * source file and checks whether any retrieved chunk is a substring
 * of its content.
 */

import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createConsoleReporter } from '../output/console-reporter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalCase {
  readonly question: string;
  readonly expectedKeywords: readonly string[];
  readonly expectedSources: readonly string[];
}

interface EvalArgs {
  readonly dataset: string;
  readonly namespace: string;
  readonly workdir: string;
  readonly sourceDir: string | null;
}

interface EvalRunnerResult {
  readonly question: string;
  readonly answer: string;
  readonly retrieved_chunks: readonly string[];
  readonly latency_ms: number;
  readonly provider: string;
}

interface CaseResult {
  readonly question: string;
  readonly answer: string;
  readonly provider: string;
  readonly latencyMs: number;
  readonly keywordHits: readonly string[];
  readonly keywordMisses: readonly string[];
  readonly keywordHitRate: number;
  readonly retrievalHits: readonly string[];
  readonly retrievalMisses: readonly string[];
  readonly retrievalHitRate: number;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseEvalArgs(args: readonly string[]): EvalArgs {
  let dataset: string | null = null;
  let namespace = 'default';
  let workdir = process.cwd();
  let sourceDir: string | null = null;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--dataset') {
      i++;
      if (i >= args.length) throw new Error('--dataset requires a file path');
      dataset = args[i];
    } else if (arg === '--namespace') {
      i++;
      if (i >= args.length) throw new Error('--namespace requires a name');
      namespace = args[i];
    } else if (arg === '--workdir') {
      i++;
      if (i >= args.length) throw new Error('--workdir requires a path');
      workdir = args[i];
    } else if (arg === '--source-dir') {
      i++;
      if (i >= args.length) throw new Error('--source-dir requires a path');
      sourceDir = args[i];
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      throw new Error(
        `Unexpected positional argument: ${arg}\n` +
          'Usage: ai-engine eval --dataset <file> --namespace <name> [--workdir <path>] [--source-dir <path>]',
      );
    }
    i++;
  }

  if (!dataset) {
    throw new Error(
      'Usage: ai-engine eval --dataset <file> --namespace <name> [--workdir <path>] [--source-dir <path>]',
    );
  }

  return { dataset, namespace, workdir, sourceDir };
}

// ---------------------------------------------------------------------------
// Dataset loading & validation
// ---------------------------------------------------------------------------

async function loadDataset(filePath: string): Promise<EvalCase[]> {
  const raw = await readFile(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error('Evaluation dataset must be a JSON array');
  }

  if (parsed.length === 0) {
    throw new Error('Evaluation dataset is empty');
  }

  const cases: EvalCase[] = [];

  for (let idx = 0; idx < parsed.length; idx++) {
    const entry = parsed[idx] as Record<string, unknown>;

    if (typeof entry.question !== 'string' || entry.question.length === 0) {
      throw new Error(`Dataset entry [${idx}]: "question" must be a non-empty string`);
    }

    if (!Array.isArray(entry.expectedKeywords)) {
      throw new Error(`Dataset entry [${idx}]: "expectedKeywords" must be an array`);
    }

    if (!Array.isArray(entry.expectedSources)) {
      throw new Error(`Dataset entry [${idx}]: "expectedSources" must be an array`);
    }

    cases.push({
      question: entry.question,
      expectedKeywords: entry.expectedKeywords as string[],
      expectedSources: entry.expectedSources as string[],
    });
  }

  return cases;
}

// ---------------------------------------------------------------------------
// Spawn eval runner (Python)
// ---------------------------------------------------------------------------

function spawnEvalRunner(
  payload: unknown,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const scriptDir = path.resolve('plugins/processor-local-faiss-rag');
    const scriptPath = path.join(scriptDir, 'eval_runner.py');

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
      reject(new Error(`Failed to spawn python3: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        let errorMessage = `Eval runner exited with code ${code}`;
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
// Measurement helpers
// ---------------------------------------------------------------------------

function measureKeywords(
  answer: string,
  expected: readonly string[],
): { hits: string[]; misses: string[] } {
  const lowerAnswer = answer.toLowerCase();
  const hits: string[] = [];
  const misses: string[] = [];

  for (const kw of expected) {
    if (lowerAnswer.includes(kw.toLowerCase())) {
      hits.push(kw);
    } else {
      misses.push(kw);
    }
  }

  return { hits, misses };
}

async function measureRetrieval(
  retrievedChunks: readonly string[],
  expectedSources: readonly string[],
  sourceDir: string,
): Promise<{ hits: string[]; misses: string[] }> {
  const hits: string[] = [];
  const misses: string[] = [];

  for (const sourceFile of expectedSources) {
    const sourcePath = path.resolve(sourceDir, sourceFile);

    let sourceContent: string;
    try {
      const s = await stat(sourcePath);
      if (!s.isFile()) {
        misses.push(sourceFile);
        continue;
      }
      sourceContent = await readFile(sourcePath, 'utf-8');
    } catch {
      // File not readable — count as miss but don't fail the run.
      misses.push(sourceFile);
      continue;
    }

    const lowerSource = sourceContent.toLowerCase();
    const found = retrievedChunks.some((chunk) =>
      lowerSource.includes(chunk.toLowerCase()),
    );

    if (found) {
      hits.push(sourceFile);
    } else {
      misses.push(sourceFile);
    }
  }

  return { hits, misses };
}

// ---------------------------------------------------------------------------
// Summary formatting
// ---------------------------------------------------------------------------

function formatSummary(results: readonly CaseResult[]): string {
  const lines: string[] = [];

  // ── Per-case details ────────────────────────────────────────
  lines.push('');
  lines.push('='.repeat(72));
  lines.push('  EVALUATION RESULTS');
  lines.push('='.repeat(72));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push('');
    lines.push(`─── Case ${i + 1}/${results.length} ───`);
    lines.push(`  Question:          ${r.question}`);
    lines.push(`  Provider:          ${r.provider}`);
    lines.push(`  Latency:           ${r.latencyMs.toFixed(0)} ms`);
    lines.push(
      `  Keywords:          ${r.keywordHits.length}/${r.keywordHits.length + r.keywordMisses.length} hit` +
        (r.keywordMisses.length > 0 ? `  (missed: ${r.keywordMisses.join(', ')})` : ''),
    );
    lines.push(
      `  Retrieval:         ${r.retrievalHits.length}/${r.retrievalHits.length + r.retrievalMisses.length} hit` +
        (r.retrievalMisses.length > 0 ? `  (missed: ${r.retrievalMisses.join(', ')})` : ''),
    );
  }

  // ── Aggregate summary ──────────────────────────────────────
  const totalKeywords = results.reduce((s, r) => s + r.keywordHits.length + r.keywordMisses.length, 0);
  const hitKeywords = results.reduce((s, r) => s + r.keywordHits.length, 0);
  const keywordPct = totalKeywords > 0 ? (hitKeywords / totalKeywords) * 100 : 0;

  const totalSources = results.reduce((s, r) => s + r.retrievalHits.length + r.retrievalMisses.length, 0);
  const hitSources = results.reduce((s, r) => s + r.retrievalHits.length, 0);
  const retrievalPct = totalSources > 0 ? (hitSources / totalSources) * 100 : 0;

  const avgLatency = results.reduce((s, r) => s + r.latencyMs, 0) / results.length;

  lines.push('');
  lines.push('='.repeat(72));
  lines.push('  SUMMARY');
  lines.push('='.repeat(72));
  lines.push(`  Questions evaluated:   ${results.length}`);
  lines.push(`  Retrieval accuracy:    ${retrievalPct.toFixed(1)}%  (${hitSources}/${totalSources} sources)`);
  lines.push(`  Keyword hit rate:      ${keywordPct.toFixed(1)}%  (${hitKeywords}/${totalKeywords} keywords)`);
  lines.push(`  Avg latency:           ${avgLatency.toFixed(0)} ms`);

  // ── Provider comparison ────────────────────────────────────
  const byProvider = new Map<string, CaseResult[]>();
  for (const r of results) {
    const existing = byProvider.get(r.provider) ?? [];
    existing.push(r);
    byProvider.set(r.provider, existing);
  }

  if (byProvider.size > 1) {
    lines.push('');
    lines.push('  Provider comparison:');

    for (const [provider, cases] of byProvider) {
      const pKw = cases.reduce((s, r) => s + r.keywordHits.length, 0);
      const pKwTotal = cases.reduce((s, r) => s + r.keywordHits.length + r.keywordMisses.length, 0);
      const pRet = cases.reduce((s, r) => s + r.retrievalHits.length, 0);
      const pRetTotal = cases.reduce((s, r) => s + r.retrievalHits.length + r.retrievalMisses.length, 0);
      const pLat = cases.reduce((s, r) => s + r.latencyMs, 0) / cases.length;

      lines.push(
        `    ${provider}:  keyword ${pKwTotal > 0 ? ((pKw / pKwTotal) * 100).toFixed(1) : '0.0'}%` +
          `  retrieval ${pRetTotal > 0 ? ((pRet / pRetTotal) * 100).toFixed(1) : '0.0'}%` +
          `  latency ${pLat.toFixed(0)}ms` +
          `  (${cases.length} queries)`,
      );
    }
  }

  lines.push('='.repeat(72));
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// JSON report
// ---------------------------------------------------------------------------

interface EvalReport {
  readonly timestamp: string;
  readonly namespace: string;
  readonly dataset: string;
  readonly cases: readonly CaseResult[];
  readonly summary: {
    readonly totalQuestions: number;
    readonly retrievalAccuracyPct: number;
    readonly keywordHitRatePct: number;
    readonly avgLatencyMs: number;
  };
}

function buildReport(
  results: readonly CaseResult[],
  namespace: string,
  datasetPath: string,
): EvalReport {
  const totalKeywords = results.reduce((s, r) => s + r.keywordHits.length + r.keywordMisses.length, 0);
  const hitKeywords = results.reduce((s, r) => s + r.keywordHits.length, 0);
  const totalSources = results.reduce((s, r) => s + r.retrievalHits.length + r.retrievalMisses.length, 0);
  const hitSources = results.reduce((s, r) => s + r.retrievalHits.length, 0);

  return {
    timestamp: new Date().toISOString(),
    namespace,
    dataset: datasetPath,
    cases: results,
    summary: {
      totalQuestions: results.length,
      retrievalAccuracyPct: totalSources > 0 ? Math.round(((hitSources / totalSources) * 100) * 10) / 10 : 0,
      keywordHitRatePct: totalKeywords > 0 ? Math.round(((hitKeywords / totalKeywords) * 100) * 10) / 10 : 0,
      avgLatencyMs: Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length),
    },
  };
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function evaluate(args: readonly string[]): Promise<void> {
  const parsed = parseEvalArgs(args);
  const logger = createConsoleReporter();

  const workdir = path.resolve(parsed.workdir);
  const sourceDir = parsed.sourceDir ? path.resolve(parsed.sourceDir) : workdir;
  const storageDir = path.join(workdir, 'namespaces', parsed.namespace);
  const datasetPath = path.resolve(parsed.dataset);

  logger.info(`Namespace:  ${parsed.namespace}`);
  logger.info(`Dataset:    ${datasetPath}`);
  logger.info(`Source dir: ${sourceDir}`);
  logger.info(`Storage:    ${storageDir}`);

  // ── Load dataset ───────────────────────────────────────────
  const cases = await loadDataset(datasetPath);
  logger.info(`Loaded ${cases.length} evaluation case(s)`);

  // ── Run eval via Python ────────────────────────────────────
  logger.info('Running evaluation queries...');

  const { stdout } = await spawnEvalRunner({
    storageDir,
    namespace: parsed.namespace,
    questions: cases.map((c) => c.question),
  });

  const runnerOutput = JSON.parse(stdout) as {
    results: EvalRunnerResult[];
  };

  if (runnerOutput.results.length !== cases.length) {
    throw new Error(
      `Runner returned ${runnerOutput.results.length} results for ${cases.length} questions`,
    );
  }

  // ── Measure each case ──────────────────────────────────────
  const caseResults: CaseResult[] = [];

  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];
    const runner = runnerOutput.results[i];

    const kw = measureKeywords(runner.answer, evalCase.expectedKeywords);
    const ret = await measureRetrieval(
      runner.retrieved_chunks,
      evalCase.expectedSources,
      sourceDir,
    );

    const kwTotal = kw.hits.length + kw.misses.length;
    const retTotal = ret.hits.length + ret.misses.length;

    caseResults.push({
      question: runner.question,
      answer: runner.answer,
      provider: runner.provider,
      latencyMs: runner.latency_ms,
      keywordHits: kw.hits,
      keywordMisses: kw.misses,
      keywordHitRate: kwTotal > 0 ? kw.hits.length / kwTotal : 0,
      retrievalHits: ret.hits,
      retrievalMisses: ret.misses,
      retrievalHitRate: retTotal > 0 ? ret.hits.length / retTotal : 0,
    });
  }

  // ── Output ─────────────────────────────────────────────────
  process.stderr.write(formatSummary(caseResults));

  const report = buildReport(caseResults, parsed.namespace, datasetPath);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
