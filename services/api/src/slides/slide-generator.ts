// services/api/src/slides/slide-generator.ts
//
// Validates and passes through LLM-generated standalone HTML slide presentations.
// The LLM has full creative freedom — we just ensure the output is a valid HTML document.

export type SlideOrientation = 'landscape' | 'portrait'

export interface SavedSlide {
  id: string
  title: string
  client: string
  slideCount: number  // best-effort count, 0 if not detectable
  savedAt: string
  orientation?: SlideOrientation  // defaults to 'landscape' when absent (back-compat)
}

// Attempt to count slides using common HTML slide deck patterns.
// Returns 0 if structure is unrecognisable.
export function countSlides(html: string): number {
  // Pattern 1: data-slide or data-idx attributes
  const byAttr = (html.match(/data-(?:slide|idx)=["']\d+["']/g) ?? []).length;
  if (byAttr > 0) return byAttr;

  // Pattern 2: standalone "slide" class token — not slide-xxx or slide_xxx compounds.
  // Matches class="slide", class="slide active", class="active slide", etc.
  // Rejects class="slide-content", class="slide_bg", etc.
  const byClass = (html.match(/class="(?:[^"]*\s)?slide(?:\s[^"]*)?"/g) ?? []).length;
  if (byClass > 0) return byClass;

  // Pattern 3: <section elements (common in reveal.js-style decks)
  const bySection = (html.match(/<section\b/gi) ?? []).length;
  if (bySection > 1) return bySection;

  return 0;
}

// Extract the presentation title from the HTML <title> tag, falling back to the first <h1>.
export function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) return titleMatch[1].trim();
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) return h1Match[1].replace(/<[^>]+>/g, '').trim();
  return 'Presentation';
}

// Inject a layout enforcer so slides are always vertically scrollable with 8px gaps,
// regardless of how the LLM structured its HTML. This enforces ONLY the technical
// frame (scroll layout, slide box + aspect ratio, gap, no word-breaking, no JS nav);
// all VISUALS — background, colour, shadows, typography — are the LLM's to control,
// so nothing here forces a page background or slide shadow. The per-slide aspect
// ratio follows the deck orientation — 16/9 landscape (default) or 9/16 portrait.
function injectScrollEnforcer(html: string, orientation: SlideOrientation = 'landscape'): string {
  const aspectRatio = orientation === 'portrait' ? '9/16' : '16/9';
  const enforcer = `<style id="prodeck-scroll-enforcer">
body{overflow-y:auto!important;overflow-x:hidden!important;height:auto!important;min-height:unset!important;margin:0!important;}
.deck,.slides,.slide-container,.presentation-container,.slideshow{display:flex!important;flex-direction:column!important;gap:8px!important;height:auto!important;min-height:unset!important;overflow:visible!important;position:static!important;}
.slide,.page,.slide-page{position:relative!important;width:100%!important;aspect-ratio:${aspectRatio}!important;height:auto!important;min-height:unset!important;overflow:hidden!important;opacity:1!important;transform:none!important;pointer-events:all!important;flex-shrink:0!important;inset:unset!important;}
/* Never break a word across two lines — wrap only at spaces (overrides any break-all/break-word/hyphens the LLM may emit) */
.slide *,.page *,.slide-page *{word-break:normal!important;overflow-wrap:normal!important;hyphens:none!important;}
.slide+.slide,.page+.page{margin-top:0!important;}
.nav-prev,.nav-next,.nav-zone,.keyboard-hint{display:none!important;}
</style>`;
  const headClose = html.indexOf('</head>');
  if (headClose !== -1) return html.slice(0, headClose) + enforcer + html.slice(headClose);
  // No </head> — prepend to body
  const bodyOpen = html.indexOf('<body');
  if (bodyOpen !== -1) return html.slice(0, bodyOpen) + enforcer + html.slice(bodyOpen);
  return enforcer + html;
}

// Determine a deck's true orientation from the LLM-generated HTML by inspecting
// the aspect-ratio it actually applied to slide elements. The model has full
// creative freedom and sometimes ignores the requested orientation; trusting
// what it actually built keeps the stored index metadata, the injected scroll
// enforcer, and the rendered deck in agreement (no more "indexed landscape but
// rendered/described portrait" mismatches). Falls back to `requested` when the
// HTML gives no clear signal. Call this on the RAW LLM html, before the enforcer
// is injected, so the enforcer's own aspect-ratio is not counted.
export function resolveSlideOrientation(
  html: string,
  requested: SlideOrientation = 'landscape',
): SlideOrientation {
  const portrait = (html.match(/aspect-ratio\s*:\s*9\s*\/\s*16/gi) ?? []).length;
  const landscape = (html.match(/aspect-ratio\s*:\s*16\s*\/\s*9/gi) ?? []).length;
  if (portrait > landscape) return 'portrait';
  if (landscape > portrait) return 'landscape';
  return requested;
}

// Light validation: ensure output looks like a complete HTML document.
// Throws with a human-readable message if it looks truncated or non-HTML.
export function validateSlideHtml(html: string, orientation: SlideOrientation = 'landscape'): string {
  const trimmed = html.trim();
  if (!trimmed.includes('<html') && !trimmed.includes('<!DOCTYPE')) {
    throw new Error('Slide output is not a valid HTML document');
  }
  if (!trimmed.includes('</html>') && !trimmed.includes('</body>')) {
    throw new Error('Slide HTML appears truncated (missing closing tags)');
  }
  return injectScrollEnforcer(trimmed, orientation);
}
