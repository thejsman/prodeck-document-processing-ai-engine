// services/api/src/site-facts/store.ts
//
// Flat-file storage for the fact base (spec steps 5-6): facts.jsonl (one
// atomic fact per line), raw-pages.jsonl (the per-page deterministic
// extraction, kept separately so facts can be re-derived later without
// re-crawling), and site_manifest.json. Matches this repo's existing
// convention of write-to-temp-then-rename for atomicity.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Fact, RawPageExtraction, SiteManifest } from './types.js';

const FACTS_FILE = 'facts.jsonl';
const RAW_PAGES_FILE = 'raw-pages.jsonl';
const MANIFEST_FILE = 'site_manifest.json';

/** Directory name for a crawled site's output, derived from its hostname. */
export function siteOutputDir(root: string, siteUrl: string): string {
  const hostname = new URL(siteUrl).hostname.replace(/^www\./, '');
  const slug = hostname.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
  return path.join(root, slug);
}

async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, contents, 'utf-8');
  await rename(tmpPath, filePath);
}

function toJsonl<T>(items: T[]): string {
  return items.map((item) => JSON.stringify(item)).join('\n') + (items.length ? '\n' : '');
}

function fromJsonl<T>(raw: string): T[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export interface SiteFactsData {
  manifest: SiteManifest;
  facts: Fact[];
  rawPages: RawPageExtraction[];
}

export async function writeSiteFacts(outputDir: string, data: SiteFactsData): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeAtomic(path.join(outputDir, MANIFEST_FILE), JSON.stringify(data.manifest, null, 2)),
    writeAtomic(path.join(outputDir, FACTS_FILE), toJsonl(data.facts)),
    writeAtomic(path.join(outputDir, RAW_PAGES_FILE), toJsonl(data.rawPages)),
  ]);
}

export async function readManifest(outputDir: string): Promise<SiteManifest> {
  const raw = await readFile(path.join(outputDir, MANIFEST_FILE), 'utf-8');
  return JSON.parse(raw) as SiteManifest;
}

export async function readFacts(outputDir: string): Promise<Fact[]> {
  const raw = await readFile(path.join(outputDir, FACTS_FILE), 'utf-8');
  return fromJsonl<Fact>(raw);
}

export async function readRawPages(outputDir: string): Promise<RawPageExtraction[]> {
  const raw = await readFile(path.join(outputDir, RAW_PAGES_FILE), 'utf-8');
  return fromJsonl<RawPageExtraction>(raw);
}
