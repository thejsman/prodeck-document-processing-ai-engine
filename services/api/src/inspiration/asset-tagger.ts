/**
 * Vision tagging for design assets. Makes a tailored Anthropic vision call that
 * returns HEX palette, assetType, and font hints — fields the generic
 * AnalyzeImageTool doesn't return (it uses plain-English colors).
 *
 * Only called for image MIME types. Non-image assets get a default tagging.
 */

import { readFile } from 'node:fs/promises';
import type { AssetType, AssetMetadata } from '@ai-engine/core';
import { env } from 'node:process';

export interface AssetTagging {
  assetType: AssetType;
  palette: string[];       // HEX only, e.g. ['#1A2B3C']
  fontHints: string[];     // e.g. ['sans-serif', 'geometric headings']
  tags: string[];          // descriptive keyword tags
  description: string;     // one-sentence description
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);

const ASSET_TYPE_PROMPT =
  `You are a design-asset classification service.\n\n` +
  `Analyze the image and return a JSON object with exactly these fields:\n` +
  `- assetType (string): one of "logo", "hero", "background", "palette", "typography", "inspiration", "other"\n` +
  `- palette (string[]): dominant colors as HEX codes ONLY — format #RRGGBB. Return 2–6 colors. If you cannot determine exact HEX, omit rather than guess wrong.\n` +
  `- fontHints (string[]): typography style observations (e.g. "sans-serif", "bold headings", "geometric", "script accent"). Empty array if no text/type visible.\n` +
  `- tags (string[]): 3–8 descriptive keyword tags for brand character (e.g. "corporate", "minimalist", "warm", "tech").\n` +
  `- description (string): one-sentence description of what the image shows and its design purpose.\n\n` +
  `Respond with ONLY a valid JSON object — no markdown, no code fences, no explanation.`;

interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { message: string };
}

export async function tagDesignAsset(
  filePath: string,
  mediaType: string,
): Promise<AssetTagging> {
  if (!IMAGE_MIME.has(mediaType)) {
    return { assetType: 'other', palette: [], fontHints: [], tags: [], description: '' };
  }

  const apiKey = env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) {
    return { assetType: 'other', palette: [], fontHints: [], tags: [], description: 'No API key configured' };
  }

  const buf = await readFile(filePath);
  const base64 = buf.toString('base64');

  // SVG is not a supported vision media type — skip vision call
  if (mediaType === 'image/svg+xml') {
    return { assetType: 'logo', palette: [], fontHints: [], tags: ['vector', 'logo'], description: 'SVG vector asset' };
  }

  const visionMediaType = mediaType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: visionMediaType, data: base64 } },
          { type: 'text', text: ASSET_TYPE_PROMPT },
        ],
      }],
    }),
  });

  const json = await res.json() as ClaudeResponse;
  if (!res.ok) {
    throw new Error(`Claude vision API error ${res.status}: ${json.error?.message ?? 'unknown'}`);
  }

  const textBlock = json.content?.find((b) => b.type === 'text');
  if (!textBlock?.text) throw new Error('Claude returned no text from vision call');

  let parsed: Partial<AssetTagging>;
  try {
    const raw = textBlock.text.trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    parsed = JSON.parse(start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw) as Partial<AssetTagging>;
  } catch {
    throw new Error(`Claude vision returned non-JSON: ${textBlock.text.slice(0, 200)}`);
  }

  const validAssetTypes: AssetType[] = ['logo', 'hero', 'background', 'palette', 'typography', 'inspiration', 'other'];
  const assetType: AssetType = validAssetTypes.includes(parsed.assetType as AssetType)
    ? (parsed.assetType as AssetType)
    : 'other';

  // Strictly validate HEX — drop anything that doesn't match
  const palette = (parsed.palette ?? []).filter((c): c is string => typeof c === 'string' && HEX_RE.test(c));

  return {
    assetType,
    palette,
    fontHints: (parsed.fontHints ?? []).filter((h): h is string => typeof h === 'string' && h.trim().length > 0),
    tags: (parsed.tags ?? []).filter((t): t is string => typeof t === 'string' && t.trim().length > 0),
    description: typeof parsed.description === 'string' ? parsed.description : '',
  };
}
