/**
 * AI Image generation routes using OpenAI DALL-E API via fetch.
 * No additional npm package needed — calls OpenAI REST API directly.
 */

import type { FastifyInstance } from 'fastify';

interface DalleResponse {
  data: Array<{ url?: string; b64_json?: string }>;
  error?: { message: string };
}

export function registerImageRoutes(app: FastifyInstance): void {
  app.post('/images/generate', async (req, reply) => {
    const body = req.body as {
      prompt?: string;
      style?: string;
      keywords?: string[];
      sectionTitle?: string;
    };

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return reply.status(503).send({ error: 'OpenAI API key not configured' });
    }

    const { style = 'illustration', keywords = [], sectionTitle = '' } = body;

    const styleMap: Record<string, string> = {
      illustration: 'flat vector illustration, clean digital art, vibrant colors',
      photo: 'professional photography, high quality, realistic, cinematic',
      abstract: 'abstract digital art, geometric shapes, flowing gradients',
      '3d': '3D render, volumetric lighting, cinema 4D style, glossy materials',
      'line-art': 'minimalist line art, clean outlines, elegant black and white',
      custom: 'professional digital art',
    };

    const styleDesc = styleMap[style] ?? 'professional digital art';
    const kwStr = keywords.length > 0 ? `, ${keywords.join(', ')}` : '';
    const basePrompt = body.prompt
      ? body.prompt
      : sectionTitle
        ? `Professional business presentation visual for "${sectionTitle}". ${styleDesc}${kwStr}. Beautiful, modern, no text or words.`
        : `Professional business concept art. ${styleDesc}${kwStr}. Beautiful, modern, no text or words.`;

    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'dall-e-2',
          prompt: basePrompt,
          n: 1,
          size: '512x512',
          response_format: 'b64_json',
        }),
      });

      const json = (await res.json()) as DalleResponse;

      if (!res.ok) {
        return reply.status(res.status).send({ error: json.error?.message ?? `OpenAI error ${res.status}` });
      }

      const b64 = json.data[0]?.b64_json;
      if (!b64) {
        return reply.status(500).send({ error: 'No image data returned' });
      }

      return reply.send({ url: `data:image/png;base64,${b64}` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: `Image generation failed: ${msg}` });
    }
  });
}
