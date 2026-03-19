/**
 * Markdown presenter plugin.
 *
 * Writes the generated document's markdown content to a `.md` file
 * alongside the proposal output.
 *
 * Output path resolution (first match wins):
 *   1. Replace extension on `document.metadata.output_path`
 *   2. `config.outputDir` + `config.filename` (or `proposal.md`)
 *   3. `context.workingDirectory` + `proposal.md`
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExecutionContext } from '@ai-engine/runtime';

interface Document {
  readonly type: string;
  readonly source: string;
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

function resolveOutputPath(
  document: Document,
  config?: Readonly<Record<string, unknown>>,
  context?: ExecutionContext,
): string {
  // 1. Derive from existing output_path in metadata
  const existingPath = document.metadata.output_path;
  if (typeof existingPath === 'string' && existingPath.length > 0) {
    const dir = path.dirname(existingPath);
    const base = path.basename(existingPath, path.extname(existingPath));
    return path.join(dir, `${base}.md`);
  }

  // 2. Use config.outputDir + filename
  const outputDir =
    (config?.outputDir as string | undefined) ??
    context?.workingDirectory ??
    '.';
  const filename = (config?.filename as string | undefined) ?? 'proposal.md';
  return path.join(outputDir, filename);
}

const presenter = {
  name: 'presenter-markdown' as const,

  async present(
    data: unknown,
    config?: Readonly<Record<string, unknown>>,
    context?: ExecutionContext,
  ): Promise<Document> {
    const document = data as Document;
    const mdPath = resolveOutputPath(document, config, context);

    await mkdir(path.dirname(mdPath), { recursive: true });
    await writeFile(mdPath, document.content, 'utf-8');

    context?.logger.info(`Markdown written: ${mdPath}`);

    return {
      ...document,
      metadata: { ...document.metadata, markdown_path: mdPath },
    };
  },
};

export default presenter;
