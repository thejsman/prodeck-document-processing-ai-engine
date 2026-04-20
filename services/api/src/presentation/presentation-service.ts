/**
 * Presentation service — reads and writes presentation data.
 *
 * Storage layout:
 *   <workdir>/presentations/<namespace>/<proposalId>/config.json
 *   <workdir>/presentations/<namespace>/<proposalId>/site.json
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedSection } from './markdown-parser.js';
import { parseProposalMarkdown } from './markdown-parser.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PresentationConfig {
  readonly theme: 'light' | 'dark' | 'brand';
  readonly accentColor: string;
  readonly hiddenSections: readonly string[];
  readonly showPricing: boolean;
}

export interface PresentationSite {
  readonly sections: readonly ParsedSection[];
  readonly fileName: string;
  readonly createdAt: string;
}

export interface Presentation {
  readonly namespace: string;
  readonly proposalId: string;
  readonly fileName: string;
  readonly config: PresentationConfig;
  readonly sections: readonly ParsedSection[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PresentationConfig = {
  theme: 'light',
  accentColor: '#2563eb',
  hiddenSections: [],
  showPricing: true,
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function presentationDir(workdir: string, namespace: string, proposalId: string): string {
  return path.join(workdir, 'presentations', namespace, proposalId);
}

function configPath(workdir: string, namespace: string, proposalId: string): string {
  return path.join(presentationDir(workdir, namespace, proposalId), 'config.json');
}

function sitePath(workdir: string, namespace: string, proposalId: string): string {
  return path.join(presentationDir(workdir, namespace, proposalId), 'site.json');
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function listPresentations(
  workdir: string,
  namespace: string,
): Promise<Presentation[]> {
  const nsDir = path.join(workdir, 'presentations', namespace);
  let entries: string[];
  try {
    entries = await readdir(nsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const results: Presentation[] = [];
  for (const proposalId of entries) {
    try {
      const p = await getPresentation(workdir, namespace, proposalId);
      results.push(p);
    } catch {
      // skip malformed entries
    }
  }
  return results;
}

export async function getPresentation(
  workdir: string,
  namespace: string,
  proposalId: string,
): Promise<Presentation> {
  const [configRaw, siteRaw] = await Promise.all([
    readFile(configPath(workdir, namespace, proposalId), 'utf-8').catch((err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw Object.assign(new Error('Presentation not found'), { code: 'NOT_FOUND' });
      throw err;
    }),
    readFile(sitePath(workdir, namespace, proposalId), 'utf-8').catch((err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw Object.assign(new Error('Presentation not found'), { code: 'NOT_FOUND' });
      throw err;
    }),
  ]);

  const config = JSON.parse(configRaw) as PresentationConfig & { updatedAt?: string };
  let site = JSON.parse(siteRaw) as PresentationSite;

  // Auto-repair: if sections are empty, re-parse from the proposal markdown
  if (site.sections.length === 0 && site.fileName) {
    try {
      const mdPath = path.join(workdir, 'output', site.fileName);
      const markdown = await readFile(mdPath, 'utf-8');
      const parsed = parseProposalMarkdown(markdown);
      if (parsed.length > 0) {
        const repaired: PresentationSite & { updatedAt: string } = {
          ...site,
          sections: parsed,
          updatedAt: new Date().toISOString(),
        };
        await writeFile(sitePath(workdir, namespace, proposalId), JSON.stringify(repaired, null, 2), 'utf-8');
        site = repaired;
      }
    } catch {
      // Re-parse failed — return empty sections as-is
    }
  }

  return {
    namespace,
    proposalId,
    fileName: site.fileName,
    config: {
      theme: config.theme,
      accentColor: config.accentColor,
      hiddenSections: config.hiddenSections,
      showPricing: config.showPricing,
    },
    sections: site.sections,
    createdAt: site.createdAt,
    updatedAt: (config as { updatedAt?: string }).updatedAt ?? site.createdAt,
  };
}

export async function createPresentation(
  workdir: string,
  namespace: string,
  proposalId: string,
  fileName: string,
  sections: readonly ParsedSection[],
): Promise<Presentation> {
  const dir = presentationDir(workdir, namespace, proposalId);
  await mkdir(dir, { recursive: true });

  const now = new Date().toISOString();
  const configData = { ...DEFAULT_CONFIG, updatedAt: now };
  const siteData: PresentationSite & { updatedAt: string } = {
    sections: sections as ParsedSection[],
    fileName,
    createdAt: now,
    updatedAt: now,
  };

  await Promise.all([
    writeFile(configPath(workdir, namespace, proposalId), JSON.stringify(configData, null, 2), 'utf-8'),
    writeFile(sitePath(workdir, namespace, proposalId), JSON.stringify(siteData, null, 2), 'utf-8'),
  ]);

  return {
    namespace,
    proposalId,
    fileName,
    config: DEFAULT_CONFIG,
    sections,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Creates config.json + site.json for a presentation entry if they don't already
 * exist. Called by generate-stream so the entry is visible via listPresentations.
 */
export async function upsertPresentationEntry(
  workdir: string,
  namespace: string,
  proposalId: string,
  fileName: string,
  markdown?: string,
): Promise<void> {
  const dir = presentationDir(workdir, namespace, proposalId);
  await mkdir(dir, { recursive: true });

  const now = new Date().toISOString();

  const cPath = configPath(workdir, namespace, proposalId);
  try { await readFile(cPath, 'utf-8'); } catch {
    await writeFile(cPath, JSON.stringify({ ...DEFAULT_CONFIG, updatedAt: now }, null, 2), 'utf-8');
  }

  const sPath = sitePath(workdir, namespace, proposalId);
  try { await readFile(sPath, 'utf-8'); } catch {
    const sections = markdown ? parseProposalMarkdown(markdown) : [];
    await writeFile(sPath, JSON.stringify({ sections, fileName, createdAt: now, updatedAt: now }, null, 2), 'utf-8');
  }
}

export async function updateConfig(
  workdir: string,
  namespace: string,
  proposalId: string,
  config: PresentationConfig,
): Promise<Presentation> {
  const now = new Date().toISOString();
  const configData = { ...config, updatedAt: now };
  await writeFile(
    configPath(workdir, namespace, proposalId),
    JSON.stringify(configData, null, 2),
    'utf-8',
  );

  return getPresentation(workdir, namespace, proposalId);
}
