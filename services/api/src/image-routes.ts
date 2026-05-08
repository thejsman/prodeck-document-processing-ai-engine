/**
 * AI Image generation routes using OpenAI DALL-E API via fetch.
 * No additional npm package needed — calls OpenAI REST API directly.
 *
 * Routes:
 *   POST /images/generate        — single DALL-E 3 image generation
 *   POST /images/batch           — parallel multi-section Unsplash + DALL-E fetching
 */

import type { FastifyInstance } from 'fastify';
import { env } from 'node:process';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

interface DalleResponse {
  data: Array<{ url?: string; b64_json?: string }>;
  error?: { message: string };
}

interface GptImage1Response {
  data: Array<{ b64_json?: string }>;
  error?: { message: string };
}

// ── Source routing rules ──────────────────────────────────────────────────

type ImageSource = 'pexels' | 'unsplash' | 'dalle' | 'picsum' | 'gradient';

// Sections that render custom HTML and benefit from a real background/panel image
const VISUAL_SECTION_TYPES = new Set([
  'hero', 'showcase', 'overview', 'challenge', 'solution', 'approach',
  'features', 'feature-grid', 'feature-list', 'cta', 'problem-solution',
  'metrics', 'stats', 'case-study',
]);

/**
 * Determine the best image source for a section type.
 * Visual sections get DALL-E; data-heavy / structured sections use gradient.
 */
export function resolveImageSource(
  sectionType: string,
  hasUnsplashKey: boolean,
  hasDalleKey: boolean,
  hasPexelsKey: boolean = false,
): ImageSource {
  if (!VISUAL_SECTION_TYPES.has(sectionType)) return 'gradient';
  // Real photography beats AI generation — Pexels and Unsplash first
  if (hasPexelsKey) return 'pexels';
  if (hasUnsplashKey) return 'unsplash';
  if (hasDalleKey) return 'dalle';
  return 'picsum';
}

// ── Picsum helper (no API key, deterministic by seed) ────────────────────

export function buildPicsumUrl(query: string): string {
  const seed = query.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return `https://picsum.photos/seed/${seed || 'landscape'}/1920/1080`;
}

// ── Unsplash helper ───────────────────────────────────────────────────────

export async function fetchUnsplashImageUrl(query: string): Promise<string | null> {
  const key = env.UNSPLASH_ACCESS_KEY;
  if (!key?.trim()) return null;
  const words = query.trim().split(/\s+/);
  const candidates = [query, words.slice(0, 3).join(' '), words.slice(0, 2).join(' '), words[0]]
    .filter((q, i, arr) => q && arr.indexOf(q) === i);
  for (const q of candidates) {
    try {
      const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(q)}&orientation=landscape&client_id=${key}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const photo = await res.json() as { urls?: { regular?: string }; errors?: string[] };
      if (photo.errors?.length || !photo.urls?.regular) continue;
      return photo.urls.regular;
    } catch { continue; }
  }
  return null;
}

// ── Pexels helper (real photography, preferred over DALL-E) ─────────────────

interface PexelsResponse {
  photos?: Array<{ src?: { landscape?: string; original?: string } }>;
}

function sanitizeForPexels(raw: string): string {
  return raw
    // Strip DALL-E prompt prefixes
    .replace(/^dall-?e\s*\d*\s*prompt\s*:/i, '')
    .replace(/^dall-?e\s*\d*\s*:/i, '')
    // Strip cinematic/photography jargon phrases
    .replace(/cinematic\s+(photorealistic\s+)?scene\s+of\s+/i, '')
    .replace(/photorealistic\s+(scene\s+of\s+)?/i, '')
    .replace(/professional\s+photography[,.]?/gi, '')
    .replace(/\b(4k|8k|hdr|raw\s+photo|golden\s+hour|soft\s+(natural\s+)?lighting|warm\s+lighting|cinematic\s+lighting|depth.of.field|bokeh|ultra.realistic|hyperrealistic|sharp\s+focus|f\/[\d.]+)\b[,.]?/gi, '')
    .replace(/\b(capturing\s+the\s+essence\s+of|invoking\s+a\s+sense\s+of|joyful\s+expressions?|vibrant\s+colors?|inviting\s+atmosphere)\b[,.]?/gi, '')
    .trim()
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .replace(/\s{2,}/g, ' ');
}

export async function fetchPexelsImageUrl(query: string): Promise<string | null> {
  const key = env.PEXELS_API_KEY;
  if (!key?.trim()) return null;

  const clean = sanitizeForPexels(query);
  // Try progressively shorter queries to maximise match probability
  const words = clean.trim().split(/\s+/);
  const candidates = [
    clean,
    words.slice(0, 4).join(' '),
    words.slice(0, 2).join(' '),
    words[0],
  ].filter((q, i, arr) => q && arr.indexOf(q) === i);

  for (const q of candidates) {
    try {
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=5&orientation=landscape`;
      const res = await fetch(url, { headers: { Authorization: key } });
      if (!res.ok) continue;
      const data = await res.json() as PexelsResponse;
      const photos = data.photos ?? [];
      if (!photos.length) continue;
      // Pick a random photo from the first 5 so repeated sections look different
      const photo = photos[Math.floor(Math.random() * photos.length)];
      const src = photo.src?.landscape ?? photo.src?.original;
      if (src) return src;
    } catch { continue; }
  }
  return null;
}

// ── gpt-image-1 helper (primary) ──────────────────────────────────────────

export async function generateGptImage1(prompt: string): Promise<{ b64: string } | null> {
  const key = env.OPENAI_API_KEY;
  if (!key?.trim()) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: '1536x1024',
        quality: 'high',
      }),
    });
    const json = await res.json() as GptImage1Response;
    if (!res.ok) return null;
    const b64 = json.data[0]?.b64_json;
    return b64 ? { b64 } : null;
  } catch { return null; }
}

// ── DALL-E 3 helper (fallback) ────────────────────────────────────────────

export async function generateDalle3Image(prompt: string): Promise<string | null> {
  const key = env.OPENAI_API_KEY;
  if (!key?.trim()) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1792x1024',
        quality: 'standard',
        style: 'natural',
        response_format: 'url',
      }),
    });
    const json = await res.json() as DalleResponse;
    if (!res.ok) return null;
    return json.data[0]?.url ?? null;
  } catch { return null; }
}

/**
 * Build a DALL-E prompt for a section image.
 * Anchored to candid real-world photography — real people, authentic settings,
 * natural imperfections — to avoid the AI-generated / stock-photo look.
 */
export function buildDallePrompt(
  sectionType: string,
  imageQuery: string,
  accentColor?: string,
): string {
  const colorHint = accentColor ? `, tones suggest ${accentColor}` : '';
  // Technical photography anchors that force real-world documentary output
  const baseStyle = [
    'candid documentary photograph',
    'shot on Sony FX3 with 35mm f/1.4 lens',
    'natural ambient indoor or outdoor light',
    'authentic real-world environment with genuine imperfections',
    'real people in natural unposed moments',
    'shallow depth of field with sharp subject and softly blurred background',
    'no studio lighting',
    'no text overlaid',
    'no watermarks',
    'no illustrated or artistic style',
    '16:9 landscape frame',
  ].join(', ');

  const sectionStyle: Record<string, string> = {
    hero: [
      `Cinematic wide-angle candid scene. ${imageQuery}.`,
      `Real people naturally engaged in the activity, authentic environment with genuine background details.`,
      `Warm ambient light — golden hour or interior window light. ${baseStyle}${colorHint}`,
    ].join(' '),

    showcase: [
      `Detail-focused candid shot. ${imageQuery}.`,
      `Real person interacting naturally with a product or environment.`,
      `Soft background, sharp subject, window light or soft indoor ambient. ${baseStyle}${colorHint}`,
    ].join(' '),

    overview: [
      `Wide establishing shot of a real place. ${imageQuery}.`,
      `Genuine environment with authentic details — signage, objects, textures visible.`,
      `People naturally present in the background. ${baseStyle}${colorHint}`,
    ].join(' '),

    challenge: [
      `Candid documentary scene conveying a real-world problem or difficulty. ${imageQuery}.`,
      `Authentic unposed moment, overcast or low natural light, genuine tension or effort visible.`,
      `${baseStyle}${colorHint}`,
    ].join(' '),

    solution: [
      `Candid moment showing a real positive outcome. ${imageQuery}.`,
      `Genuine smile or satisfaction visible, bright natural light, authentic setting.`,
      `${baseStyle}${colorHint}`,
    ].join(' '),

    approach: [
      `Behind-the-scenes candid process shot. ${imageQuery}.`,
      `Real people working in an authentic environment — tools, workspace, or field visible.`,
      `Natural light from windows or outdoors. ${baseStyle}${colorHint}`,
    ].join(' '),

    features: [
      `Candid detail or action shot highlighting the subject in real use. ${imageQuery}.`,
      `Real hands or people interacting naturally, authentic context, window light.`,
      `${baseStyle}${colorHint}`,
    ].join(' '),

    'feature-grid': [
      `Overhead candid lifestyle shot. ${imageQuery}.`,
      `Real objects arranged naturally on a real surface — imperfect, lived-in look.`,
      `Natural window light from the side. ${baseStyle}${colorHint}`,
    ].join(' '),

    'feature-list': [
      `Candid environmental scene. ${imageQuery}.`,
      `Real person or environment in natural unposed context. ${baseStyle}${colorHint}`,
    ].join(' '),

    cta: [
      `Inspirational candid wide shot. ${imageQuery}.`,
      `Real person in a decisive or confident moment, authentic environment, bright natural light.`,
      `Negative space on one side for text. ${baseStyle}${colorHint}`,
    ].join(' '),

    'problem-solution': [
      `Documentary scene showing real-world context. ${imageQuery}.`,
      `Authentic setting, unposed subjects, natural light. ${baseStyle}${colorHint}`,
    ].join(' '),

    metrics: [
      `Wide candid scene conveying scale or collective impact. ${imageQuery}.`,
      `Real environment with many authentic background details. ${baseStyle}${colorHint}`,
    ].join(' '),

    stats: [
      `Real-world environment showing scale or significance. ${imageQuery}.`,
      `Candid wide shot, people naturally present. ${baseStyle}${colorHint}`,
    ].join(' '),

    'case-study': [
      `Candid documentary scene showing a real outcome or success moment. ${imageQuery}.`,
      `Authentic workplace or field environment, genuine expressions. ${baseStyle}${colorHint}`,
    ].join(' '),
  };

  return sectionStyle[sectionType] ?? `${imageQuery}. ${baseStyle}${colorHint}`;
}

// ── Persistent image download ─────────────────────────────────────────────

/**
 * Download a remote image URL to a local file path.
 * Returns true on success, false on failure (so callers can fall back to the raw URL).
 */
export async function downloadImageToFile(remoteUrl: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(remoteUrl);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, buf);
    return true;
  } catch { return false; }
}

export async function saveBase64ToFile(b64: string, destPath: string): Promise<boolean> {
  try {
    const buf = Buffer.from(b64, 'base64');
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, buf);
    return true;
  } catch { return false; }
}

// ── Route registration ────────────────────────────────────────────────────

export function registerImageRoutes(app: FastifyInstance, workdir?: string): void {
  // POST /images/generate — single DALL-E 3 image
  app.post('/images/generate', async (req, reply) => {
    const body = req.body as {
      prompt?: string;
      style?: string;
      keywords?: string[];
      sectionTitle?: string;
      namespace?: string;
      sectionId?: string;
    };

    const openaiKey = env.OPENAI_API_KEY;
    if (!openaiKey) {
      return reply.status(503).send({ error: 'OpenAI API key not configured' });
    }

    const { style = 'photo', keywords = [], sectionTitle = '' } = body;

    const styleMap: Record<string, string> = {
      illustration: 'flat vector illustration, clean digital art, vibrant colors',
      photo: 'professional photography, high quality, realistic, cinematic, 16:9',
      abstract: 'abstract digital art, geometric shapes, flowing gradients',
      '3d': '3D render, volumetric lighting, cinema 4D style, glossy materials',
      'line-art': 'minimalist line art, clean outlines, elegant black and white',
      custom: 'professional digital art',
    };

    const styleDesc = styleMap[style] ?? 'professional photography, cinematic, 16:9';
    const kwStr = keywords.length > 0 ? `, ${keywords.join(', ')}` : '';
    const basePrompt = body.prompt
      ? body.prompt
      : sectionTitle
        ? `Professional business presentation visual for "${sectionTitle}". ${styleDesc}${kwStr}. Beautiful, modern, no text or words.`
        : `Professional business concept art. ${styleDesc}${kwStr}. Beautiful, modern, no text or words.`;

    try {
      const result = await generateGptImage1(basePrompt);
      if (!result) {
        return reply.status(500).send({ error: 'No image returned from gpt-image-1' });
      }

      // Persist to local disk as a permanent file
      const namespace = body.namespace?.trim();
      const sectionId = body.sectionId?.trim();
      if (workdir && namespace && sectionId) {
        try {
          const hash = createHash('sha1').update(result.b64.slice(0, 64)).digest('hex').slice(0, 8);
          const filename = `${sectionId}-${hash}.png`;
          const destPath = join(workdir, 'assets', 'presentations', namespace, 'images', filename);
          const saved = await saveBase64ToFile(result.b64, destPath);
          if (saved) {
            return reply.send({ url: `/presentation-images/${namespace}/${filename}` });
          }
        } catch { /* fall through to data URI */ }
      }

      return reply.send({ url: `data:image/png;base64,${result.b64}` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: `Image generation failed: ${msg}` });
    }
  });

  // POST /images/batch — fetch images for multiple sections in parallel
  app.post('/images/batch', async (req, reply) => {
    const body = req.body as {
      namespace?: string;
      sections: Array<{
        id: string;
        sectionType: string;
        imageQuery: string;
        source?: 'unsplash' | 'dalle' | 'auto';
        accentColor?: string;
      }>;
    };

    if (!Array.isArray(body.sections) || body.sections.length === 0) {
      return reply.status(400).send({ error: 'sections array required' });
    }

    const hasUnsplash = !!(env.UNSPLASH_ACCESS_KEY?.trim());
    const hasDalle = !!(env.OPENAI_API_KEY?.trim());

    const results = await Promise.all(
      body.sections.map(async (sec) => {
        if (!sec.imageQuery?.trim()) {
          return { id: sec.id, url: null, source: 'gradient' as const };
        }

        const source = (sec.source === 'auto' || !sec.source)
          ? resolveImageSource(sec.sectionType, hasUnsplash, hasDalle)
          : sec.source;

        if (source === 'gradient') {
          return { id: sec.id, url: null, source: 'gradient' as const };
        }

        if (source === 'dalle') {
          const prompt = buildDallePrompt(sec.sectionType, sec.imageQuery, sec.accentColor);
          const result = await generateGptImage1(prompt);
          if (result) {
            if (workdir) {
              try {
                const ns = body.namespace?.trim() || 'batch';
                const hash = createHash('sha1').update(result.b64.slice(0, 64)).digest('hex').slice(0, 8);
                const filename = `${sec.id}-${hash}.png`;
                const destPath = join(workdir, 'assets', 'presentations', ns, 'images', filename);
                const saved = await saveBase64ToFile(result.b64, destPath);
                if (saved) return { id: sec.id, url: `/presentation-images/${ns}/${filename}`, source: 'dalle' as const };
              } catch { /* fall through to data URI */ }
            }
            return { id: sec.id, url: `data:image/png;base64,${result.b64}`, source: 'dalle' as const };
          }
          // fallback to DALL-E 3
          const dalleUrl = await generateDalle3Image(prompt);
          return { id: sec.id, url: dalleUrl, source: 'dalle' as const };
        }

        if (source === 'picsum') {
          return { id: sec.id, url: buildPicsumUrl(sec.imageQuery), source: 'picsum' as const };
        }

        // unsplash
        const url = await fetchUnsplashImageUrl(sec.imageQuery);
        return { id: sec.id, url, source: 'unsplash' as const };
      }),
    );

    return reply.send({ results });
  });
}
