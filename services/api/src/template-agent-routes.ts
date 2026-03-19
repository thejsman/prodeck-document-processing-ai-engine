/**
 * Template agent route handlers — AI-assisted template generation and modification.
 *
 * Endpoints:
 *   POST /templates/generate  — generate a new YAML template from a prompt
 *   POST /templates/modify    — modify an existing YAML template from an instruction
 *
 * Both endpoints delegate to template_builder.py via stdin/stdout JSON protocol,
 * using the same LLM provider abstraction as the rest of the system.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ---------------------------------------------------------------------------
// Python bridge
// ---------------------------------------------------------------------------

// Compiled output is at services/api/dist/ → parent is services/api/
const SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'template_builder.py',
);

interface BuilderResult {
  result?: string;
  error?: string;
  type?: string;
}

function spawnTemplateBuilder(payload: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [SCRIPT_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn template builder: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        let message = `Template builder exited with code ${code}`;
        if (stderr) {
          try {
            const parsed = JSON.parse(stderr) as BuilderResult;
            message = parsed.error ?? message;
          } catch {
            message = stderr.trim() || message;
          }
        }
        reject(new Error(message));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as BuilderResult;
        if (parsed.error) {
          reject(new Error(parsed.error));
          return;
        }
        resolve(parsed.result ?? '');
      } catch {
        reject(new Error('Template builder returned invalid JSON'));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// YAML post-processing and validation
// ---------------------------------------------------------------------------

/** Strip markdown code fences the LLM may add around YAML output. */
function stripMarkdownFences(raw: string): string {
  return raw
    .replace(/^```(?:yaml)?\s*\n/i, '')
    .replace(/\n```\s*$/, '')
    .trim();
}

interface TemplateSection {
  title?: unknown;
  query?: unknown;
  instruction?: unknown;
}

interface ParsedTemplate {
  sections?: TemplateSection[];
}

function validateTemplateSections(raw: string): string {
  let parsed: ParsedTemplate;
  try {
    parsed = yaml.load(raw) as ParsedTemplate;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid YAML: ${msg}`);
  }

  if (!parsed || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    throw new Error('Generated template must have a non-empty "sections" array');
  }

  for (let i = 0; i < parsed.sections.length; i++) {
    const s = parsed.sections[i];
    if (!s.title || !s.query || !s.instruction) {
      throw new Error(
        `Section ${i + 1} must have "title", "query", and "instruction" fields`,
      );
    }
  }

  return raw;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerTemplateAgentRoutes(app: FastifyInstance): void {

  // POST /templates/generate
  app.post('/templates/generate', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { prompt?: unknown } | undefined;

    if (!body?.prompt || typeof body.prompt !== 'string' || !body.prompt.trim()) {
      return reply.code(400).send({ error: 'Missing required field: prompt' });
    }

    let rawYaml: string;
    try {
      rawYaml = await spawnTemplateBuilder({
        operation: 'generate',
        prompt: body.prompt.trim(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `LLM error: ${message}` });
    }

    const cleanYaml = stripMarkdownFences(rawYaml);

    try {
      validateTemplateSections(cleanYaml);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(422).send({ error: `Invalid template output: ${message}` });
    }

    return reply.send({ yaml: cleanYaml });
  });

  // POST /templates/modify
  app.post('/templates/modify', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      templateYaml?: unknown;
      instruction?: unknown;
    } | undefined;

    if (!body?.templateYaml || typeof body.templateYaml !== 'string' || !body.templateYaml.trim()) {
      return reply.code(400).send({ error: 'Missing required field: templateYaml' });
    }
    if (!body?.instruction || typeof body.instruction !== 'string' || !body.instruction.trim()) {
      return reply.code(400).send({ error: 'Missing required field: instruction' });
    }

    let rawYaml: string;
    try {
      rawYaml = await spawnTemplateBuilder({
        operation: 'modify',
        templateYaml: body.templateYaml.trim(),
        instruction: body.instruction.trim(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `LLM error: ${message}` });
    }

    const cleanYaml = stripMarkdownFences(rawYaml);

    try {
      validateTemplateSections(cleanYaml);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(422).send({ error: `Invalid template output: ${message}` });
    }

    return reply.send({ yaml: cleanYaml });
  });
}
