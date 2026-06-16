/**
 * analyze-image tool
 *
 * Analyzes one or more images via Claude Vision and returns structured metadata.
 *
 * Input (via ToolInput.metadata):
 *   images — Array<ImageInput> where each entry is a path, base64, or URL image.
 *            File paths must be resolved to base64 by the caller (API/CLI layer).
 *
 * Output:
 *   json — { results: ImageAnalysisResult[] }
 *
 * The `analyzeImageFn` is injected at construction time so core stays pure.
 */

import type { Tool, ToolInput, ToolOutput } from '@ai-engine/core';

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface ImageInput {
  /** How the image value should be interpreted. */
  type: 'path' | 'base64' | 'url';
  /** File system path, raw base64 string, or HTTP/S URL. */
  value: string;
  /** Required when type is 'base64'. Ignored for 'url'. */
  mediaType?: ImageMediaType;
}

export interface ImageMetadata {
  /** One-sentence natural language description of the image. */
  description: string;
  /** Key objects / subjects visible in the image. */
  objects: string[];
  /** Dominant colors (plain English names). */
  colors: string[];
  /** Any text readable in the image, or empty string if none. */
  text: string;
  /** Detected file format hint from content (e.g. "jpeg", "png"), or null if unknown. */
  format: string | null;
  /** Descriptive keyword tags useful for search and categorization. */
  tags: string[];
  /** Overall mood or sentiment conveyed (e.g. "professional", "joyful", "tense"). */
  sentiment: string;
  /** Pixel dimensions detected from image headers, or null if undetectable. */
  dimensions: { width: number; height: number } | null;
}

export interface ImageAnalysisResult {
  /** Zero-based position in the original input array. */
  index: number;
  /** Mirrors the `type` field of the corresponding ImageInput. */
  source: ImageInput['type'];
  metadata: ImageMetadata;
}

/**
 * Parse pixel dimensions from raw image bytes without any npm packages.
 * Supports PNG, JPEG, GIF87a/89a, and WebP (VP8, VP8L, VP8X sub-formats).
 * Returns null when the format is unrecognised or the buffer is too short.
 */
export function getImageDimensions(buf: Buffer): { width: number; height: number } | null {
  if (!buf || buf.length < 12) return null;

  // PNG — signature 89 50 4E 47, IHDR chunk at offset 8: width@16, height@20
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    if (buf.length < 24) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // JPEG — starts FF D8; scan for SOF markers (C0–CF except C4/C8/CC)
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const SOF_MARKERS = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ]);
    let offset = 2;
    while (offset + 3 < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      if (SOF_MARKERS.has(marker) && offset + 8 < buf.length) {
        return {
          height: buf.readUInt16BE(offset + 5),
          width: buf.readUInt16BE(offset + 7),
        };
      }
      const segLen = buf.readUInt16BE(offset + 2);
      offset += 2 + segLen;
    }
    return null;
  }

  // GIF — magic "GIF87a" or "GIF89a"; width@6 height@8 (little-endian 16-bit)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    if (buf.length < 10) return null;
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // WebP — magic "RIFF????WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    if (buf.length < 30) return null;
    const sub = buf.slice(12, 16).toString('ascii');
    if (sub === 'VP8 ' && buf.length >= 30) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (sub === 'VP8L' && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (sub === 'VP8X' && buf.length >= 30) {
      const w = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
      const h = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
      return { width: w, height: h };
    }
  }

  return null;
}

export interface AnalyzeImageConfig {
  /**
   * Calls Claude Vision to analyze a batch of images.
   * Injected by the CLI/API layer — all network and filesystem I/O lives there.
   * Path-type images must be resolved to base64 by the caller before passing here.
   */
  analyzeImageFn: (images: ImageInput[]) => Promise<ImageAnalysisResult[]>;
}

export class AnalyzeImageTool implements Tool {
  readonly name = 'analyze-image';
  readonly description =
    'Analyzes one or more images via Claude Vision. Returns structured metadata: description, objects, colors, visible text, tags, and sentiment.';

  private readonly analyzeImageFn: AnalyzeImageConfig['analyzeImageFn'];

  constructor(config: AnalyzeImageConfig) {
    this.analyzeImageFn = config.analyzeImageFn;
  }

  async run(input: ToolInput): Promise<ToolOutput> {
    const images = input.metadata?.['images'] as ImageInput[] | undefined;

    if (!Array.isArray(images) || images.length === 0) {
      throw new Error(
        'analyze-image tool requires metadata.images: Array<{ type: "path"|"base64"|"url", value: string, mediaType?: string }>',
      );
    }

    const results = await this.analyzeImageFn(images);
    return { json: { results } };
  }
}
