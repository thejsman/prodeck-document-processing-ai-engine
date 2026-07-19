// services/api/src/site-facts/design/design-doc.service.ts
//
// Design system document generator — tokens + layout-vision. The LLM writes
// prose citing measured tokens [T:token.path] and vision observations
// [S:screenshot-id]; invalid citations are stripped; Responsive Behavior,
// the embedded token JSON, and Sources are all assembled deterministically
// by code, never by the model. This is the single file this module
// produces — no separate tokens/vision files.

import type { GenerateFn } from '@ai-engine/planner';
import { flattenTokenPaths } from './dtcg.js';
import type { CapturedScreenshot, DtcgDocument, VisionAnalysis } from './types.js';

/**
 * The design-doc prompt. Exported as a constant so it can be reviewed and
 * tuned independently of the calling code.
 */
export const DESIGN_DOC_PROMPT_TEMPLATE = `You are writing a design system document for a website. You must work ONLY from the measured design tokens and visual observations below — every factual claim must be traceable to a token, cited as [T:token.path] (e.g. [T:color.primary]), or a screenshot observation, cited as [S:screenshot-id] (e.g. [S:homepage-desktop]). Do not use outside knowledge, do not invent values, and do not fill in scale steps or layout patterns the site does not demonstrate.

Rules (follow exactly):
1. Every sentence that makes a factual claim must end with one or more inline citations like [T:font.size.600] or [S:crop-header].
2. Do NOT give design recommendations, critiques, or improvement suggestions — this documents what exists, not a redesign.
3. If a section has no supporting data, write a single line: "Not established by the measured tokens." Do not pad with speculation.
4. Follow the document outline below exactly, using ## for section headers.
5. Do NOT write a Responsive Behavior, Design Tokens, or Sources section — those are appended automatically.
6. Write in clear, professional prose befitting a design system reference. No hype.

Document outline:
# {{SITE_NAME}} — Design System

## Brand Overview & Visual Character
## Color Palette
## Typography
## Spacing & Layout Grid
## Elevation & Radius
## Component Patterns

Measured design tokens (cite as [T:path]):
{{TOKENS}}

Visual observations from screenshots (cite as [S:id]):
{{VISION}}

Return ONLY the markdown document, starting with the # title line. No preamble, no code fences.`;

function renderTokenLines(doc: DtcgDocument): string {
  return flattenTokenPaths(doc)
    .map((t) => {
      const ext = t.extensions ?? {};
      const notes: string[] = [];
      if (typeof ext.cluster_size === 'number') notes.push(`${ext.cluster_size} observations`);
      if (typeof ext.count === 'number') notes.push(`count ${ext.count}`);
      if (Array.isArray(ext.used_by) && ext.used_by.length > 0) notes.push(`used by: ${(ext.used_by as string[]).join(', ')}`);
      const value = Array.isArray(t.value) ? (t.value as unknown[]).join(', ') : String(t.value);
      return `[T:${t.path}] ${value}${notes.length ? ` (${notes.join('; ')})` : ''}`;
    })
    .join('\n');
}

function renderVisionLines(vision: VisionAnalysis | null): string {
  if (!vision || vision.screenshots.length === 0) {
    return '(no visual analysis available — write Component Patterns and Imagery & Iconography Style as "Not established by the measured tokens.")';
  }
  const lines: string[] = [];
  const merged = vision.merged;
  for (const adj of merged.adjectives) {
    lines.push(`${adj.seen_in.map((id) => `[S:${id}]`).join('')} style adjective: ${adj.term}`);
  }
  for (const entry of merged.component_inventory) {
    for (const d of entry.descriptions) {
      lines.push(`[S:${d.screenshot_id}] ${entry.component}: ${d.text}`);
    }
  }
  for (const note of merged.layout_notes) lines.push(`[S:${note.screenshot_id}] layout: ${note.text}`);
  return lines.join('\n');
}

export function buildDesignDocPrompt(siteName: string, tokens: DtcgDocument, vision: VisionAnalysis | null): string {
  return DESIGN_DOC_PROMPT_TEMPLATE.replace('{{SITE_NAME}}', siteName)
    .replace('{{TOKENS}}', renderTokenLines(tokens))
    .replace('{{VISION}}', renderVisionLines(vision));
}

const CITATION_REGEX = /\[(T|S):([a-zA-Z0-9._-]+)\]/g;

/** Strip citations pointing at unknown tokens/screenshots; collect valid ones. */
export function processDesignCitations(
  body: string,
  validTokenPaths: Set<string>,
  validScreenshotIds: Set<string>,
): { body: string; citedTokens: string[]; citedShots: string[] } {
  const citedTokens = new Set<string>();
  const citedShots = new Set<string>();
  const cleaned = body.replace(CITATION_REGEX, (match, kind: string, id: string) => {
    if (kind === 'T' && validTokenPaths.has(id)) {
      citedTokens.add(id);
      return match;
    }
    if (kind === 'S' && validScreenshotIds.has(id)) {
      citedShots.add(id);
      return match;
    }
    return '';
  });
  return { body: cleaned, citedTokens: [...citedTokens].sort(), citedShots: [...citedShots].sort() };
}

function buildResponsiveBehaviorSection(doc: DtcgDocument): string {
  const flat = flattenTokenPaths(doc);
  const mobile = flat.find((t) => t.path === 'breakpoints.mobile');
  const desktop = flat.find((t) => t.path === 'breakpoints.desktop');
  if (!mobile || !desktop) return '## Responsive Behavior\n\nNot established by the measured tokens.';
  return `## Responsive Behavior\n\nComputed styles were measured at three viewports: mobile, tablet, and desktop, anchored at ${mobile.value} [T:breakpoints.mobile] and ${desktop.value} [T:breakpoints.desktop]. This document's tokens are aggregated across all measured viewports — no further per-viewport layout differences are claimed beyond what the Component Patterns section observes directly from screenshots.`;
}

function buildTokensJsonSection(doc: DtcgDocument): string {
  return `## Design Tokens (JSON)\n\n\`\`\`json\n${JSON.stringify(doc, null, 2)}\n\`\`\``;
}

/**
 * Deterministic Sources section: every cited token with its measured value +
 * observation count, and cited screenshots by id/page/viewport (no file
 * path — screenshots are never persisted to disk). Falls back to listing
 * everything if the model cited nothing, so the doc is never unauditable.
 */
export function buildDesignSourcesSection(
  citedTokens: string[],
  citedShots: string[],
  doc: DtcgDocument,
  screenshots: CapturedScreenshot[],
): string {
  const flat = new Map(flattenTokenPaths(doc).map((t) => [t.path, t]));
  const tokenPaths = citedTokens.length > 0 ? citedTokens : [...flat.keys()];
  const shotIds = citedShots.length > 0 ? citedShots : screenshots.map((s) => s.id);

  const lines: string[] = ['## Sources', '', '### Measured tokens'];
  for (const path of tokenPaths) {
    const token = flat.get(path);
    if (!token) continue;
    const value = Array.isArray(token.value) ? (token.value as unknown[]).join(', ') : String(token.value);
    const ext = token.extensions ?? {};
    const detail =
      typeof ext.cluster_size === 'number'
        ? ` — ${ext.cluster_size} observations`
        : typeof ext.count === 'number'
          ? ` — count ${ext.count}`
          : '';
    lines.push(`- [T:${path}] ${value}${detail}`);
  }

  const shotById = new Map(screenshots.map((s) => [s.id, s]));
  const shotLines = shotIds.filter((id) => shotById.has(id));
  if (shotLines.length > 0) {
    lines.push('', '### Screenshots');
    for (const id of shotLines) {
      const shot = shotById.get(id)!;
      lines.push(`- [S:${id}] ${shot.viewport} ${shot.kind}, ${shot.pageUrl}`);
    }
  }
  return lines.join('\n');
}

function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

export interface GenerateDesignDocOptions {
  siteName: string;
  tokens: DtcgDocument;
  vision: VisionAnalysis | null;
  screenshots: CapturedScreenshot[];
  generateFn: GenerateFn;
}

/** Generate the full, single design-system document: LLM prose + deterministic Responsive Behavior + embedded tokens + Sources. */
export async function generateDesignSystemDoc(opts: GenerateDesignDocOptions): Promise<string> {
  const raw = await opts.generateFn(buildDesignDocPrompt(opts.siteName, opts.tokens, opts.vision));
  const validTokenPaths = new Set(flattenTokenPaths(opts.tokens).map((t) => t.path));
  const validShotIds = new Set(opts.screenshots.map((s) => s.id));
  const { body, citedTokens, citedShots } = processDesignCitations(stripFences(raw), validTokenPaths, validShotIds);

  return [
    body,
    '',
    buildResponsiveBehaviorSection(opts.tokens),
    '',
    buildTokensJsonSection(opts.tokens),
    '',
    buildDesignSourcesSection(citedTokens, citedShots, opts.tokens, opts.screenshots),
    '',
  ].join('\n');
}
