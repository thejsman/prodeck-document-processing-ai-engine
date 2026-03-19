import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ExecutionContext } from './pipeline-runner.js';
import { PythonPluginError } from '../errors/python-plugin-error.js';

/** Resolve the best Python executable for a plugin script.
 *  Prefers .venv/bin/python3 inside the plugin directory if present. */
function resolvePython(scriptPath: string): string {
  const venvPython = join(dirname(scriptPath), '.venv', 'bin', 'python3');
  return existsSync(venvPython) ? venvPython : 'python3';
}

interface Document {
  readonly type: string;
  readonly source: string;
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

interface PythonProcessInput {
  document: Document;
  context: {
    runId: string;
    workingDirectory: string;
    stream: boolean;
  };
}

interface PythonProcessOutput {
  document: Document;
}

interface StreamMessage {
  type: 'start' | 'chunk' | 'end' | 'result';
  content?: string;
  document?: Document;
}

function runBatch(
  scriptPath: string,
  inputJson: string,
  context: ExecutionContext,
  pluginName: string,
): Promise<Document> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolvePython(scriptPath), [scriptPath], {
      cwd: context.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8');
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8');
    });

    proc.on('error', (error) => {
      reject(
        new PythonPluginError({
          code: 'SPAWN_FAILED',
          message: `Failed to spawn Python process for plugin "${pluginName}": ${error.message}`,
          pluginName,
          stderr: stderr || undefined,
        }),
      );
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(
          new PythonPluginError({
            code: 'PROCESS_ERROR',
            message: `Python process for plugin "${pluginName}" exited with code ${code}`,
            pluginName,
            stderr: stderr || undefined,
            exitCode: code ?? undefined,
          }),
        );
        return;
      }

      try {
        const output = JSON.parse(stdout) as PythonProcessOutput;

        if (!output.document || typeof output.document !== 'object') {
          reject(
            new PythonPluginError({
              code: 'INVALID_OUTPUT',
              message: `Python plugin "${pluginName}" output missing "document" field`,
              pluginName,
              stderr: stderr || undefined,
            }),
          );
          return;
        }

        resolve(output.document);
      } catch (error) {
        reject(
          new PythonPluginError({
            code: 'INVALID_OUTPUT',
            message: `Python plugin "${pluginName}" output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            pluginName,
            stderr: stderr || undefined,
          }),
        );
      }
    });

    proc.stdin.write(inputJson, 'utf-8');
    proc.stdin.end();
  });
}

function runStreaming(
  scriptPath: string,
  inputJson: string,
  context: ExecutionContext,
  pluginName: string,
): Promise<Document> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolvePython(scriptPath), [scriptPath], {
      cwd: context.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    let lineBuffer = '';
    let resultDocument: Document | null = null;

    proc.stdout.on('data', (data: Buffer) => {
      lineBuffer += data.toString('utf-8');

      let newlineIndex: number;
      while ((newlineIndex = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.substring(0, newlineIndex).trim();
        lineBuffer = lineBuffer.substring(newlineIndex + 1);

        if (line.length === 0) continue;

        let msg: StreamMessage;
        try {
          msg = JSON.parse(line) as StreamMessage;
        } catch {
          continue;
        }

        switch (msg.type) {
          case 'chunk':
            if (msg.content !== undefined && context.onStreamChunk) {
              context.onStreamChunk(msg.content);
            }
            break;
          case 'result':
            if (msg.document) {
              resultDocument = msg.document;
            }
            break;
          case 'start':
          case 'end':
            break;
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8');
    });

    proc.on('error', (error) => {
      reject(
        new PythonPluginError({
          code: 'SPAWN_FAILED',
          message: `Failed to spawn Python process for plugin "${pluginName}": ${error.message}`,
          pluginName,
          stderr: stderr || undefined,
        }),
      );
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(
          new PythonPluginError({
            code: 'PROCESS_ERROR',
            message: `Python process for plugin "${pluginName}" exited with code ${code}`,
            pluginName,
            stderr: stderr || undefined,
            exitCode: code ?? undefined,
          }),
        );
        return;
      }

      if (!resultDocument) {
        reject(
          new PythonPluginError({
            code: 'INVALID_OUTPUT',
            message: `Python plugin "${pluginName}" stream ended without a result message`,
            pluginName,
            stderr: stderr || undefined,
          }),
        );
        return;
      }

      resolve(resultDocument);
    });

    proc.stdin.write(inputJson, 'utf-8');
    proc.stdin.end();
  });
}

export async function runPythonProcessor(
  scriptPath: string,
  document: Document,
  context: ExecutionContext,
  pluginName: string,
): Promise<Document> {
  const streaming = context.stream === true;

  const input: PythonProcessInput = {
    document,
    context: {
      runId: context.runId,
      workingDirectory: context.workingDirectory,
      stream: streaming,
    },
  };

  const inputJson = JSON.stringify(input);

  if (streaming) {
    return runStreaming(scriptPath, inputJson, context, pluginName);
  }

  return runBatch(scriptPath, inputJson, context, pluginName);
}
