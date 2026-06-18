/**
 * CLI command: assets
 *
 * Manage the org-level Design Kit. Shares storage (@ai-engine/runtime OrgAssetStore)
 * with the API. Vision tagging requires ANTHROPIC_API_KEY (images only; the CLI
 * accepts .png/.jpg/.webp/.gif — .svg gets a default logo tagging without a vision call).
 *
 * Usage:
 *   ai-engine assets ingest <file...> [--workdir <path>]   Tag and add an asset
 *   ai-engine assets list [--workdir <path>]               List uploaded assets
 *   ai-engine assets rm <id> [--workdir <path>]            Remove an asset
 *   ai-engine assets primary <id> [--workdir <path>]       Mark an asset as primary
 *   ai-engine assets design-kit [--json] [--workdir <path>] Show the projected Design Kit
 *   ai-engine assets recompute [--workdir <path>]          Recompute the design kit
 *   ai-engine assets enable|disable [--workdir <path>]     Toggle injection at microsite generation
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from 'node:process';
import { OrgAssetStore, readOrgContextSettings, writeOrgContextSettings } from '@ai-engine/runtime';
import type { AssetMetadata } from '@ai-engine/core';

const HELP =
  'Usage: ai-engine assets <subcommand> [options]\n\n' +
  'Subcommands:\n' +
  '  ingest <file...>   Vision-tag and add brand assets (.png/.jpg/.webp/.gif/.svg)\n' +
  '  list               List uploaded assets and their status\n' +
  '  rm <id>            Remove an asset and recompute the design kit\n' +
  '  primary <id>       Mark an asset as primary for its type\n' +
  '  design-kit [--json] Show the projected Design Kit\n' +
  '  recompute          Rebuild the design kit from tagged assets\n' +
  '  enable | disable   Toggle Design Kit injection at microsite generation\n\n' +
  'Options:\n' +
  '  --workdir <path>   Working directory (default: cwd)\n' +
  '  --json             Print raw JSON instead of formatted output\n\n' +
  'Note: `ingest` requires ANTHROPIC_API_KEY.\n';

type AssetType = 'logo' | 'hero' | 'background' | 'palette' | 'typography' | 'inspiration' | 'other';

interface AssetTagging {
  assetType: AssetType;
  palette: string[];
  fontHints: string[];
  tags: string[];
  description: string;
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const VALID_TYPES: AssetType[] = ['logo', 'hero', 'background', 'palette', 'typography', 'inspiration', 'other'];

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const TAG_PROMPT =
  `You are a design-asset classification service.\n\n` +
  `Analyze the image and return a JSON object with exactly these fields:\n` +
  `- assetType (string): one of "logo", "hero", "background", "palette", "typography", "inspiration", "other"\n` +
  `- palette (string[]): dominant colors as HEX codes ONLY — format #RRGGBB. Return 2–6 colors.\n` +
  `- fontHints (string[]): typography style observations. Empty array if no text visible.\n` +
  `- tags (string[]): 3–8 descriptive keyword tags for brand character.\n` +
  `- description (string): one-sentence description.\n\n` +
  `Respond with ONLY a valid JSON object — no markdown, no code fences.`;

async function visionTag(filePath: string, mediaType: string): Promise<AssetTagging> {
  if (mediaType === 'image/svg+xml') {
    return { assetType: 'logo', palette: [], fontHints: [], tags: ['vector', 'logo'], description: 'SVG vector asset' };
  }
  const apiKey = env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const buf = await readFile(filePath);
  const base64 = buf.toString('base64');
  const visionType = mediaType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: visionType, data: base64 } },
        { type: 'text', text: TAG_PROMPT },
      ]}],
    }),
  });

  interface ClaudeResp { content?: Array<{ type: string; text?: string }>; error?: { message: string } }
  const json = await res.json() as ClaudeResp;
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${json.error?.message ?? 'unknown'}`);
  const text = json.content?.find((b) => b.type === 'text')?.text ?? '';
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  const raw = JSON.parse(start !== -1 && end !== -1 ? text.slice(start, end + 1) : text) as Partial<AssetTagging>;
  return {
    assetType: VALID_TYPES.includes(raw.assetType as AssetType) ? (raw.assetType as AssetType) : 'other',
    palette: (raw.palette ?? []).filter((c): c is string => typeof c === 'string' && HEX_RE.test(c)),
    fontHints: (raw.fontHints ?? []).filter((h): h is string => typeof h === 'string'),
    tags: (raw.tags ?? []).filter((t): t is string => typeof t === 'string'),
    description: typeof raw.description === 'string' ? raw.description : '',
  };
}

interface ParsedArgs { sub: string; positionals: string[]; workdir: string; json: boolean }

function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  let workdir = process.cwd();
  let json = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if ((a === '--workdir' || a === '-w') && args[i + 1]) { workdir = args[++i]; }
    else if (a === '--json') { json = true; }
    else if (!a.startsWith('-')) { positionals.push(a); }
  }
  return { sub: args[0] ?? '', positionals, workdir, json };
}

function printAsset(a: AssetMetadata): void {
  const swatches = a.palette.length ? `  palette: ${a.palette.join(' ')}` : '';
  process.stdout.write(`[${a.id.slice(0, 8)}] ${a.fileName} (${a.assetType}${a.isPrimary ? ', primary' : ''}) — ${a.status}${swatches ? '\n' + swatches : ''}\n`);
  if (a.description) process.stdout.write(`  ${a.description}\n`);
}

export async function assets(args: readonly string[]): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(HELP);
    return;
  }

  const { sub, positionals, workdir, json } = parseArgs(args);
  const store = new OrgAssetStore(workdir);

  switch (sub) {
    case 'ingest': {
      if (!positionals.length) { process.stderr.write('Usage: ai-engine assets ingest <file...>\n'); process.exit(1); }
      for (const filePath of positionals) {
        const ext = path.extname(filePath).toLowerCase();
        const mediaType = MIME[ext];
        if (!mediaType) { process.stderr.write(`Skipping ${filePath} — unsupported type (use .png/.jpg/.webp/.gif/.svg)\n`); continue; }
        const buf = await readFile(filePath);
        const fileName = path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_');
        process.stdout.write(`Uploading ${fileName}…\n`);
        const entry = await store.addUpload(fileName, mediaType, buf);
        process.stdout.write(`  → stored as ${entry.id.slice(0, 8)}\n`);
        process.stdout.write(`  Tagging via Claude Vision…\n`);
        try {
          const tagging = await visionTag(store.assetFilePath(fileName), mediaType);
          await store.saveTagging(entry.id, tagging);
          const kit = await store.recompute();
          process.stdout.write(`  → ${tagging.assetType}${tagging.palette.length ? `, palette: ${tagging.palette.join(' ')}` : ''}\n`);
          if (tagging.description) process.stdout.write(`  → ${tagging.description}\n`);
          if (kit.primaryColor) process.stdout.write(`  Design kit primary color: ${kit.primaryColor}\n`);
        } catch (err) {
          await store.updateStatus(entry.id, 'failed', (err as Error).message);
          process.stderr.write(`  Tagging failed: ${(err as Error).message}\n`);
        }
      }
      break;
    }

    case 'list': {
      const list = await store.listAssets();
      if (!list.length) { process.stdout.write('No assets uploaded yet.\n'); break; }
      for (const a of list) printAsset(a);
      break;
    }

    case 'rm': {
      const [id] = positionals;
      if (!id) { process.stderr.write('Usage: ai-engine assets rm <id>\n'); process.exit(1); }
      const list = await store.listAssets();
      const match = list.find((a) => a.id === id || a.id.startsWith(id));
      if (!match) { process.stderr.write(`No asset found with id ${id}\n`); process.exit(1); }
      await store.removeAsset(match.id);
      process.stdout.write(`Removed ${match.fileName} and recomputed design kit.\n`);
      break;
    }

    case 'primary': {
      const [id] = positionals;
      if (!id) { process.stderr.write('Usage: ai-engine assets primary <id>\n'); process.exit(1); }
      const list = await store.listAssets();
      const match = list.find((a) => a.id === id || a.id.startsWith(id));
      if (!match) { process.stderr.write(`No asset found with id ${id}\n`); process.exit(1); }
      await store.setPrimary(match.id, !match.isPrimary);
      await store.recompute();
      process.stdout.write(`${match.fileName} isPrimary → ${!match.isPrimary}\n`);
      break;
    }

    case 'design-kit': {
      const kit = await store.getDesignKit();
      if (!kit) { process.stdout.write('No design kit computed yet. Run `ai-engine assets ingest <file>` first.\n'); break; }
      if (json) { process.stdout.write(JSON.stringify(kit, null, 2) + '\n'); break; }
      process.stdout.write(`Design Kit (updated ${kit.updatedAt})\n`);
      process.stdout.write(`  Primary color: ${kit.primaryColor ?? 'none'}\n`);
      if (kit.palette.length) process.stdout.write(`  Palette: ${kit.palette.join('  ')}\n`);
      if (kit.fontHints.length) process.stdout.write(`  Typography: ${kit.fontHints.join(', ')}\n`);
      if (kit.designBrief) process.stdout.write(`  Brief: ${kit.designBrief}\n`);
      if (kit.logoAssetId) process.stdout.write(`  Logo asset: ${kit.logoAssetId.slice(0, 8)}\n`);
      if (kit.heroAssetId) process.stdout.write(`  Hero asset: ${kit.heroAssetId.slice(0, 8)}\n`);
      break;
    }

    case 'recompute': {
      const kit = await store.recompute();
      process.stdout.write(`Design kit recomputed. Primary color: ${kit.primaryColor ?? 'none'}\n`);
      break;
    }

    case 'enable':
    case 'disable': {
      const settings = await writeOrgContextSettings(workdir, { applyDesignKit: sub === 'enable' });
      process.stdout.write(`Design Kit injection ${settings.applyDesignKit ? 'enabled' : 'disabled'}.\n`);
      break;
    }

    default:
      process.stderr.write(`Unknown subcommand: ${sub}\n\n${HELP}`);
      process.exit(1);
  }
}
