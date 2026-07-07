export interface BridgeMessage {
  source: 'microsite-bridge';
  type: 'hover' | 'select' | 'leave' | 'track-update';
  /** Raw HTML tag name: "div", "h1", "img", "svg", "button" */
  tag: string;
  /** Display label: "div.ms-card", "h1", "img", "section#hero" */
  label: string;
  /** textContent preview ≤120 chars */
  text: string;
  sectionType: string | null;
  rect: { top: number; left: number; width: number; height: number };
  /** Full outerHTML on 'select' (capped 8KB); first 400 chars on 'hover' */
  outerHtml: string;
  /** Position-based CSS path: "section#hero > div.hero-vignette:nth-of-type(1)"
   *  Only populated on 'select'. Used by server for exact element targeting. */
  path: string;
  /** Computed (rendered) background-color — only on 'select'. Reflects CSS class colors. */
  computedBgColor?: string;
  /** Computed (rendered) text color — only on 'select'. Reflects CSS class colors. */
  computedColor?: string;
  /** Bounding rect of the nearest parent <section> element.
   *  Used to determine whether the selected element fills the section (and thus
   *  whether the "Remove Section" button should appear). Only on 'select'. */
  sectionRect?: { top: number; left: number; width: number; height: number };
}

const REMOVAL_RE = /\b(remove|delete|hide|take\s+out|get\s+rid\s+of|eliminate|clear)\b/i;

// These prompts mention removing CONTENT inside an element (video, image, text, etc.)
// rather than the element itself — don't route them to __REMOVE_BY_PATH__.
const CONTENT_REMOVAL_RE = /\b(video|vimeo|youtube|iframe|background[\s-]video|video[\s-]background|image|logo|text|icon|button|link|badge|overlay)\b/i;

// A second clause (conjunction/second verb) means the sentence has real
// structure a word-proximity regex can't reliably parse — e.g. "remove this
// image AND replace it with..." or "remove the badge AND change the heading".
// Rather than growing REMOVAL_RE/CONTENT_REMOVAL_RE's word lists to cover every
// new compound phrasing, bail out of the deterministic fast path entirely and
// let __ELEMENT_EDIT__'s LLM call (which already sees the full sentence + the
// element's exact HTML) decide. Trivial single-clause commands ("remove this",
// "delete this section") have no second clause and stay on the fast path.
const COMPOUND_RE = /\b(and|then|also|but|while|after|before)\b/i;

export function buildInstruction(selected: BridgeMessage | null, userText: string): string {
  if (!selected) return userText;

  const isCompound = COMPOUND_RE.test(userText);

  // Background removal: "remove background image", "clear background", "remove bg" etc.
  // Checked BEFORE CONTENT_REMOVAL_RE because "image" would otherwise block the removal route.
  // Uses __REMOVE_BACKGROUND__ which strips both inline style and CSS class rule in the <style> block.
  const isBgRemoval = REMOVAL_RE.test(userText)
    && /\b(?:background|bg)\b/i.test(userText)
    && !/\b(?:video|vimeo|youtube|iframe)\b/i.test(userText)
    && !isCompound;
  if (isBgRemoval && selected.path) {
    return `__REMOVE_BACKGROUND__:${selected.path}`;
  }

  // Removal → deterministic path, BUT only when the user means "remove this element",
  // not "remove something inside it" (e.g. "remove video from background" = content edit),
  // and only when the sentence is a single clause (see COMPOUND_RE above).
  if (REMOVAL_RE.test(userText) && !CONTENT_REMOVAL_RE.test(userText) && !isCompound) {
    if (selected.path) {
      // "remove this section" → remove the parent <section>, but ONLY when the
      // selected element is structural (div, img, svg, etc.) not text (h1, p, span).
      // If text is selected, "remove this section" is interpreted as "remove this text".
      const TEXT_TAGS_PROMPT: Record<string,number> = {h1:1,h2:1,h3:1,h4:1,h5:1,h6:1,p:1,span:1,a:1,li:1,button:1,label:1,td:1,th:1,caption:1,figcaption:1,dt:1,dd:1,blockquote:1,em:1,strong:1,small:1,b:1,i:1};
      const isTextTag = TEXT_TAGS_PROMPT[(selected.tag ?? '').toLowerCase()] === 1;
      const innerForPrompt = selected.outerHtml.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, '');
      const hasChildsP = /<\w/.test(innerForPrompt);
      const hasTextP  = (selected.text ?? '').trim().length > 0;
      const isLeafTextEl = isTextTag || (hasTextP && !hasChildsP);

      if (/\bsection\b/i.test(userText) && !isLeafTextEl) {
        // Use the same dimension check as the "Remove Section" button:
        // only route to section deletion when the selected element fills ≥85% of
        // the parent section (width AND height). A small card or content block that
        // doesn't fill the section should NOT trigger whole-section deletion even
        // when the user says "remove this section" — route to element removal instead.
        const secRect = selected.sectionRect;
        const elRect  = selected.rect;
        const fillsSection = !secRect || secRect.width <= 0 || secRect.height <= 0 ||
          (elRect.width / secRect.width >= 0.85 && elRect.height / secRect.height >= 0.85);

        if (fillsSection) {
          const sectionMatch = selected.path.match(/\b(section#[\w-]+)/);
          if (sectionMatch) return `__REMOVE_BY_PATH__:${sectionMatch[1]}`;
          if (selected.sectionType) return `__REMOVE_BY_PATH__:section#${selected.sectionType}`;
        }
        // Element doesn't fill the section → treat as "remove this element"
      }
      return `__REMOVE_BY_PATH__:${selected.path}`;
    }
    if (selected.outerHtml) {
      return `__REMOVE_ELEMENT__:${selected.outerHtml.slice(0, 400)}`;
    }
  }

  // Element-scoped edit — three-part format:
  //   __ELEMENT_EDIT__:[cssPath]||[hintOuterHtml]||[instruction]
  // The server uses cssPath for exact positioning; hintOuterHtml as LLM context fallback.
  const ctx = selected.sectionType ? `[${selected.sectionType}] ` : '';
  const elementPayload = selected.outerHtml.slice(0, 8192);
  return `__ELEMENT_EDIT__:${selected.path}||${elementPayload}||${ctx}<${selected.label}>: ${userText}`;
}

// ── Cursor reset CSS (injected always) ─────────────────────────────────────
const CURSOR_RESET_CSS = `<style id="__preview-cursor-reset">
/* Prevent LLM-generated microsites from centering body with max-width, which creates
   black side bars when the html element has a dark background. Inner content wrappers
   may still use max-width + margin:auto — only html/body are reset here. */
html,body{max-width:none!important;margin-left:0!important;margin-right:0!important;width:100%!important;}
body{overflow-x:clip!important;}
script,style,noscript,template{display:none!important;visibility:hidden!important;}
*,*::before,*::after{cursor:auto!important}
.cursor,.cursor-dot,.cursor-ring,.cursor-follower,.cursor-blob,
.custom-cursor,.mouse-cursor,.pointer-cursor,.cursor-inner,.cursor-outer,
[class*="cursor-"],[id*="cursor"],[class*="custom-cursor"]{display:none!important}
/* Layer 1 — disable CSS keyframe animations (the usual way LLMs hide content
   until scroll/reveal). Transitions are kept so interactive elements like
   hamburger menus, hover effects, and accordions still work. */
*{animation:none!important}
/* Layer 2 — elements that start at opacity:0 for animation purposes:
   force them visible now that animations are disabled. */
.word,.reveal,.reveal-text,.reveal-item,.reveal-card,.reveal-image,
.reveal-up,.reveal-down,.reveal-left,.reveal-right,
.fade-in,.fade-up,.fade-down,.fade-left,.fade-right,
.slide-in,.slide-up,.slide-down,.slide-left,.slide-right,
.zoom-in,.zoom-out,.scale-in,.scale-up,
[data-aos],[data-sal],[data-scroll],[data-motion],
[class*="scroll-reveal"],[class*="js-reveal"]{
  opacity:1!important;transform:none!important;
  visibility:visible!important;clip-path:none!important
}
/* Thin modern scrollbar — replaces the OS-default chunky scrollbar that appears
   in the portrait preview iframe (the iframe scrolls its content, not the page). */
::-webkit-scrollbar{width:5px;height:5px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:rgba(140,140,140,0.55);border-radius:3px;}
::-webkit-scrollbar-thumb:hover{background:rgba(140,140,140,0.85);}
</style>`;

// Layer 3 — JS fallback for future microsites with unknown class names.
// Pass A: force visible any opacity:0 element that has a CSS animation or
//         transition (animation-driven hiding, not intentional UI hiding).
// Pass B: detect dark gradient text (-webkit-text-fill-color:transparent with
//         all-dark hex stops) and override to white — handles LLM-generated
//         microsites that use navy/dark gradients as text color on dark BGs.
// Runs twice: fast pass at 50ms catches most cases; 500ms pass catches
// elements created by JS after initial paint (e.g. word-split hero animations).
const PREVIEW_REVEAL_SCRIPT = `<script id="__preview-reveal-fix">(function(){
function lumHex(h){var r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16);return 0.299*r+0.587*g+0.114*b;}
function lumRgb(s){var m=s.match(/\d+/g);if(!m||m.length<3)return 255;return 0.299*parseInt(m[0])+0.587*parseInt(m[1])+0.114*parseInt(m[2]);}

function fix(){
  var all=document.querySelectorAll('*');
  for(var i=0;i<all.length;i++){
    var el=all[i];
    var cs=window.getComputedStyle(el);
    var inlineCss=el.getAttribute('style')||'';

    // ── Pass A: force visible content that is opacity:0 due to disabled animations.
    // Guard 1: display:none  → legitimately hidden (dropdowns, modals closed state).
    // Guard 2: pointer-events:none → overlay-pattern hidden (e.g. mobile menus that
    //          use opacity:0+pointer-events:none as their closed state instead of
    //          display:none). These must NOT be forced visible or the menu appears
    //          open on load and can never be closed.
    // Threshold <=0.005: CSS animations always start at exactly opacity:0.
    // Design overlays (grain, noise, scanline textures) intentionally use
    // values like 0.03, 0.05, 0.1+ and must keep their designed opacity.
    if(parseFloat(cs.opacity||'1')<=0.005&&cs.display!=='none'&&cs.pointerEvents!=='none'){
      el.style.setProperty('opacity','1','important');
      el.style.setProperty('visibility','visible','important');
      el.style.setProperty('transform','none','important');
      el.style.setProperty('clip-path','none','important');
    }

    // ── Pass B: dark gradient text — LLMs often generate navy/dark gradients
    // as text colour on dark backgrounds, making text invisible.
    // Uses BOTH inline-style check (reliable for LLM patterns) AND
    // computed-style check (catches CSS-rule-based gradients after re-edits).
    var hasGradTextInline=(inlineCss.indexOf('text-fill-color')!==-1||inlineCss.indexOf('background-clip')!==-1)&&inlineCss.indexOf('gradient')!==-1;
    var bgClipCs=cs.backgroundClip||'';
    var hasGradTextCs=bgClipCs==='text'&&(cs.backgroundImage||'').indexOf('gradient')!==-1;
    if(hasGradTextInline||hasGradTextCs){
      // Get luminance of gradient stops: prefer hex from inline (before browser normalises),
      // fall back to rgb() from computed background-image.
      var lums=[];
      var hexes=inlineCss.match(/#[0-9a-fA-F]{6}/g)||[];
      if(hexes.length){lums=hexes.map(lumHex);}
      else{lums=((cs.backgroundImage||'').match(/rgba?\([^)]+\)/g)||[]).map(lumRgb);}
      var allDark=lums.length>0&&lums.every(function(l){return l<80;});
      if(allDark){
        el.style.setProperty('-webkit-text-fill-color','#fff','important');
        el.style.setProperty('color','#fff','important');
        el.style.setProperty('background','none','important');
        el.style.setProperty('-webkit-background-clip','unset','important');
        el.style.setProperty('background-clip','unset','important');
      }
    }
  }
}

// Run synchronously now — hero word-split spans already exist (their script runs
// earlier in the body). Then re-run on timers for transition-based reveals.
fix();
setTimeout(fix,80);
setTimeout(fix,600);
}());</script>`;

// Intercept hash-anchor clicks so they scroll within the srcDoc iframe instead of
// navigating away (clicking nav links like href="#section" would blank a srcDoc iframe
// because it has no real base URL).
const NAV_FIX_SCRIPT = `<script id="__nav-anchor-fix">document.addEventListener('click',function(e){if(window.__editMode)return;var a=e.target.closest('a[href^="#"]');if(!a)return;e.preventDefault();var href=a.getAttribute('href');if(!href||href==='#')return;var id=href.slice(1);var el=document.getElementById(id)||document.querySelector('[name="'+id+'"]');if(el)el.scrollIntoView({behavior:'smooth'});},true);</script>`;

// IDs of all elements injected by normalizeMicrositeHtml / injectBridgeScript.
// Used to strip stale saved copies before re-injecting the latest code.
// '__slide-scaler__' is included so any old server-baked scaler is stripped on load.
const PREVIEW_INJECTION_IDS = [
  '__preview-cursor-reset',
  '__nav-anchor-fix',
  '__preview-reveal-fix',
  '__microsite-iframe-edit',
  '__scroll-restore',
  '__slide-scaler__',
] as const;

// Strip any previously-saved preview injections so stale code is never reused.
export function stripPreviewInjections(html: string): string {
  let out = html;
  for (const id of PREVIEW_INJECTION_IDS) {
    out = out.replace(
      new RegExp(`<(?:style|script)[^>]*\\bid="${id}"[\\s\\S]*?</(?:style|script)>\\s*`, 'g'),
      '',
    );
  }
  return out;
}

// A truncated generation (SSE cut off mid-stream) can end the document inside an
// unterminated tag, e.g. "...color:#b8956a;\">3</div" with no closing ">". Appending
// our own <script> right after that dangling fragment merges it into the tokenizer's
// in-progress tag name, so the browser never recognises a <script> element at all —
// the whole script body then renders as literal visible text on the page. Stripping
// any trailing "<" or "</" that never reaches a ">" before EOF guarantees our own
// injected markup always starts from a clean, tag-boundary position.
function closeDanglingTag(html: string): string {
  return html.replace(/<\/?[a-zA-Z][^>]*$/, '');
}

export function normalizeMicrositeHtml(html: string): string {
  if (!html) return html;
  // Strip any stale injections first — ensures the latest code always runs even
  // when the server saved HTML that already contained older injection versions.
  let out = stripPreviewInjections(html);
  out = closeDanglingTag(out);

  // 1. Cursor-reset + animation-visibility CSS → <head>
  const headClose = out.indexOf('</head>');
  out = headClose !== -1
    ? out.slice(0, headClose) + CURSOR_RESET_CSS + out.slice(headClose)
    : CURSOR_RESET_CSS + out;

  // 2. Hash-anchor intercept → immediately after <body>
  const bodyOpen = out.search(/<body[^>]*>/i);
  if (bodyOpen !== -1) {
    const tagEnd = out.indexOf('>', bodyOpen) + 1;
    out = out.slice(0, tagEnd) + NAV_FIX_SCRIPT + out.slice(tagEnd);
  } else {
    out = NAV_FIX_SCRIPT + out;
  }

  // 3. JS reveal fallback → before </body> (needs DOM to exist first).
  // Guard: close any unclosed <textarea> tags first — if our <script> injection
  // lands inside a <textarea>, the browser renders script content as visible text.
  const taOpen = (out.match(/<textarea[\s>]/gi) || []).length;
  const taClose = (out.match(/<\/textarea>/gi) || []).length;
  if (taOpen > taClose) {
    const closes = '</textarea>'.repeat(taOpen - taClose);
    const bc = out.lastIndexOf('</body>');
    out = bc !== -1 ? out.slice(0, bc) + closes + out.slice(bc) : out + closes;
  }
  const bodyClose = out.lastIndexOf('</body>');
  out = bodyClose !== -1
    ? out.slice(0, bodyClose) + PREVIEW_REVEAL_SCRIPT + out.slice(bodyClose)
    : out + PREVIEW_REVEAL_SCRIPT;

  return out;
}

// ── Bridge script (injected into the srcdoc iframe in edit mode) ────────────
const BRIDGE_SCRIPT_BODY = /* javascript */ `
(function () {
'use strict';

// Signal to NAV_FIX_SCRIPT that edit mode is active — suppresses scrollIntoView.
window.__editMode = true;

// ── Skip list: elements we never select ──────────────────────────────────
var SKIP_TAGS = { html:1, body:1, head:1, script:1, style:1, meta:1, link:1, title:1 };

// ── Word-split class detection ────────────────────────────────────────────
// JS animation libraries (GSAP SplitText, splitting.js, etc.) wrap each word/char
// in a <span class="word"> (or "char", "letter", etc.) at runtime. These spans
// are never present in the stored HTML, so the server can never locate them.
// We detect them early and walk up to the actual text container instead.
var WORD_SPLIT_CLS = {word:1,char:1,letter:1,line:1,'split-word':1,'split-char':1,'split-text':1,'split-line':1,'word-split':1,'char-split':1};
function isWordSplitSpan(el) {
  if (!el || (el.tagName||'').toLowerCase() !== 'span') return false;
  var cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/) : [];
  for (var i = 0; i < cls.length; i++) { if (WORD_SPLIT_CLS[cls[i]]) return true; }
  return false;
}

// ── Section type detection (reads section[id] directly) ──────────────────
function getSectionType(el) {
  var cur = el;
  while (cur && cur !== document.body) {
    if ((cur.tagName || '').toLowerCase() === 'section') {
      if (cur.id) return cur.id.replace(/-\\d+$/, '');
      if (cur.dataset && cur.dataset.sectionId) return cur.dataset.sectionId.replace(/-\\d+$/, '');
      if (cur.dataset && cur.dataset.type) return cur.dataset.type;
      var kws = ['hero','overview','challenge','approach','deliverables','timeline','pricing',
                 'team','testimonial','faq','footer','whyus','nextsteps','stats','benefits',
                 'showcase','features','about','contact','security','techstack'];
      var combined = ((cur.id||'')+' '+(cur.className&&typeof cur.className==='string'?cur.className:'')).toLowerCase();
      for (var i = 0; i < kws.length; i++) if (combined.indexOf(kws[i]) !== -1) return kws[i];
      var h = cur.querySelector('h1,h2');
      if (h) return (h.textContent||'').trim().slice(0,24).toLowerCase().replace(/\\s+/g,'-').replace(/[^a-z0-9-]/g,'');
    }
    cur = cur.parentElement;
  }
  return null;
}

// ── Build a display label: "div.ms-card", "h1", "section#hero" ───────────
function makeLabel(el) {
  var tag = (el.tagName||'').toLowerCase();
  var id = el.id ? '#'+el.id : '';
  var cls = '';
  if (!id && el.className && typeof el.className === 'string') {
    var classes = el.className.trim().split(/\\s+/)
      .filter(function(c){ return c.length > 1 && !/^(\\d|true|false)/.test(c); });
    if (classes.length > 0) cls = '.'+classes[0];
  }
  return tag + (id || cls);
}

// ── Build a position-based CSS path for exact server-side targeting ───────
// Format: "section#hero > div.hero-bg:nth-of-type(1) > div.hero-vignette"
// Uses id anchors when available; nth-of-type when multiple same-tag siblings.
function getCssPath(el) {
  var parts = [];
  var cur = el;
  while (cur && cur !== document.body) {
    var tag = (cur.tagName || '').toLowerCase();
    if (SKIP_TAGS[tag]) break;

    // Use id as a unique anchor — stop walking up
    if (cur.id) {
      parts.unshift(tag + '#' + cur.id);
      break;
    }

    var selector = tag;

    // Append most specific (longest) class that's meaningful.
    // Exclude classes that JavaScript adds at runtime (animation states, scroll
    // reveal triggers, etc.) — they don't exist in the stored HTML so using them
    // as the path anchor causes findByPath to fail on the server.
    var JS_CLASSES = { visible:1, active:1, animated:1, 'in-view':1, 'is-visible':1,
                       show:1, shown:1, open:1, opened:1, loaded:1, playing:1,
                       paused:1, focused:1, selected:1, 'is-active':1, 'is-open':1,
                       current:1, engaged:1, intersecting:1, triggered:1 };
    var classes = (typeof cur.className === 'string' ? cur.className : '')
      .trim().split(/\\s+/).filter(function(c){ return c.length > 1 && !JS_CLASSES[c]; });
    classes.sort(function(a, b){ return b.length - a.length; });
    var bestCls = classes[0] || '';
    if (bestCls) selector += '.' + bestCls;

    // Disambiguate with nth-of-type.
    // IMPORTANT: count the same way findByPath does on the server —
    // only siblings that share BOTH the same tag AND the same best class.
    // This prevents mismatch in marquees/galleries where different img classes coexist.
    if (cur.parentElement) {
      var sameSiblings = Array.from(cur.parentElement.children).filter(function(s) {
        if (s.tagName !== cur.tagName) return false;
        if (!bestCls) return true;
        return (s.className || '').split(/\\s+/).indexOf(bestCls) !== -1;
      });
      if (sameSiblings.length > 1) {
        selector += ':nth-of-type(' + (sameSiblings.indexOf(cur) + 1) + ')';
      }
    }

    parts.unshift(selector);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

// ── Find interesting element: minimal upward walking ─────────────────────
function getInteresting(raw) {
  if (!raw) return null;

  // Walk out of word-split spans — they are JS-generated at runtime and don't
  // exist in the stored HTML, so the server can never locate them by path.
  // Climb to the nearest non-word-split ancestor (the real text container).
  var cur = raw;
  while (isWordSplitSpan(cur) && cur.parentElement) cur = cur.parentElement;
  if (cur !== raw) return getInteresting(cur);

  // Walk out of SVG to the root SVG element
  if (raw.closest && raw.closest('svg')) {
    return raw.closest('svg');
  }

  var tag = (raw.tagName || '').toLowerCase();
  if (SKIP_TAGS[tag]) return null;

  // If rect is tiny (< 8x8), walk up one level to something visible
  try {
    var r = raw.getBoundingClientRect();
    if (r.width < 8 && r.height < 8 && raw.parentElement) {
      return getInteresting(raw.parentElement);
    }
  } catch(e) {}

  return raw;
}

// ── Elevate overlay layers and fill-media to their meaningful container ────
// Two patterns are handled:
//
// 1. Overlay divs  — position:absolute / position:fixed elements that fill
//    their parent completely (noise layers, gradient masks, scanline textures,
//    visual overlays, etc.).  These are decorative and the user intends to
//    target the whole component, not just the top layer.
//
// 2. Fill-media  — <img>, <video>, <canvas>, <picture> elements whose bounding
//    rect matches the parent container.  Clicking such an element means the
//    user wants to act on the whole visual block (image card, hero media area),
//    so we return the container so Remove / edits affect the entire component.
//
// Walk up as long as:
//   • the current element is an overlay (position:absolute/fixed)
//     OR a fill-media tag whose bounds equal the parent's (±5 px)
//   • the parent is not body / html
//   • the parent bounds are the same (overlay case uses ±2 px; media uses ±5 px)
//
// Result: the topmost container that shares the same footprint — the real
// "image block" / "card" / "banner" the user wanted to select or remove.
function elevateToContainer(el) {
  try {
    var FILL_MEDIA = { img:1, video:1, canvas:1, picture:1, iframe:1 };
    var cur = el;
    while (cur.parentElement) {
      var tag = (cur.tagName || '').toLowerCase();
      var cs  = window.getComputedStyle(cur);
      var pos = cs.position;

      var isOverlay = pos === 'absolute' || pos === 'fixed';
      var isMedia   = !!FILL_MEDIA[tag];
      if (!isOverlay && !isMedia) break;

      var parent = cur.parentElement;
      var ptag   = (parent.tagName || '').toLowerCase();
      if (ptag === 'body' || ptag === 'html') break;

      var cr  = cur.getBoundingClientRect();
      var pr  = parent.getBoundingClientRect();
      var tol = isMedia ? 5 : 2;
      if (Math.abs(pr.width - cr.width) <= tol && Math.abs(pr.height - cr.height) <= tol) {
        cur = parent;
      } else {
        break;
      }
    }
    return cur;
  } catch(e) { return el; }
}

// ── Lightweight rect-only update (scroll / RAF tracking) ─────────────────
// Uses 'track-update' type so the host updates the overlay/panel position
// WITHOUT triggering the re-click-to-deselect logic.
function sendRectUpdate(raw) {
  var el = getInteresting(raw);
  if (!el) return;
  try {
    var r = el.getBoundingClientRect();
    window.parent.postMessage({
      source: 'microsite-bridge',
      type: 'track-update',
      rect: { top: r.top, left: r.left, width: r.width, height: r.height }
    }, '*');
  } catch(e) {}
}

// ── Messaging ─────────────────────────────────────────────────────────────
function sendMsg(msgType, rawEl) {
  var el = getInteresting(rawEl);
  if (!el) return;

  // On click (select): elevate overlay layers to their actual container.
  // Only on select — getComputedStyle is expensive and would slow hover events.
  if (msgType === 'select') el = elevateToContainer(el);

  var rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;

  var tag = (el.tagName || '').toLowerCase();
  var label = makeLabel(el);
  var text = '';
  // On hover: truncate to 120 chars (breadcrumb display only).
  // On select: send full text so the inline editor can show and edit the complete content.
  try {
    var rawText = (el.textContent || '').replace(/\\s+/g,' ').trim();
    text = msgType === 'select' ? rawText : rawText.slice(0, 120);
  } catch(e) {}

  var outerHtml = '';
  try {
    outerHtml = msgType === 'select'
      ? (el.outerHTML || '').slice(0, 8192)
      : (el.outerHTML || '').slice(0, 400);
  } catch(e) {}

  // CSS path + computed styles only on 'select' — too expensive on every hover
  var path = '';
  var computedBgColor = '';
  var computedColor   = '';
  var sectionRect     = null;
  if (msgType === 'select') {
    try { path = getCssPath(el); } catch(e) {}
    try {
      var cs = window.getComputedStyle(el);
      computedBgColor = cs.backgroundColor || '';
      computedColor   = cs.color || '';
    } catch(e) {}
    // Walk up to find the nearest <section> and capture its bounding rect.
    // This lets the host compare element.rect vs sectionRect to decide whether
    // the selected element "fills" the section (used for "Remove Section" visibility).
    try {
      var secEl = el;
      while (secEl && secEl !== document.body) {
        if ((secEl.tagName || '').toLowerCase() === 'section') {
          var sr = secEl.getBoundingClientRect();
          if (sr.width > 0 && sr.height > 0) {
            sectionRect = { top: sr.top, left: sr.left, width: sr.width, height: sr.height };
          }
          break;
        }
        secEl = secEl.parentElement;
      }
    } catch(e) {}
  }

  window.parent.postMessage({
    source: 'microsite-bridge',
    type: msgType,
    tag: tag,
    label: label,
    text: text,
    sectionType: getSectionType(rawEl),
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    outerHtml: outerHtml,
    path: path,
    computedBgColor: computedBgColor,
    computedColor: computedColor,
    sectionRect: sectionRect
  }, '*');
}

// ── Selected element tracking (RAF loop for animated elements) ────────────
var selectedEl = null;
var trackRaf   = null;
var trackRect  = null;

function startTracking(raw) {
  var el = getInteresting(raw);
  if (!el) return;
  trackRect = null;
  if (trackRaf) cancelAnimationFrame(trackRaf);
  function tick() {
    if (selectedEl !== raw) { trackRaf = null; return; }
    var r = el.getBoundingClientRect();
    if (!trackRect ||
        Math.abs(r.left   - trackRect.left)   > 0.5 ||
        Math.abs(r.top    - trackRect.top)    > 0.5 ||
        Math.abs(r.width  - trackRect.width)  > 0.5 ||
        Math.abs(r.height - trackRect.height) > 0.5) {
      trackRect = { top: r.top, left: r.left, width: r.width, height: r.height };
      sendRectUpdate(raw);
    }
    trackRaf = requestAnimationFrame(tick);
  }
  trackRaf = requestAnimationFrame(tick);
}

// ── Event wiring ──────────────────────────────────────────────────────────
var lastHoverEl = null;
var rafPending  = false;

function scheduleHover(el) {
  lastHoverEl = el;
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(function () {
    rafPending = false;
    if (lastHoverEl) sendMsg('hover', lastHoverEl);
  });
}

document.addEventListener('mousemove', function (e) {
  var target = e.target;
  if (target === lastHoverEl) return;
  scheduleHover(target);
}, true);

document.addEventListener('mouseleave', function () {
  lastHoverEl = null;
  rafPending  = false;
  window.parent.postMessage({ source: 'microsite-bridge', type: 'leave' }, '*');
}, false);

document.addEventListener('click', function (e) {
  // In edit mode every click is a selection — prevent ALL default browser actions
  // so that buttons don't submit forms, anchors don't navigate or scroll, and
  // any inline onclick handlers that would cause location changes are neutralised.
  e.preventDefault();
  e.stopPropagation();
  selectedEl = e.target;
  sendMsg('select', e.target);
  startTracking(e.target);
}, true);

window.addEventListener('scroll', function () {
  if (selectedEl) sendRectUpdate(selectedEl);
  if (lastHoverEl) sendMsg('hover', lastHoverEl);
}, true);

window.addEventListener('resize', function () {
  if (selectedEl) sendMsg('select', selectedEl);
}, false);

// Host can send { source: 'microsite-host', type: 'deselect' } to clear
// the internal selection and stop the RAF tracking loop.
window.addEventListener('message', function (e) {
  if (e.data && e.data.source === 'microsite-host' && e.data.type === 'deselect') {
    selectedEl = null;
    lastHoverEl = null;
    if (trackRaf) { cancelAnimationFrame(trackRaf); trackRaf = null; }
  }
}, false);

})();
`;

export const BRIDGE_SCRIPT = `<script>${BRIDGE_SCRIPT_BODY}<\/script>`;

// In edit mode, iframes swallow all pointer events so the bridge never sees
// hover/click on them. Disable pointer-events on iframes so mouse events fall
// through to the parent document — making iframes selectable and deletable.
// In edit mode, make fixed-position navbars/headers sticky instead of fixed.
// Class-based position:fixed (e.g. #navbar { position:fixed }) is NOT covered by
// normalizeMicrositeHtml's inline-style selector, so fixed navbars keep their
// z-index stacking and intercept clicks intended for hero/section elements below.
// Forcing sticky keeps them visually at the top without creating an overlay.
const IFRAME_EDIT_STYLE = `<style id="__microsite-iframe-edit">
iframe{pointer-events:none!important;outline:2px dashed rgba(99,102,241,0.5);outline-offset:2px;}
nav,header,[class*="navbar"],[class*="nav-bar"],[class*="site-header"],[class*="top-bar"],[id*="navbar"],[id*="nav-bar"],[id*="header"]{position:sticky!important;top:0!important;}
/* Force scroll-reveal / GSAP / AOS animation initial states to be visible in edit mode.
   Microsites set opacity:0 or transform on elements waiting for scroll events that never
   fire in the srcdoc iframe — this ensures all content is visible while editing. */
[class*="reveal"],[class*="fade"],[class*="animate"],[class*="slide"],
[data-aos],[data-sal],[class*="aos-"],[class*="sal-"],[class*="gsap-"],
[class*="motion"],[class*="hidden"],[class*="invisible"],[class*="in-view"],
[class*="scroll-"],[class*="-anim"],[class*="anim-"]{
  opacity:1!important;
  transform:none!important;
  visibility:visible!important;
  clip-path:none!important;
}
</style>`;

export function injectBridgeScript(html: string): string {
  if (html.includes('microsite-bridge')) return html;
  // Inject iframe edit style into <head> so it applies before first paint
  let out = html;
  if (!out.includes('__microsite-iframe-edit')) {
    const headClose = out.indexOf('</head>');
    out = headClose !== -1
      ? out.slice(0, headClose) + IFRAME_EDIT_STYLE + out.slice(headClose)
      : IFRAME_EDIT_STYLE + out;
  }
  const idx = out.lastIndexOf('</body>');
  if (idx !== -1) return out.slice(0, idx) + BRIDGE_SCRIPT + out.slice(idx);
  return out + BRIDGE_SCRIPT;
}
