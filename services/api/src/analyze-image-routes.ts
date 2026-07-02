/**
 * Image metadata analysis routes using Claude Vision API.
 *
 * Routes:
 *   POST /images/analyze — analyze one or more images and return structured metadata
 *
 * Accepts images as file paths (resolved to base64 here), base64 strings, or URLs.
 * Delegates to Claude Vision (claude-sonnet-4-6) via the Anthropic Messages API.
 * All images in a single request are batched into one Claude API call.
 * Pixel dimensions are detected in parallel from image headers (no extra npm packages).
 */

import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { env } from 'node:process';
import { AnalyzeImageTool, getImageDimensions } from '@ai-engine/tool-analyze-image';
import type { ImageInput, ImageMediaType, ImageAnalysisResult, ImageMetadata } from '@ai-engine/tool-analyze-image';

// ── Claude Vision API types ───────────────────────────────────────────────

interface ClaudeImageSourceBase64 {
  type: 'base64';
  media_type: ImageMediaType;
  data: string;
}

interface ClaudeImageSourceUrl {
  type: 'url';
  url: string;
}

interface ClaudeContentBlockImage {
  type: 'image';
  source: ClaudeImageSourceBase64 | ClaudeImageSourceUrl;
}

interface ClaudeContentBlockText {
  type: 'text';
  text: string;
}

interface ClaudeMessagesRequest {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: 'user';
    content: Array<ClaudeContentBlockImage | ClaudeContentBlockText>;
  }>;
}

interface ClaudeMessagesResponse {
  content: Array<{ type: string; text?: string }>;
  error?: { message: string };
}

// ── Media type detection from file extension ──────────────────────────────

const EXT_TO_MEDIA_TYPE: Record<string, ImageMediaType> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
};

function detectMediaType(filePath: string): ImageMediaType {
  return EXT_TO_MEDIA_TYPE[extname(filePath).toLowerCase()] ?? 'image/jpeg';
}

// ── Resolve path images to base64 before calling Claude ──────────────────

async function resolveImages(inputs: ImageInput[]): Promise<ImageInput[]> {
  return Promise.all(
    inputs.map(async (img) => {
      if (img.type !== 'path') return img;
      const buf = await readFile(img.value);
      return {
        type: 'base64' as const,
        value: buf.toString('base64'),
        mediaType: img.mediaType ?? detectMediaType(img.value),
      };
    }),
  );
}

// ── Parallel dimension detection from image headers ───────────────────────

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
          // URL — fetch only the first 64 KB (enough for all format headers)
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

// ── Build Claude content blocks for the vision request ───────────────────

function buildContentBlocks(
  images: ImageInput[],
): Array<ClaudeContentBlockImage | ClaudeContentBlockText> {
  const blocks: Array<ClaudeContentBlockImage | ClaudeContentBlockText> = [];

  for (const img of images) {
    if (img.type === 'base64') {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType ?? 'image/jpeg',
          data: img.value,
        },
      });
    } else if (img.type === 'url') {
      blocks.push({
        type: 'image',
        source: { type: 'url', url: img.value },
      });
    }
  }

  const count = images.length;
  const prompt =
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
    `No markdown, no explanation, no code fences — just the raw JSON array.`;

  blocks.push({ type: 'text', text: prompt });
  return blocks;
}

// ── Claude Vision + parallel dimension detection ──────────────────────────

type ClaudeMetadata = Omit<ImageMetadata, 'dimensions'>;

async function callClaudeVision(
  images: ImageInput[],
  apiKey: string,
): Promise<ImageAnalysisResult[]> {
  const [resolved, dimensions] = await Promise.all([
    resolveImages(images),
    detectDimensions(images),
  ]);

  const requestBody: ClaudeMessagesRequest = {
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: buildContentBlocks(resolved) }],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });

  const json = await res.json() as ClaudeMessagesResponse;

  if (!res.ok) {
    throw new Error(`Claude API error ${res.status}: ${json.error?.message ?? 'unknown error'}`);
  }

  const textBlock = json.content.find((b) => b.type === 'text');
  if (!textBlock?.text) throw new Error('Claude returned no text content');

  let parsed: ClaudeMetadata[];
  try {
    parsed = JSON.parse(textBlock.text) as ClaudeMetadata[];
  } catch {
    throw new Error(`Claude returned non-JSON response: ${textBlock.text.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed) || parsed.length !== images.length) {
    throw new Error(
      `Claude returned ${Array.isArray(parsed) ? parsed.length : 'non-array'} results for ${images.length} image(s)`,
    );
  }

  return parsed.map((metadata, index) => ({
    index,
    source: images[index].type,
    metadata: { ...metadata, dimensions: dimensions[index] ?? null },
  }));
}

// ── Input validation ──────────────────────────────────────────────────────

function validateImageInputs(raw: unknown): ImageInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw Object.assign(new Error('images must be a non-empty array'), { statusCode: 400 });
  }
  if (raw.length > 20) {
    throw Object.assign(new Error('Maximum 20 images per request'), { statusCode: 400 });
  }

  return raw.map((item: unknown, i: number) => {
    if (typeof item !== 'object' || item === null) {
      throw Object.assign(new Error(`images[${i}] must be an object`), { statusCode: 400 });
    }
    const obj = item as Record<string, unknown>;
    const type = obj['type'];
    const value = obj['value'];

    if (type !== 'path' && type !== 'base64' && type !== 'url') {
      throw Object.assign(
        new Error(`images[${i}].type must be "path", "base64", or "url"`),
        { statusCode: 400 },
      );
    }
    if (typeof value !== 'string' || !value.trim()) {
      throw Object.assign(new Error(`images[${i}].value must be a non-empty string`), { statusCode: 400 });
    }

    const entry: ImageInput = { type, value };
    if (obj['mediaType']) entry.mediaType = obj['mediaType'] as ImageMediaType;
    return entry;
  });
}

// ── Route registration ────────────────────────────────────────────────────

export function registerAnalyzeImageRoutes(app: FastifyInstance): void {
  /**
   * POST /images/analyze
   *
   * Body: { images: Array<{ type: "path"|"base64"|"url", value: string, mediaType?: string }> }
   *
   * Returns: { results: ImageAnalysisResult[] }
   *   Each result includes metadata.dimensions: { width, height } | null
   *   detected in parallel from image file headers (no Claude required for this field).
   */
  app.post('/images/analyze', async (req, reply) => {
    const anthropicKey = env.ANTHROPIC_API_KEY;
    if (!anthropicKey?.trim()) {
      return reply.status(503).send({ error: 'ANTHROPIC_API_KEY is not configured' });
    }

    const body = req.body as Record<string, unknown> | undefined;

    let images: ImageInput[];
    try {
      images = validateImageInputs(body?.['images']);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as { statusCode?: number }).statusCode ?? 400;
      return reply.status(code).send({ error: msg });
    }

    const tool = new AnalyzeImageTool({
      analyzeImageFn: (imgs) => callClaudeVision(imgs, anthropicKey),
    });

    try {
      const output = await tool.run({ metadata: { images } });
      return reply.send(output.json);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('non-JSON') || msg.includes('results for')) {
        return reply.status(422).send({ error: `Unexpected Claude response: ${msg}` });
      }
      return reply.status(500).send({ error: `Image analysis failed: ${msg}` });
    }
  });
}
