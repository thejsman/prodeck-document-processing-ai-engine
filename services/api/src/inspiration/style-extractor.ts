/**
 * Adapter-side glue for the Author Voice extraction pass: load the document
 * text (PDF via pdf-parse, else utf-8), then delegate prompt-building, parsing,
 * and no-facts sanitization to the pure helpers in @ai-engine/core. The LLM
 * call is injected (DI) so this stays provider-agnostic.
 */

import { readFile } from 'node:fs/promises';
import { buildStylePrompt, parseStyleResponse } from '@ai-engine/core';
import type { ExtractedStyle } from '@ai-engine/core';

async function loadText(filePath: string, fileName: string): Promise<string> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) {
    const { default: pdfParse } = (await import('pdf-parse')) as {
      default: (buf: Buffer) => Promise<{ text: string }>;
    };
    const buf = await readFile(filePath);
    return (await pdfParse(buf)).text;
  }
  if (lower.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const buf = await readFile(filePath);
    return (await mammoth.extractRawText({ buffer: buf })).value;
  }
  return readFile(filePath, 'utf-8');
}

export async function extractProposalStyle(
  filePath: string,
  fileName: string,
  generate: (prompt: string) => Promise<string>,
): Promise<ExtractedStyle> {
  const text = await loadText(filePath, fileName);
  const raw = await generate(buildStylePrompt(fileName, text));
  return parseStyleResponse(raw);
}
