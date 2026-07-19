#!/usr/bin/env node
// services/api/src/site-facts/cli.ts
//
// Standalone entrypoint: run the full site-facts pipeline against a single
// URL. See README.md in this directory for usage.

import { llmGenerateFn } from '../agent-routes.js';
import { extractSiteFacts } from './pipeline.js';

function parseArgs(argv: string[]): { url: string; workdir: string; maxPages?: number; maxDepth?: number } {
  const [url, ...rest] = argv;
  if (!url) {
    console.error('Usage: site-facts-extract <url> [--workdir <dir>] [--max-pages <n>] [--max-depth <n>]');
    process.exit(1);
  }

  let workdir = process.env.WORKDIR ?? './workdir';
  let maxPages: number | undefined;
  let maxDepth: number | undefined;

  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag === '--workdir' && value) {
      workdir = value;
      i += 1;
    } else if (flag === '--max-pages' && value) {
      maxPages = Number(value);
      i += 1;
    } else if (flag === '--max-depth' && value) {
      maxDepth = Number(value);
      i += 1;
    }
  }

  return { url, workdir, maxPages, maxDepth };
}

async function main(): Promise<void> {
  const { url, workdir, maxPages, maxDepth } = parseArgs(process.argv.slice(2));

  console.log(`[site-facts] crawling ${url} (workdir: ${workdir})`);

  const result = await extractSiteFacts(url, {
    workdir,
    generateFn: llmGenerateFn,
    maxPages,
    maxDepth,
    log: { warn: (obj: unknown, msg?: string) => console.warn(msg, obj) },
  });

  console.log(`[site-facts] done — ${result.pagesCrawled} pages crawled, ${result.factsCount} facts extracted`);
  console.log(`[site-facts] site_category: ${result.manifest.site_category}`);
  console.log(`[site-facts] output: ${result.outputDir}`);
}

main().catch((err) => {
  console.error('[site-facts] failed:', err);
  process.exit(1);
});
