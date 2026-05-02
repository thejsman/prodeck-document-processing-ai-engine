/**
 * ImageFetchTool
 *
 * A side-effect tool that fetches images from Unsplash or generates them
 * with DALL-E 3. Side-effect functions are injected via constructor.
 *
 * Input metadata fields:
 *   - query (string)         — search query or DALL-E prompt
 *   - source ('unsplash' | 'dalle' | 'auto') — image source
 *   - sectionType (string)   — used to pick source when 'auto'
 *   - accentColor (string?)  — optional brand color hint for DALL-E prompts
 *
 * Output:
 *   - json: { url: string | null, source: 'unsplash' | 'dalle' | 'gradient' }
 */

import type { Tool, ToolInput, ToolOutput } from '@ai-engine/core';

export type FetchUnsplashFn = (query: string) => Promise<string | null>;
export type GenerateDalleFn = (prompt: string) => Promise<string | null>;
export type ResolveSourceFn = (
  sectionType: string,
  hasUnsplash: boolean,
  hasDalle: boolean,
) => 'unsplash' | 'dalle' | 'gradient';

export interface ImageFetchToolOptions {
  fetchUnsplash: FetchUnsplashFn;
  generateDalle: GenerateDalleFn;
  resolveSource: ResolveSourceFn;
  buildDallePromptFn: (sectionType: string, query: string, accentColor?: string) => string;
  hasUnsplashKey: boolean;
  hasDalleKey: boolean;
}

export class ImageFetchTool implements Tool {
  readonly name = 'image-fetch';
  readonly description =
    'Fetch a contextual image from Unsplash or generate one with DALL-E 3 for a microsite section.';

  constructor(private readonly opts: ImageFetchToolOptions) {}

  async run(input: ToolInput): Promise<ToolOutput> {
    const meta = input.metadata ?? {};
    const query = (meta['query'] as string | undefined)?.trim() ?? '';
    const sectionType = (meta['sectionType'] as string | undefined) ?? 'generic';
    const accentColor = meta['accentColor'] as string | undefined;
    const requestedSource = meta['source'] as string | undefined;

    if (!query) {
      return { json: { url: null, source: 'gradient' } };
    }

    let source: 'unsplash' | 'dalle' | 'gradient';
    if (requestedSource === 'unsplash' || requestedSource === 'dalle') {
      source = requestedSource;
    } else {
      source = this.opts.resolveSource(
        sectionType,
        this.opts.hasUnsplashKey,
        this.opts.hasDalleKey,
      );
    }

    if (source === 'gradient') {
      return { json: { url: null, source: 'gradient' } };
    }

    if (source === 'dalle') {
      const prompt = this.opts.buildDallePromptFn(sectionType, query, accentColor);
      const url = await this.opts.generateDalle(prompt);
      return { json: { url, source: 'dalle' } };
    }

    // unsplash
    const url = await this.opts.fetchUnsplash(query);
    return { json: { url, source: 'unsplash' } };
  }
}
