// Pure parsing helpers for the super-client chat generation path. Kept in their
// own module (no I/O, no side effects) so they can be unit-tested without
// pulling in the full route/LLM dependency graph.

export function extractSlidesTag(text: string): { html: string } | null {
  // Well-formed pair.
  const m = text.match(/<slides>([\s\S]*?)<\/slides>/i);
  if (m) return { html: m[1].trim() };

  // Recovery: the model produced the deck but dropped the closing </slides>
  // wrapper. Only accept the remainder if it looks like a complete HTML
  // document — a genuinely truncated response (no </html>/</body>) returns
  // null so the generation-turn guard surfaces a retry message instead.
  const openMatch = text.match(/<slides>/i);
  if (!openMatch || openMatch.index === undefined) return null;
  const rest = text.slice(openMatch.index + openMatch[0].length);
  if (/<\/html>|<\/body>/i.test(rest)) return { html: rest.trim() };
  return null;
}

export function stripSlidesTag(text: string): string {
  // Remove the whole block, tolerating a missing closing tag (strip to end)
  // so a stray opening <slides> marker can never survive into the chat text.
  return text.replace(/<slides>[\s\S]*?(?:<\/slides>|$)/i, '').trim();
}

// Detects raw artifact markup that must never be shown to the user as chat
// text — used by the generation-turn guard to catch leaked/truncated output.
export function hasRawArtifactMarkup(text: string): boolean {
  return /<slides>|<!DOCTYPE|<html[\s>]|<proposal\b|<document\b/i.test(text);
}

// A single-shot presentation call must fit the whole deck's HTML within the
// provider's output-token ceiling (16k on Anthropic, 8k on OpenAI/NVIDIA) —
// rich per-slide CSS/JS makes a large deck truncate before completion. This
// caps any explicit user-requested count and resolves the no-count default.
export const MAX_SLIDE_COUNT = 15;

export interface ResolvedSlideCount {
  requested: number | null;
  resolved: number | null;
  wasCapped: boolean;
}

export function resolveSlideCount(message: string): ResolvedSlideCount {
  const match = message.match(/\b(\d+)[\s\-]*(page|slide|screen)s?\b/i);
  const requested = match ? parseInt(match[1], 10) : null;
  const resolved = requested ? Math.min(requested, MAX_SLIDE_COUNT) : null;
  const wasCapped = !!(requested && requested > MAX_SLIDE_COUNT);
  return { requested, resolved, wasCapped };
}
