// services/api/src/site-facts/design/vision-analysis.service.ts
//
// Layout/component-pattern vision analysis — a different job from
// image-context's per-image captioning. This describes overall page
// composition (nav/hero/card/footer arrangement, visual character) from a
// handful of full-page + cropped screenshots. Same no-invention discipline
// as fact extraction: describe only what's visible, never recommend.

import type { GenerateFn } from '@ai-engine/planner';
import type { CapturedScreenshot, VisionAnalysis, VisionComponent, VisionScreenshotAnalysis } from './types.js';
import { VISION_COMPONENTS } from './types.js';

/** (prompt, base64Jpeg) → LLM response. */
export type VisionGenerateFn = (prompt: string, base64Jpeg: string) => Promise<string>;

/** Prefixes the DESIGN_IMAGE: marker the LLM bridge's vision path expects. */
export function makeVisionGenerateFn(generateFn: GenerateFn): VisionGenerateFn {
  return (prompt, base64Jpeg) => generateFn(`DESIGN_IMAGE:${base64Jpeg}\n\n${prompt}`);
}

const MAX_ADJECTIVES = 6;
const MAX_LAYOUT_NOTES = 4;
const MAX_BASE64_LENGTH = 4_000_000;

/**
 * The vision prompt. Exported as a constant so it can be reviewed/tuned
 * independently, same as the fact-extraction prompt.
 */
export const VISION_ANALYSIS_PROMPT_TEMPLATE = `You are a design analyst describing ONLY what is visible in this screenshot of a website ({{SCREENSHOT_ID}}: {{KIND}} view, {{VIEWPORT}} viewport).

Rules (follow exactly):
1. Describe only what you can see in the image. Never guess at colors' exact hex values, never infer pages you cannot see, never speculate about brand intent or strategy.
2. Do NOT give design recommendations, critiques, or improvement suggestions — this is extraction of what exists, not a redesign.
3. If something is not visible or is ambiguous, omit it rather than guessing.
4. Style adjectives must describe what is observably present (e.g. "minimal", "dense", "editorial", "playful", "corporate") — not aspirational qualities.
5. Do NOT describe individual photo/image content in detail — that is handled by a separate module. Focus on layout, composition, and component arrangement.

Return ONLY a JSON object (no code fences, no prose) shaped exactly like:
{
  "style_adjectives": ["up to ${MAX_ADJECTIVES} single adjectives describing the visible visual character"],
  "components": [
    { "component": "one of: nav | hero | card | button | form | footer | section | other", "description": "one factual sentence about its visible layout and treatment" }
  ],
  "layout_notes": ["up to ${MAX_LAYOUT_NOTES} factual observations about grid, alignment, density, or whitespace"]
}`;

export function buildVisionPrompt(screenshot: CapturedScreenshot): string {
  return VISION_ANALYSIS_PROMPT_TEMPLATE.replace('{{SCREENSHOT_ID}}', screenshot.id)
    .replace('{{KIND}}', screenshot.kind)
    .replace('{{VIEWPORT}}', screenshot.viewport);
}

function asStringArray(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, cap);
}

/** Strict parse/validation of one vision response. Returns null on unusable output. */
export function parseVisionResponse(raw: string, screenshotId: string): VisionScreenshotAnalysis | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const components: VisionScreenshotAnalysis['components'] = [];
  if (Array.isArray(parsed.components)) {
    for (const item of parsed.components) {
      if (typeof item !== 'object' || item === null) continue;
      const record = item as Record<string, unknown>;
      const description = typeof record.description === 'string' ? record.description.trim() : '';
      if (!description) continue;
      const component = VISION_COMPONENTS.includes(record.component as VisionComponent)
        ? (record.component as VisionComponent)
        : 'other';
      components.push({ component, description });
    }
  }

  return {
    screenshot_id: screenshotId,
    style_adjectives: asStringArray(parsed.style_adjectives, MAX_ADJECTIVES),
    components,
    layout_notes: asStringArray(parsed.layout_notes, MAX_LAYOUT_NOTES),
  };
}

/** Deterministic merge across screenshots, preserving per-screenshot provenance. */
export function mergeVisionAnalyses(perShot: VisionScreenshotAnalysis[]): VisionAnalysis['merged'] {
  const adjectiveMap = new Map<string, string[]>();
  const componentMap = new Map<VisionComponent, { text: string; screenshot_id: string }[]>();
  const layout: { text: string; screenshot_id: string }[] = [];

  for (const shot of perShot) {
    for (const adjective of shot.style_adjectives) {
      const key = adjective.toLowerCase();
      const entry = adjectiveMap.get(key) ?? [];
      if (!entry.includes(shot.screenshot_id)) entry.push(shot.screenshot_id);
      adjectiveMap.set(key, entry);
    }
    for (const { component, description } of shot.components) {
      const entry = componentMap.get(component) ?? [];
      entry.push({ text: description, screenshot_id: shot.screenshot_id });
      componentMap.set(component, entry);
    }
    for (const note of shot.layout_notes) layout.push({ text: note, screenshot_id: shot.screenshot_id });
  }

  return {
    adjectives: [...adjectiveMap.entries()]
      .map(([term, seen_in]) => ({ term, seen_in }))
      .sort((a, b) => b.seen_in.length - a.seen_in.length || a.term.localeCompare(b.term)),
    component_inventory: [...componentMap.entries()]
      .map(([component, descriptions]) => ({ component, descriptions }))
      .sort((a, b) => VISION_COMPONENTS.indexOf(a.component) - VISION_COMPONENTS.indexOf(b.component)),
    layout_notes: layout,
  };
}

/**
 * Analyze all screenshots sequentially (the LLM bridge pool is small and
 * shared with the rest of the app — never parallelize these). Per-shot:
 * one retry on unparseable output, then recorded as failed and skipped.
 */
export async function analyzeScreenshots(
  shots: CapturedScreenshot[],
  visionFn: VisionGenerateFn,
  log: { warn: (obj: unknown, msg?: string) => void },
): Promise<VisionAnalysis> {
  const analyses: VisionScreenshotAnalysis[] = [];
  const failed: string[] = [];

  for (const shot of shots) {
    try {
      if (shot.base64Jpeg.length > MAX_BASE64_LENGTH) {
        log.warn({ id: shot.id }, '[design] screenshot too large for vision bridge — skipping');
        failed.push(shot.id);
        continue;
      }

      const prompt = buildVisionPrompt(shot);
      let parsed = parseVisionResponse(await visionFn(prompt, shot.base64Jpeg), shot.id);
      if (!parsed) {
        const retryPrompt = `${prompt}\n\nYour previous reply was not valid JSON. Return ONLY the JSON object.`;
        parsed = parseVisionResponse(await visionFn(retryPrompt, shot.base64Jpeg), shot.id);
      }
      if (parsed) {
        analyses.push(parsed);
      } else {
        failed.push(shot.id);
      }
    } catch (err) {
      log.warn({ err, id: shot.id }, '[design] vision analysis failed for screenshot — skipping');
      failed.push(shot.id);
    }
  }

  return {
    analyzed_at: new Date().toISOString(),
    screenshots: analyses,
    failed_screenshot_ids: failed,
    merged: mergeVisionAnalyses(analyses),
  };
}
