import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { splitIntoWindows } from '../ingestion/document-preprocessor.js';

export type LLMGenerateFn = (prompt: string) => Promise<string>;

export interface ConvertedMemoryDoc {
  description: string;
  markdown: string;
}

const WINDOW_SIZE_WORDS = 5000;
const OVERLAP_WORDS = 500;
const MAX_WINDOWS = 5;

function safeParseJSON<T>(raw: string): T | null {
  const stripped = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function extractRawText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') {
    const { default: pdfParse } = await import('pdf-parse');
    const buf = await readFile(filePath);
    const parsed = await pdfParse(buf);
    return parsed.text;
  }
  return readFile(filePath, 'utf-8');
}

function buildPrompt(fileName: string, content: string): string {
  return `You are a document analyst. Read the following uploaded document and produce two things:
1. "description": a 1-3 sentence summary of what this document contains, specific enough that someone could judge its relevance to a topic without reading the full document.
2. "body": a comprehensive, well-formatted markdown rewrite of the document's meaningful content — organized with headings and bullet points, stripped of boilerplate/noise (page numbers, repeated headers/footers), but never omitting substantive facts, numbers, names, or requirements.

DOCUMENT: ${fileName}
---
${content}
---

Return ONLY valid JSON: { "description": "...", "body": "..." }`;
}

function fallback(fileName: string, content: string): ConvertedMemoryDoc {
  return {
    description: `Uploaded document: ${fileName}`,
    markdown: content.trim() ? `# ${fileName}\n\n${content.slice(0, 4000)}` : `# ${fileName}\n\n(No extractable text content.)`,
  };
}

/**
 * Converts one uploaded file into a clean, relevance-scannable markdown note.
 * Never throws — a failed extraction or LLM call falls back to a truncated
 * raw-text note so the memory pipeline always produces something.
 */
export async function convertUploadToMemoryDoc(
  fileName: string,
  filePath: string,
  generateFn: LLMGenerateFn,
): Promise<ConvertedMemoryDoc> {
  let content: string;
  try {
    content = await extractRawText(filePath);
  } catch {
    return fallback(fileName, '');
  }

  if (!content.trim()) return fallback(fileName, content);

  const windows = splitIntoWindows(content, WINDOW_SIZE_WORDS, OVERLAP_WORDS).slice(0, MAX_WINDOWS);

  const parts: { description: string; body: string }[] = [];
  for (const window of windows) {
    try {
      const raw = await generateFn(buildPrompt(fileName, window));
      const parsed = safeParseJSON<{ description?: string; body?: string }>(raw);
      if (parsed?.body) {
        parts.push({ description: parsed.description ?? '', body: parsed.body });
      }
    } catch {
      // skip this window — merge whatever succeeded
    }
  }

  if (parts.length === 0) return fallback(fileName, content);

  const description = parts[0].description || `Uploaded document: ${fileName}`;
  const markdown =
    parts.length === 1 ? parts[0].body : parts.map((p, i) => `## Part ${i + 1}\n\n${p.body}`).join('\n\n');

  return { description, markdown };
}
