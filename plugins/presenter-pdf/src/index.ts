/**
 * PDF presenter plugin.
 *
 * Converts the generated document's markdown content to a PDF file
 * using `md-to-pdf`. The PDF is written alongside the proposal output.
 *
 * Requires `md-to-pdf` and its Chromium dependency to be installed.
 * The system continues to work without this plugin — callers simply
 * omit `presenterName: 'presenter-pdf'` from PipelineRunOptions.
 *
 * Output path resolution (first match wins):
 *   1. Replace extension on `document.metadata.output_path`
 *   2. `config.outputDir` + `config.filename` (or `proposal.pdf`)
 *   3. `context.workingDirectory` + `proposal.pdf`
 */

import { mkdir } from 'node:fs/promises';
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
  const existingPath = document.metadata.output_path;
  if (typeof existingPath === 'string' && existingPath.length > 0) {
    const dir = path.dirname(existingPath);
    const base = path.basename(existingPath, path.extname(existingPath));
    return path.join(dir, `${base}.pdf`);
  }

  const outputDir =
    (config?.outputDir as string | undefined) ??
    context?.workingDirectory ??
    '.';
  const filename = (config?.filename as string | undefined) ?? 'proposal.pdf';
  return path.join(outputDir, filename);
}

const presenter = {
  name: 'presenter-pdf' as const,

  async present(
    data: unknown,
    config?: Readonly<Record<string, unknown>>,
    context?: ExecutionContext,
  ): Promise<Document> {
    const document = data as Document;
    const pdfPath = resolveOutputPath(document, config, context);

    await mkdir(path.dirname(pdfPath), { recursive: true });

    // Dynamic import keeps md-to-pdf out of the module graph for callers
    // that never use this presenter.
    const { mdToPdf } = await import('md-to-pdf');

    try {
      await mdToPdf({ content: document.content }, { dest: pdfPath });
    } catch (err) {
      throw new Error(
        `presenter-pdf: PDF generation failed — ${err instanceof Error ? err.message : String(err)}. ` +
          `Ensure md-to-pdf and its Chromium dependency are installed.`,
      );
    }

    context?.logger.info(`PDF written: ${pdfPath}`);

    return {
      ...document,
      metadata: { ...document.metadata, pdf_path: pdfPath },
    };
  },
};

export default presenter;
