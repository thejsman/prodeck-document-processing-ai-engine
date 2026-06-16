/**
 * CLI command: analyze-image
 *
 * Analyzes one or more images via Claude Vision and prints structured JSON metadata.
 * Pixel dimensions are detected in parallel from image file headers.
 *
 * Usage:
 *   ai-engine analyze-image --input <path|url> [--input ...]
 *   ai-engine analyze-image --input <base64> --type base64 --media-type image/png
 *
 * Options:
 *   --input <value>         Image file path, base64 string, or URL (repeatable)
 *   --type <type>           Input type: "path" (default), "base64", or "url"
 *   --media-type <mime>     MIME type for base64 inputs (default: image/jpeg)
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { env } from 'node:process';
import { AnalyzeImageTool, getImageDimensions } from '@ai-engine/tool-analyze-image';
import type { ImageInput, ImageMediaType, ImageAnalysisResult } from '@ai-engine/tool-analyze-image';

// ── Helpers ───────────────────────────────────────────────────────────────

const EXT_MEDIA_MAP: Record<string, ImageMediaType> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
};

function resolveMediaType(filePath: string): ImageMediaType {
  return EXT_MEDIA_MAP[extname(filePath).toLowerCase()] ?? 'image/jpeg';
}

async function resolveImage(img: ImageInput): Promise<ImageInput> {
  if (img.type !== 'path') return img;
  const buf = await readFile(img.value);
  return {
    type: 'base64',
    value: buf.toString('base64'),
    mediaType: img.mediaType ?? resolveMediaType(img.value),
  };
}

// ── Dimension detection from image headers ────────────────────────────────

async function detectDimensions(
  images: ImageInput[],
): Promise<Array<{ width: number; height: number } | null>> {
  return Promise.all(
    images.map(async (img) => {
      try {
        let buf: Buffer;
        if (img.type === 'path') {
          buf = await readFile(img.value);
        } else if (img.type === 'base64') {
          buf = Buffer.from(img.value, 'base64');
        } else {
          const res = await fetch(img.value, {
            headers: { Range: 'bytes=0-65535' },
            signal: AbortSignal.timeout(10_000),
          });
          buf = Buffer.from(await res.arrayBuffer());
        }
        return getImageDimensions(buf);
      } catch {
        return null;
      }
    }),
  );
}

// ── Claude Vision via fetch ───────────────────────────────────────────────

interface ClaudeResponse {
  content: Array<{ type: string; text?: string }>;
  error?: { message: string };
}

type ClaudeMetadata = Omit<import('@ai-engine/tool-analyze-image').ImageMetadata, 'dimensions'>;

async function callClaudeVision(
  images: ImageInput[],
  apiKey: string,
): Promise<ImageAnalysisResult[]> {
  const [resolved, dimensions] = await Promise.all([
    Promise.all(images.map(resolveImage)),
    detectDimensions(images),
  ]);

  const contentBlocks: unknown[] = [];
  for (const img of resolved) {
    if (img.type === 'base64') {
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType ?? 'image/jpeg', data: img.value },
      });
    } else {
      contentBlocks.push({
        type: 'image',
        source: { type: 'url', url: img.value },
      });
    }
  }

  const count = images.length;
  contentBlocks.push({
    type: 'text',
    text:
      `You are an image analysis service. Analyze the ${count} image(s) above in order.\n\n` +
      `For each image return a JSON object with exactly these fields:\n` +
      `- description (string): one-sentence description of what the image shows\n` +
      `- objects (string[]): key subjects or objects visible\n` +
      `- colors (string[]): dominant colors in plain English\n` +
      `- text (string): any readable text in the image, or "" if none\n` +
      `- format (string|null): image format hint from visual content (e.g. "jpeg", "png"), or null\n` +
      `- tags (string[]): descriptive keyword tags for search and categorization\n` +
      `- sentiment (string): overall mood conveyed (e.g. "professional", "joyful", "tense")\n\n` +
      `Respond with ONLY a valid JSON array of ${count} object(s), one per image, in the same order. ` +
      `No markdown, no explanation, no code fences — just the raw JSON array.`,
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: contentBlocks }],
    }),
  });

  const json = await res.json() as ClaudeResponse;
  if (!res.ok) {
    throw new Error(`Claude API error ${res.status}: ${json.error?.message ?? 'unknown'}`);
  }

  const textBlock = json.content.find((b) => b.type === 'text');
  if (!textBlock?.text) throw new Error('Claude returned no text content');

  const parsed = JSON.parse(textBlock.text) as ClaudeMetadata[];
  return parsed.map((metadata, index) => ({
    index,
    source: images[index].type,
    metadata: { ...metadata, dimensions: dimensions[index] ?? null },
  }));
}

// ── Argument parsing ──────────────────────────────────────────────────────

interface ParsedArgs {
  inputs: string[];
  type: ImageInput['type'];
  mediaType: ImageMediaType;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const inputs: string[] = [];
  let type: ImageInput['type'] = 'path';
  let mediaType: ImageMediaType = 'image/jpeg';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--input' || arg === '-i') && args[i + 1]) {
      inputs.push(args[++i]);
    } else if (arg === '--type' && args[i + 1]) {
      const t = args[++i];
      if (t !== 'path' && t !== 'base64' && t !== 'url') {
        throw new Error(`--type must be "path", "base64", or "url", got: ${t}`);
      }
      type = t;
    } else if (arg === '--media-type' && args[i + 1]) {
      mediaType = args[++i] as ImageMediaType;
    }
  }

  return { inputs, type, mediaType };
}

// ── Command entry point ───────────────────────────────────────────────────

export async function analyzeImage(args: readonly string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h' || args.length === 0) {
    process.stderr.write(
      'Usage: ai-engine analyze-image --input <path|url> [--input ...]\n\n' +
      'Options:\n' +
      '  --input <value>       Image file path, base64 string, or URL (repeatable)\n' +
      '  --type <type>         Input type: path (default), base64, url\n' +
      '  --media-type <mime>   MIME type for base64 inputs (default: image/jpeg)\n\n' +
      'Requires: ANTHROPIC_API_KEY environment variable\n',
    );
    return;
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    process.stderr.write('Error: ANTHROPIC_API_KEY environment variable is not set\n');
    process.exit(1);
  }

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(args);
  } catch (err: unknown) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  if (parsed.inputs.length === 0) {
    process.stderr.write('Error: at least one --input is required\n');
    process.exit(1);
  }

  const images: ImageInput[] = parsed.inputs.map((value) => ({
    type: parsed.type,
    value,
    ...(parsed.type === 'base64' ? { mediaType: parsed.mediaType } : {}),
  }));

  const tool = new AnalyzeImageTool({
    analyzeImageFn: (imgs) => callClaudeVision(imgs, apiKey),
  });

  const output = await tool.run({ metadata: { images } });
  process.stdout.write(JSON.stringify(output.json, null, 2) + '\n');
}
