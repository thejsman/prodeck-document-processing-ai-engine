/**
 * CLI command: voice
 *
 * Manage the org-level Author Voice learned from past proposals. Shares the
 * exact storage (@ai-engine/runtime OrgVoiceStore) and pure extraction prompt/
 * parser (@ai-engine/core) used by the API, so CLI and API stay consistent.
 *
 * Usage:
 *   ai-engine voice ingest <file...> [--workdir <path>]   Learn style from proposals (.md/.txt)
 *   ai-engine voice show [--json] [--workdir <path>]       Print the learned voice
 *   ai-engine voice list [--workdir <path>]                List ingested documents
 *   ai-engine voice recompute [--workdir <path>]           Rebuild the merged voice
 *   ai-engine voice rm <id> [--workdir <path>]             Remove a document
 *   ai-engine voice enable|disable [--workdir <path>]      Toggle injection at generation
 *
 * `ingest` requires ANTHROPIC_API_KEY. PDF proposals are supported via the
 * web UI / API (the CLI ingests .md/.txt to stay dependency-light).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from 'node:process';
import {
  OrgVoiceStore,
  readOrgContextSettings,
  writeOrgContextSettings,
} from '@ai-engine/runtime';
import {
  buildStylePrompt,
  parseStyleResponse,
  renderVoicePromptBlock,
} from '@ai-engine/core';
import type { VoiceStyleProfile } from '@ai-engine/core';

const HELP =
  'Usage: ai-engine voice <subcommand> [options]\n\n' +
  'Subcommands:\n' +
  '  ingest <file...>   Learn writing style from past proposals (.md/.txt)\n' +
  '  show [--json]      Print the learned Author Voice\n' +
  '  list               List ingested documents and their status\n' +
  '  recompute          Rebuild the merged voice from cached profiles\n' +
  '  rm <id>            Remove a document and recompute\n' +
  '  enable | disable   Toggle Author Voice injection at generation time\n\n' +
  'Options:\n' +
  '  --workdir <path>   Working directory (default: cwd)\n' +
  '  --json             (show) print raw JSON instead of the prompt block\n\n' +
  'Note: `ingest` requires ANTHROPIC_API_KEY. PDF proposals are ingested via the web UI / API.\n';

interface ParsedArgs {
  sub: string;
  positionals: string[];
  workdir: string;
  json: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  let workdir = process.cwd();
  let json = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--workdir') {
      i++;
      if (i >= args.length) throw new Error('--workdir requires a path');
      workdir = args[i];
    } else if (arg === '--json') {
      json = true;
    } else {
      positionals.push(arg);
    }
  }
  return { sub: args[0] ?? '', positionals, workdir: path.resolve(workdir), json };
}

interface ClaudeResponse {
  content: Array<{ type: string; text?: string }>;
  error?: { message: string };
}

async function callClaudeText(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const json = (await res.json()) as ClaudeResponse;
  if (!res.ok) {
    throw new Error(`Claude API error ${res.status}: ${json.error?.message ?? 'unknown'}`);
  }
  const textBlock = json.content.find((b) => b.type === 'text');
  if (!textBlock?.text) throw new Error('Claude returned no text content');
  return textBlock.text;
}

export async function voice(args: readonly string[]): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stderr.write(HELP);
    return;
  }

  const parsed = parseArgs(args);
  const store = new OrgVoiceStore(parsed.workdir);

  switch (parsed.sub) {
    case 'ingest': {
      const files = parsed.positionals;
      if (files.length === 0) {
        process.stderr.write('Error: at least one file is required\n');
        process.exit(1);
      }
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey?.trim()) {
        process.stderr.write('Error: ANTHROPIC_API_KEY environment variable is not set\n');
        process.exit(1);
      }
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (ext !== '.md' && ext !== '.txt') {
          process.stderr.write(`Skipping ${file}: CLI ingest supports .md/.txt (use the web UI for PDF)\n`);
          continue;
        }
        const safeName = path.basename(file).replace(/[^a-zA-Z0-9._-]/g, '_');
        const buffer = await readFile(file);
        const entry = await store.addUpload(safeName, buffer);
        try {
          const raw = await callClaudeText(buildStylePrompt(safeName, buffer.toString('utf-8')), apiKey);
          const style = parseStyleResponse(raw);
          const profile: VoiceStyleProfile = {
            id: entry.id,
            sourceDocument: safeName,
            uploadedAt: entry.uploadedAt,
            extractedAt: new Date().toISOString(),
            ...style,
          };
          await store.saveProfile(profile);
          await store.updateStatus(entry.id, 'extracted');
          process.stdout.write(`Learned style from ${safeName}\n`);
        } catch (err) {
          await store.updateStatus(entry.id, 'failed', (err as Error).message);
          process.stderr.write(`Failed to extract ${safeName}: ${(err as Error).message}\n`);
        }
      }
      const v = await store.recompute();
      process.stdout.write(`Author Voice updated (${v.docCount} document(s), version ${v.version}).\n`);
      return;
    }

    case 'show': {
      const v = await store.getVoice();
      if (!v || v.docCount === 0) {
        process.stdout.write('No Author Voice learned yet. Ingest past proposals first.\n');
        return;
      }
      if (parsed.json) {
        process.stdout.write(JSON.stringify(v, null, 2) + '\n');
      } else {
        process.stdout.write(renderVoicePromptBlock(v) + '\n');
      }
      return;
    }

    case 'list': {
      const docs = await store.listDocuments();
      if (docs.length === 0) {
        process.stdout.write('No documents ingested.\n');
        return;
      }
      for (const d of docs) {
        process.stdout.write(`${d.id}  ${d.status.padEnd(10)}  ${d.sourceDocument}\n`);
      }
      return;
    }

    case 'recompute': {
      const v = await store.recompute();
      process.stdout.write(`Recomputed Author Voice (${v.docCount} document(s), version ${v.version}).\n`);
      return;
    }

    case 'rm': {
      const id = parsed.positionals[0];
      if (!id) {
        process.stderr.write('Error: a document id is required (see `voice list`)\n');
        process.exit(1);
      }
      const v = await store.removeDocument(id);
      process.stdout.write(`Removed. Author Voice now has ${v.docCount} document(s).\n`);
      return;
    }

    case 'enable':
    case 'disable': {
      const applyAuthorVoice = parsed.sub === 'enable';
      await writeOrgContextSettings(parsed.workdir, { applyAuthorVoice });
      const settings = await readOrgContextSettings(parsed.workdir);
      process.stdout.write(`Author Voice injection ${settings.applyAuthorVoice ? 'enabled' : 'disabled'}.\n`);
      return;
    }

    default:
      process.stderr.write(`Unknown voice subcommand: ${parsed.sub}\n\n${HELP}`);
      process.exit(1);
  }
}
