export interface BridgeMessage {
  source: 'microsite-bridge';
  type: 'hover' | 'select' | 'leave';
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
}

const REMOVAL_RE = /\b(remove|delete|hide|take\s+out|get\s+rid\s+of|eliminate|clear)\b/i;

// These prompts mention removing CONTENT inside an element (video, image, text, etc.)
// rather than the element itself — don't route them to __REMOVE_BY_PATH__.
const CONTENT_REMOVAL_RE = /\b(video|vimeo|youtube|iframe|background[\s-]video|video[\s-]background|image|logo|text|icon|button|link|badge|overlay)\b/i;

export function buildInstruction(selected: BridgeMessage | null, userText: string): string {
  if (!selected) return userText;

  // Removal → deterministic path, BUT only when the user means "remove this element",
  // not "remove something inside it" (e.g. "remove video from background" = content edit).
  if (REMOVAL_RE.test(userText) && !CONTENT_REMOVAL_RE.test(userText)) {
    if (selected.path) {
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
*,*::before,*::after{cursor:auto!important}
.cursor,.cursor-dot,.cursor-ring,.cursor-follower,.cursor-blob,
.custom-cursor,.mouse-cursor,.pointer-cursor,.cursor-inner,.cursor-outer,
[class*="cursor-"],[id*="cursor"],[class*="custom-cursor"]{display:none!important}
</style>`;

// Intercept hash-anchor clicks so they scroll within the srcDoc iframe instead of
// navigating away (clicking nav links like href="#section" would blank a srcDoc iframe
// because it has no real base URL).
const NAV_FIX_SCRIPT = `<script id="__nav-anchor-fix">document.addEventListener('click',function(e){var a=e.target.closest('a[href^="#"]');if(!a)return;e.preventDefault();var href=a.getAttribute('href');if(!href||href==='#')return;var id=href.slice(1);var el=document.getElementById(id)||document.querySelector('[name="'+id+'"]');if(el)el.scrollIntoView({behavior:'smooth'});},true);</script>`;

export function normalizeMicrositeHtml(html: string): string {
  if (!html) return html;
  // Both injections use idempotent guards so re-calling is safe.
  let out = html;
  if (!out.includes('__preview-cursor-reset')) {
    const headClose = out.indexOf('</head>');
    out = headClose !== -1
      ? out.slice(0, headClose) + CURSOR_RESET_CSS + out.slice(headClose)
      : CURSOR_RESET_CSS + out;
  }
  if (!out.includes('__nav-anchor-fix')) {
    const bodyOpen = out.search(/<body[^>]*>/i);
    if (bodyOpen !== -1) {
      const tagEnd = out.indexOf('>', bodyOpen) + 1;
      out = out.slice(0, tagEnd) + NAV_FIX_SCRIPT + out.slice(tagEnd);
    } else {
      out = NAV_FIX_SCRIPT + out;
    }
  }
  return out;
}

// ── Bridge script (injected into the srcdoc iframe in edit mode) ────────────
const BRIDGE_SCRIPT_BODY = /* javascript */ `
(function () {
'use strict';

// ── Skip list: elements we never select ──────────────────────────────────
var SKIP_TAGS = { html:1, body:1, head:1, script:1, style:1, meta:1, link:1, title:1 };

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

    // Append most specific (longest) class that's meaningful
    var classes = (typeof cur.className === 'string' ? cur.className : '')
      .trim().split(/\\s+/).filter(function(c){ return c.length > 1; });
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

// ── Messaging ─────────────────────────────────────────────────────────────
function sendMsg(msgType, rawEl) {
  var el = getInteresting(rawEl);
  if (!el) return;

  var rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;

  var tag = (el.tagName || '').toLowerCase();
  var label = makeLabel(el);
  var text = '';
  try { text = (el.textContent || '').replace(/\\s+/g,' ').trim().slice(0, 120); } catch(e) {}

  var outerHtml = '';
  try {
    outerHtml = msgType === 'select'
      ? (el.outerHTML || '').slice(0, 8192)
      : (el.outerHTML || '').slice(0, 400);
  } catch(e) {}

  // CSS path only on 'select' — too expensive to compute on every hover
  var path = '';
  if (msgType === 'select') {
    try { path = getCssPath(el); } catch(e) {}
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
    path: path
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
      sendMsg('select', raw);
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
  // Prevent link navigation for any click on or inside an <a> element.
  // Without this, clicking a child (e.g. an <img> inside a.nav-brand) lets the
  // anchor's href="#" execute, which blanks the srcdoc iframe.
  if (e.target) {
    var tgt = e.target;
    var isAnchor = tgt.tagName && tgt.tagName.toLowerCase() === 'a';
    var inAnchor = !isAnchor && tgt.closest && tgt.closest('a');
    if (isAnchor || inAnchor) e.preventDefault();
  }
  selectedEl = e.target;
  sendMsg('select', e.target);
  startTracking(e.target);
}, true);

window.addEventListener('scroll', function () {
  if (selectedEl) sendMsg('select', selectedEl);
  if (lastHoverEl) sendMsg('hover', lastHoverEl);
}, true);

window.addEventListener('resize', function () {
  if (selectedEl) sendMsg('select', selectedEl);
}, false);

})();
`;

export const BRIDGE_SCRIPT = `<script>${BRIDGE_SCRIPT_BODY}<\/script>`;

// In edit mode, iframes swallow all pointer events so the bridge never sees
// hover/click on them. Disable pointer-events on iframes so mouse events fall
// through to the parent document — making iframes selectable and deletable.
const IFRAME_EDIT_STYLE = `<style id="__microsite-iframe-edit">iframe{pointer-events:none!important;outline:2px dashed rgba(99,102,241,0.5);outline-offset:2px;}</style>`;

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
