/**
 * Adapter-side glue for the Author Voice extraction pass: load the document
 * text (PDF via pdf-parse, else utf-8), then delegate prompt-building, parsing,
 * and no-facts sanitization to the pure helpers in @ai-engine/core. The LLM
 * call is injected (DI) so this stays provider-agnostic.
 */

import { readFile } from 'node:fs/promises';
import { env } from 'node:process';
import { buildStylePrompt, buildVisionStylePrompt, parseStyleResponse } from '@ai-engine/core';
import type { ExtractedStyle } from '@ai-engine/core';

type VisionMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const VISION_MEDIA_TYPES = new Set<string>(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { message: string };
}

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

/**
 * Extract style from a proposal image (screenshot, slide, scanned page).
 * Makes a direct Anthropic vision call — same pattern as asset-tagger.ts.
 * The mediaType must be a Claude-supported image type (no SVG).
 */
export async function extractProposalStyleFromImage(
  filePath: string,
  mediaType: string,
): Promise<ExtractedStyle> {
  if (!VISION_MEDIA_TYPES.has(mediaType)) {
    throw new Error(`Unsupported image type for vision style extraction: ${mediaType}`);
  }

  const apiKey = env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const buf = await readFile(filePath);
  const base64 = buf.toString('base64');

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
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType as VisionMediaType, data: base64 } },
          { type: 'text', text: buildVisionStylePrompt() },
        ],
      }],
    }),
  });

  const json = await res.json() as ClaudeResponse;
  if (!res.ok) {
    throw new Error(`Claude vision API error ${res.status}: ${json.error?.message ?? 'unknown'}`);
  }

  const textBlock = json.content?.find((b) => b.type === 'text');
  if (!textBlock?.text) throw new Error('Claude returned no text from vision style call');

  return parseStyleResponse(textBlock.text);
}
