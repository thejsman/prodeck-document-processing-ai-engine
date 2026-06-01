/**
 * proposal-section-agent
 *
 * Regenerates a single named section of a proposal document.
 *
 * Input metadata:
 *   proposalMarkdown  — full current proposal content (for context)
 *   sectionName       — the ## heading of the section to rewrite
 *   instruction       — rewriting instruction (e.g. "make it shorter")
 *
 * Output:
 *   markdown — the regenerated section (including ## heading)
 *
 * Uses the extract-section tool (if available) to isolate the target
 * section before sending it to the LLM for rewriting.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Agent, AgentInput, AgentOutput } from '@ai-engine/core';

// section_rewriter.py lives next to this compiled output directory
const SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'section_rewriter.py',
);

interface RewriterPayload {
  proposalMarkdown: string;
  sectionName: string;
  instruction: string;
  existingSection: string;
}

interface RewriterResult {
  result?: string;
  error?: string;
  type?: string;
}

const PYTHON_BIN = process.env['PYTHON'] ?? 'python3';

function spawnSectionRewriter(payload: RewriterPayload): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [SCRIPT_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn section_rewriter: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        let message = `section_rewriter exited with code ${code}`;
        if (stderr) {
          try {
            const parsed = JSON.parse(stderr) as RewriterResult;
            message = parsed.error ?? message;
          } catch {
            message = stderr.trim() || message;
          }
        }
        reject(new Error(message));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as RewriterResult;
        if (parsed.error) {
          reject(new Error(parsed.error));
          return;
        }
        resolve(parsed.result ?? '');
      } catch {
        reject(new Error('section_rewriter returned invalid JSON'));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export class ProposalSectionAgent implements Agent {
  readonly name = 'proposal-section';
  readonly description =
    'Regenerates a single named section of a proposal document using LLM rewriting.';

  async run(input: AgentInput): Promise<AgentOutput> {
    const meta = input.metadata ?? {};
    const proposalMarkdown = (meta.proposalMarkdown as string | undefined) ?? '';
    const sectionName = meta.sectionName as string | undefined;
    const instruction =
      (meta.instruction as string | undefined) ??
      'Rewrite this section to be clear, concise, and professional.';

    if (!sectionName) {
      throw new Error(
        'proposal-section agent requires metadata.sectionName',
      );
    }

    // Use extract-section tool if available to isolate the section
    let existingSection = '';
    if (input.tools?.has('extract-section')) {
      const extractTool = input.tools.get('extract-section');
      const extracted = await extractTool.run({
        content: proposalMarkdown,
        metadata: { sectionName },
      });
      existingSection = extracted.text ?? '';
    }

    const markdown = await spawnSectionRewriter({
      proposalMarkdown,
      sectionName,
      instruction,
      existingSection,
    });

    return { markdown };
  }
}
