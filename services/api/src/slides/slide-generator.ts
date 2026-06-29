// services/api/src/slides/slide-generator.ts
//
// Validates and passes through LLM-generated standalone HTML slide presentations.
// The LLM has full creative freedom — we just ensure the output is a valid HTML document.

export interface SavedSlide {
  id: string
  title: string
  client: string
  slideCount: number  // best-effort count, 0 if not detectable
  savedAt: string
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

// Inject a layout enforcer so slides are always vertically scrollable with 12px gaps,
// regardless of how the LLM structured its HTML.
function injectScrollEnforcer(html: string): string {
  const enforcer = `<script id="prodeck-theme-apply">
(function(){
  var p = new URLSearchParams(location.search).get('bg');
  if (p) document.documentElement.style.setProperty('--prodeck-bg', decodeURIComponent(p));
})();
</script>
<style id="prodeck-scroll-enforcer">
:root{--prodeck-bg:#0b0f17;}
html{background:var(--prodeck-bg)!important;}
body{overflow-y:auto!important;overflow-x:hidden!important;height:auto!important;min-height:unset!important;margin:0!important;padding:20px 0!important;background:var(--prodeck-bg)!important;}
.deck,.slides,.slide-container,.presentation-container,.slideshow{display:flex!important;flex-direction:column!important;gap:12px!important;height:auto!important;min-height:unset!important;overflow:visible!important;position:static!important;background:transparent!important;}
.slide,.page,.slide-page{position:relative!important;width:100%!important;aspect-ratio:16/9!important;height:auto!important;min-height:unset!important;opacity:1!important;transform:none!important;pointer-events:all!important;flex-shrink:0!important;inset:unset!important;box-shadow:0 8px 32px rgba(0,0,0,0.45),0 2px 8px rgba(0,0,0,0.3)!important;}
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

// Light validation: ensure output looks like a complete HTML document.
// Throws with a human-readable message if it looks truncated or non-HTML.
export function validateSlideHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed.includes('<html') && !trimmed.includes('<!DOCTYPE')) {
    throw new Error('Slide output is not a valid HTML document');
  }
  if (!trimmed.includes('</html>') && !trimmed.includes('</body>')) {
    throw new Error('Slide HTML appears truncated (missing closing tags)');
  }
  return injectScrollEnforcer(trimmed);
}
