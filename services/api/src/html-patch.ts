// Deterministic HTML patch operations — no LLM required.
// Used by both the microsite and slide edit routes for InlineEditPanel actions.
//
// patchHtml(html, instruction) returns:
//   { html, summary }            — patch applied successfully
//   { error, statusCode }        — patch attempted but failed (element not found, bad params)
//   null                         — instruction is not a deterministic op (fall through to LLM)

export type PatchResult =
  | { html: string; summary: string }
  | { error: string; statusCode: number };

// ── Hide a covering <img> when a solid background color is applied ───────────
// A background-color set on an element whose visible area is filled by a
// full-bleed <img> (the standard "photo as section background" pattern) paints
// underneath that opaque photo and is never visible. Whenever a background
// color/gradient is applied, hide any <img> starting within the element's
// first ~3000 chars (mirrors the scope __REMOVE_BACKGROUND__ already uses) so
// the new color actually shows.
export function hideCoveringImage(src: string, elementStart: number): string {
  const inner = src.slice(elementStart, elementStart + 3000);
  const imgRe = /(<img\b)([^>]*)(\/?>)/gi;
  return src.replace(imgRe, (match, open, attrs, close) => {
    if (!inner.includes((open + attrs).slice(0, 60))) return match;
    if (/\bdisplay\s*:\s*none\b/i.test(attrs)) return match;
    const styleM = attrs.match(/\bstyle="([^"]*)"/i);
    if (styleM) return match.replace(/\bstyle="([^"]*)"/i, `style="${styleM[1].trim()};display:none"`);
    return `${open}${attrs} style="display:none"${close}`;
  });
}

// ── Video URL → embed URL normalization ───────────────────────────────────────
// Watch-page URLs (youtube.com/watch, youtu.be, vimeo.com/ID) refuse to load in
// iframes (X-Frame-Options) — convert to the embeddable player URL. Non-video or
// already-embed URLs pass through unchanged.
export function toVideoEmbedUrl(raw: string): string {
  const vimeoM = raw.match(/^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)([?&]\S*)?/i);
  if (vimeoM) {
    const params = vimeoM[2] ?? '?autoplay=1&loop=1&muted=1&title=0&byline=0&portrait=0';
    return `https://player.vimeo.com/video/${vimeoM[1]}${params}`;
  }
  const ytW = raw.match(/youtube\.com\/watch\?.*\bv=([a-zA-Z0-9_-]{11})/i);
  if (ytW) return `https://www.youtube.com/embed/${ytW[1]}?autoplay=1&loop=1&mute=1&controls=0&playlist=${ytW[1]}`;
  const ytS = raw.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i);
  if (ytS) return `https://www.youtube.com/embed/${ytS[1]}?autoplay=1&loop=1&mute=1&controls=0&playlist=${ytS[1]}`;
  return raw;
}

// ── Position-based element finder ─────────────────────────────────────────────
// Traverses the HTML string using a CSS path with nth-of-type indices.
// Position-based so browser attribute normalisation never causes mismatches.
export function findByPath(src: string, path: string): { start: number; end: number } | null {
  const VOID = new Set(['area','base','br','col','embed','hr','img','input',
                        'link','meta','param','source','track','wbr']);
  const parts = path.trim().split(/\s*>\s*/);
  let searchFrom = 0;
  let searchTo   = src.length;

  // Advance pos past an element's closing tag, respecting nesting depth.
  const skipPast = (tagName: string, opening: string, tagEnd: number): number => {
    if (VOID.has(tagName) || opening.trimEnd().endsWith('/>')) return tagEnd + 1;
    const close = `</${tagName}>`;
    let d = 1, j = tagEnd + 1;
    while (j < src.length && d > 0) {
      const nO = src.indexOf(`<${tagName}`, j);
      const nC = src.indexOf(close, j);
      if (nC === -1) break;
      if (nO !== -1 && nO < nC) { d++; j = nO + tagName.length + 1; }
      else { d--; j = nC + close.length; }
    }
    return j;
  };

  for (let i = 0; i < parts.length; i++) {
    const part   = parts[i].trim();
    const tag    = part.match(/^(\w+)/)?.[1];
    if (!tag) return null;

    const idVal  = part.match(/#([\w-]+)/)?.[1] ?? null;
    const clsVal = part.match(/\.([\w-]+)/)?.[1] ?? null;
    const nth    = parseInt(part.match(/:nth-of-type\((\d+)\)/)?.[1] ?? '1', 10);
    const isLast = i === parts.length - 1;

    let count = 0, pos = searchFrom, foundStart = -1, foundEnd = -1;

    // Walk direct children only: skip over entire sibling elements so nested
    // occurrences of `tag` are never counted as if they were direct children.
    while (pos < searchTo) {
      const lt = src.indexOf('<', pos);
      if (lt === -1 || lt >= searchTo) break;

      // Closing tag at depth 0 — stop (malformed HTML guard)
      if (src[lt + 1] === '/') { pos = lt + 1; continue; }

      const te = src.indexOf('>', lt);
      if (te === -1) break;
      const opening = src.slice(lt, te + 1);
      const curTag  = opening.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? '';
      if (!curTag) { pos = lt + 1; continue; }

      if (curTag === tag) {
        const mId  = !idVal  || opening.includes(`id="${idVal}"`);
        const mCls = !clsVal || (opening.match(/\bclass="([^"]+)"/)?.[1] ?? '')
                                  .split(/\s+/).includes(clsVal);
        if (mId && mCls) {
          count++;
          if (count === nth) {
            foundStart = lt;
            foundEnd   = skipPast(tag, opening, te);
            break;
          }
        }
        // Skip past this element (match or not) so nested same-tag siblings
        // inside it are not counted as direct children.
        pos = skipPast(curTag, opening, te);
      } else {
        // Different element — skip entirely to avoid counting target tags nested inside it.
        pos = skipPast(curTag, opening, te);
      }
    }

    if (foundStart === -1) return null;
    if (isLast) return { start: foundStart, end: foundEnd };

    const tagEnd = src.indexOf('>', foundStart);
    searchFrom = tagEnd + 1;
    searchTo   = foundEnd;
  }

  return null;
}

// ── Multi-strategy element locator ────────────────────────────────────────────
export function locateElement(src: string, snippet: string): number {
  const openTag = snippet.match(/^<(\w+)/)?.[1] ?? '';

  let idx = src.indexOf(snippet.slice(0, 200));
  if (idx !== -1) return idx;

  const idVal = snippet.match(/\bid="([^"]+)"/)?.[1];
  if (idVal) {
    idx = src.indexOf(`id="${idVal}"`);
    if (idx !== -1) { let s = idx; while (s > 0 && src[s] !== '<') s--; return s; }
  }

  if (['img', 'video', 'source', 'iframe'].includes(openTag)) {
    const rawSrcVal = snippet.match(/\bsrc="([^"]+)"/)?.[1];
    const srcVal = rawSrcVal ? rawSrcVal.replace(/&amp;/gi, '&') : undefined;
    if (srcVal) {
      idx = src.indexOf(`src="${srcVal}"`);
      if (idx !== -1) { let s = idx; while (s > 0 && src[s] !== '<') s--; return s; }
    }
  }

  const classStr = snippet.match(/\bclass="([^"]+)"/)?.[1] ?? '';
  const classes  = classStr.trim().split(/\s+/).filter(Boolean);
  const bestClass = classes.sort((a, b) => b.length - a.length).find(c => c.length > 2);
  if (bestClass && openTag) {
    let pos = 0;
    while (pos < src.length) {
      const ti = src.indexOf(`<${openTag}`, pos);
      if (ti === -1) break;
      const te = src.indexOf('>', ti);
      if (te === -1) break;
      const opening = src.slice(ti, te + 1);
      const elClasses = (opening.match(/\bclass="([^"]+)"/)?.[1] ?? '').split(/\s+/);
      if (elClasses.includes(bestClass)) return ti;
      pos = ti + 1;
    }
  }

  if (openTag) {
    const extractNonStyle = (tag: string) =>
      [...tag.matchAll(/\b(?!style\b)(\w[\w-]*)="([^"]*)"/g)]
        .map(m => `${m[1]}="${m[2]}"`)
        .sort()
        .join(' ');
    const snippetAttrs = extractNonStyle(snippet.slice(0, 300));
    let pos = 0;
    while (pos < src.length) {
      const ti = src.indexOf(`<${openTag}`, pos);
      if (ti === -1) break;
      const te = src.indexOf('>', ti);
      if (te === -1) break;
      if (extractNonStyle(src.slice(ti, te + 1)) === snippetAttrs) return ti;
      pos = ti + 1;
    }
  }

  return -1;
}

// ── Main deterministic patch dispatcher ───────────────────────────────────────
export function patchHtml(html: string, instruction: string): PatchResult | null {

  // ── __STYLE_PATCH__ ──────────────────────────────────────────────────────────
  const stylePatchMatch = instruction.match(/^__STYLE_PATCH__:([\s\S]+?)\|\|([\w-]+)\|\|([\s\S]+?)(?:\|\|([\s\S]*))?$/s);
  if (stylePatchMatch) {
    const cssPath  = stylePatchMatch[1].trim();
    const prop     = stylePatchMatch[2].trim().toLowerCase();
    const rawValue = stylePatchMatch[3].trim();
    const hintHtml = (stylePatchMatch[4] ?? '').trim();

    const ALLOWED = new Set([
      'color', 'background-color', 'background-image', 'background',
      'font-size', 'font-family', 'font-weight', 'font-style',
      'opacity', 'border-radius', 'text-align', 'letter-spacing', 'line-height',
    ]);
    if (!ALLOWED.has(prop)) return { error: `Property "${prop}" is not patchable`, statusCode: 400 };

    const value = rawValue.replace(/[;'"<>]/g, '').trim().slice(0, 120);
    if (!value) return { error: 'Empty style value', statusCode: 400 };

    let bounds = findByPath(html, cssPath);
    if (!bounds && hintHtml) {
      const hs = locateElement(html, hintHtml);
      if (hs !== -1) {
        const ht = html.indexOf('>', hs);
        if (ht !== -1) bounds = { start: hs, end: ht + 1 };
      }
    }
    if (!bounds) return { error: 'Target element not found — click it again to re-select', statusCode: 422 };

    const elementHtml = html.slice(bounds.start, bounds.end);
    const tagEnd = elementHtml.indexOf('>');
    if (tagEnd === -1) return { error: 'Malformed element', statusCode: 422 };

    const openTag = elementHtml.slice(0, tagEnd);
    const rest    = elementHtml.slice(tagEnd);
    const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
    const sm = styleRx.exec(openTag);
    const clearBgImage = prop === 'background-color' || prop === 'background';
    let patchedTag: string;
    if (sm) {
      const escaped = prop.replace(/-/g, '\\-');
      let existing = sm[1].replace(new RegExp(`\\b${escaped}\\s*:[^;]+;?\\s*`, 'gi'), '').trim().replace(/;$/, '');
      if (clearBgImage) existing = existing.replace(/background-image\s*:[^;]+;?\s*/gi, '').trim().replace(/;$/, '');
      const extra = clearBgImage ? '; background-image:none !important' : '';
      patchedTag = openTag.replace(styleRx, `style="${existing ? existing + '; ' : ''}${prop}:${value}${extra}"`);
    } else {
      const extra = clearBgImage ? '; background-image:none !important' : '';
      patchedTag = `${openTag} style="${prop}:${value}${extra}"`;
    }
    let updatedHtml = html.slice(0, bounds.start) + patchedTag + rest + html.slice(bounds.end);
    // A covering <img> would otherwise hide the new solid color underneath it.
    if (clearBgImage) updatedHtml = hideCoveringImage(updatedHtml, bounds.start);
    return { html: updatedHtml, summary: `${prop} set to ${value}` };
  }

  // ── __TEXT_PATCH__ ───────────────────────────────────────────────────────────
  const textPatchMatch = instruction.match(/^__TEXT_PATCH__:([\s\S]+?)\|\|([\s\S]+?)(?:\|\|([\s\S]*))?$/s);
  if (textPatchMatch) {
    const cssPath  = textPatchMatch[1].trim();
    const newText  = textPatchMatch[2].trim().slice(0, 2000);
    const hintHtml = (textPatchMatch[3] ?? '').trim();

    let bounds = findByPath(html, cssPath);

    if (!bounds && hintHtml) {
      const hintStart = locateElement(html, hintHtml);
      if (hintStart !== -1) {
        const tagName = hintHtml.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? '';
        if (tagName) {
          const tagEnd = html.indexOf('>', hintStart);
          if (tagEnd !== -1) {
            const close = `</${tagName}>`;
            let depth = 1, j = tagEnd + 1;
            while (j < html.length && depth > 0) {
              const nO = html.indexOf(`<${tagName}`, j);
              const nC = html.indexOf(close, j);
              if (nC === -1) break;
              if (nO !== -1 && nO < nC) { depth++; j = nO + tagName.length + 1; }
              else { depth--; j = nC + close.length; }
            }
            bounds = { start: hintStart, end: j };
          }
        }
      }
    }

    if (!bounds) return { error: 'Target element not found — click it again to re-select', statusCode: 422 };

    const elementHtml   = html.slice(bounds.start, bounds.end);
    const openTagMatch  = elementHtml.match(/^(<[^>]+>)/);
    const closeTagMatch = elementHtml.match(/<\/(\w+)>\s*$/);
    if (!openTagMatch || !closeTagMatch) return { error: 'Element is not a paired tag', statusCode: 422 };

    const openTag  = openTagMatch[1];
    const closeTag = `</${closeTagMatch[1]}>`;
    const innerHtml = elementHtml.slice(openTag.length, elementHtml.lastIndexOf(closeTag));
    const hasChildren = /<\w/.test(innerHtml);
    // Replace only the leading text run (the part with no element wrapper of its
    // own — the only part a plain text-edit input can ever mean). Leave every
    // child element and its own text content completely untouched: stripping
    // "inter-tag" text globally here used to wipe out sibling elements' text too
    // (e.g. a <span> holding a second line of a two-line headline), silently
    // destroying content the user never asked to change.
    const newInner = hasChildren
      ? newText + innerHtml.replace(/^[^<]+/, '')
      : newText;

    return { html: html.slice(0, bounds.start) + openTag + newInner + closeTag + html.slice(bounds.end), summary: 'Text updated' };
  }

  // ── __BG_IMAGE_PATCH__ ───────────────────────────────────────────────────────
  const bgImagePatchMatch = instruction.match(/^__BG_IMAGE_PATCH__:([\s\S]+?)\|\|((?:https?:\/\/|data:)[^\|]+)(?:\|\|[\s\S]*)?$/s);
  if (bgImagePatchMatch) {
    const cssPath = bgImagePatchMatch[1].trim();
    const imgUrl  = bgImagePatchMatch[2].trim().replace(/['"<>]/g, (c) => bgImagePatchMatch[2].startsWith('data:') ? c : '');

    const bounds = findByPath(html, cssPath);
    if (!bounds) return { error: 'Target element not found — click it again to re-select', statusCode: 422 };

    const elementHtml = html.slice(bounds.start, bounds.end);

    const sectionId = cssPath.match(/#([\w-]+)/)?.[1] ?? '';
    if (sectionId) {
      const esc = sectionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patchedHtml = html.replace(
        /([^{}]+)\{([^}]*\bbackground-image\s*:\s*url\([^)]*\)[^}]*)\}/gi,
        (match, selector, body) => {
          if (!new RegExp(`\\b${esc}\\b`, 'i').test(selector)) return match;
          return `${selector}{${body.replace(/\bbackground-image\s*:\s*url\([^)]*\)/gi, `background-image:url('${imgUrl}')`)}}`;
        },
      );
      if (patchedHtml !== html) return { html: patchedHtml, summary: 'Background image updated' };
    }

    const bgReplaceRe = /\bbackground-image\s*:\s*url\([^)]*\)/gi;
    if (bgReplaceRe.test(elementHtml)) {
      return {
        html: html.slice(0, bounds.start) + elementHtml.replace(bgReplaceRe, `background-image:url('${imgUrl}')`) + html.slice(bounds.end),
        summary: 'Background image updated',
      };
    }

    const tagEnd = elementHtml.indexOf('>');
    if (tagEnd === -1) return { error: 'Malformed element', statusCode: 422 };
    const openTag = elementHtml.slice(0, tagEnd);
    const rest    = elementHtml.slice(tagEnd);
    const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
    const sm = styleRx.exec(openTag);
    const bgVal = `background-image:url('${imgUrl}') !important;background-size:cover !important;background-position:center !important`;
    let patchedTag: string;
    if (sm) {
      const existing = sm[1]
        .replace(/\bbackground-image\s*:\s*(?:url\([^)]*\)|[^;]*)\s*;?\s*/gi, '')
        .replace(/\bbackground-size\s*:[^;]+;?\s*/gi, '')
        .replace(/\bbackground-position\s*:[^;]+;?\s*/gi, '')
        .trim().replace(/;$/, '');
      patchedTag = openTag.replace(styleRx, `style="${existing ? existing + ';' : ''}${bgVal}"`);
    } else {
      patchedTag = `${openTag} style="${bgVal}"`;
    }
    return { html: html.slice(0, bounds.start) + patchedTag + rest + html.slice(bounds.end), summary: 'Background image updated' };
  }

  // ── __IMAGE_INJECT_SCOPED__ ──────────────────────────────────────────────────
  const scopedImageMatch = instruction.match(/^__IMAGE_INJECT_SCOPED__:([\s\S]+?)\|\|((?:https?:\/\/|data:)[^\|]+)(?:\|\|([\s\S]*))?$/s);
  if (scopedImageMatch) {
    const cssPath  = scopedImageMatch[1].trim();
    const newUrl   = scopedImageMatch[2].trim();
    const hintHtml = (scopedImageMatch[3] ?? '').trim();

    const injectImageInto = (target: string): string => {
      let out = target.replace(/\bbackground-image\s*:\s*url\(\s*['"]?[^'")\s]+['"]?\s*\)/gi, () => `background-image: url('${newUrl}')`);
      if (out !== target) return out;
      out = target.replace(/(<img\b[^>]*?\bsrc=["'])([^'"]+)(["'])/i, (_m, pre, _old, post) => `${pre}${newUrl}${post}`);
      if (out !== target) return out;
      out = target.replace(/\bdata-bg=["'][^'"]*["']/gi, () => `data-bg="${newUrl}"`);
      if (out !== target) return out;
      // data-src lazy-load: JS copies it into src at runtime, so the browser DOM
      // shows an <img src> that the stored HTML doesn't have
      out = target.replace(/(<img\b[^>]*?\bdata-src=["'])([^'"]+)(["'])/i, (_m, pre, _old, post) => `${pre}${newUrl}${post}`);
      return out;
    };
    const patchSrcOnElement = (target: string): string => {
      const patched = target.replace(/(<img\b[^>]*?\bsrc=["'])([^'"]+)(["'])/i, (_m, pre, _old, post) => `${pre}${newUrl}${post}`);
      if (patched !== target) return patched;
      return target.replace(/(\bsrc=["'])([^'"]+)(["'])/i, (_m, pre, _old, post) => `${pre}${newUrl}${post}`);
    };

    const bounds = findByPath(html, cssPath);
    if (bounds) {
      const elementHtml = html.slice(bounds.start, bounds.end);
      const elTag = elementHtml.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? '';
      if (['img','source','input','video','audio'].includes(elTag)) {
        const patched = patchSrcOnElement(elementHtml);
        if (patched !== elementHtml) return { html: html.slice(0, bounds.start) + patched + html.slice(bounds.end), summary: 'Image updated' };
      }
      const modifiedEl = injectImageInto(elementHtml);
      if (modifiedEl !== elementHtml) return { html: html.slice(0, bounds.start) + modifiedEl + html.slice(bounds.end), summary: 'Image updated' };

      const pathParts = cssPath.split(/\s*>\s*/).filter(Boolean);
      for (let i = pathParts.length - 1; i >= 1; i--) {
        const ancestorBounds = findByPath(html, pathParts.slice(0, i).join(' > '));
        if (!ancestorBounds) continue;
        const ancestorHtml = html.slice(ancestorBounds.start, ancestorBounds.end);
        const modifiedAncestor = injectImageInto(ancestorHtml);
        if (modifiedAncestor !== ancestorHtml) return { html: html.slice(0, ancestorBounds.start) + modifiedAncestor + html.slice(ancestorBounds.end), summary: 'Image updated' };
      }

      const classAttr = elementHtml.match(/\bclass="([^"]+)"/i)?.[1] ?? '';
      const idAttr    = elementHtml.match(/\bid="([^"]+)"/i)?.[1] ?? '';
      for (const name of [...classAttr.trim().split(/\s+/).filter(Boolean), ...(idAttr ? [idAttr] : [])]) {
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patched = html.replace(new RegExp(`((?:\\.|#)${esc}\\b[^{]*\\{[^}]*)background-image\\s*:\\s*url\\([^)]+\\)`, 'gi'), `$1background-image: url('${newUrl}')`);
        if (patched !== html) return { html: patched, summary: 'Image updated' };
      }
    }

    if (hintHtml) {
      const hintStart = locateElement(html, hintHtml);
      if (hintStart !== -1) {
        const hintTagEnd = html.indexOf('>', hintStart);
        if (hintTagEnd !== -1) {
          const opening = html.slice(hintStart, hintTagEnd + 1);
          const patched = patchSrcOnElement(opening);
          if (patched !== opening) return { html: html.slice(0, hintStart) + patched + html.slice(hintTagEnd + 1), summary: 'Image updated' };
          const modifiedEl = injectImageInto(opening);
          if (modifiedEl !== opening) return { html: html.slice(0, hintStart) + modifiedEl + html.slice(hintTagEnd + 1), summary: 'Image updated' };
        }
      }
      const rawHintSrc = hintHtml.match(/\bsrc="([^"]+)"/i)?.[1];
      const oldSrc = rawHintSrc ? rawHintSrc.replace(/&amp;/gi, '&') : undefined;
      if (oldSrc && oldSrc !== newUrl) {
        const escapedSrc = oldSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const imgRe = new RegExp(`(<img\\b[^>]*?\\bsrc=")${escapedSrc}("[^>]*>)`, 'i');
        const patched = html.replace(imgRe, `$1${newUrl}$2`);
        if (patched !== html) return { html: patched, summary: 'Image updated' };
      }
    }

    // Graceful fallback: element located but holds no replaceable image reference
    // in the stored HTML (its visible image may be injected by JS at runtime, or
    // it never had one). Apply the image as a cover background on the element
    // itself instead of dead-ending with an error.
    if (bounds) {
      const elementHtml = html.slice(bounds.start, bounds.end);
      const tagEnd = elementHtml.indexOf('>');
      if (tagEnd !== -1) {
        const openTag = elementHtml.slice(0, tagEnd);
        const rest    = elementHtml.slice(tagEnd);
        const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
        const sm      = styleRx.exec(openTag);
        const bgVal   = `background-image:url('${newUrl}') !important;background-size:cover !important;background-position:center !important`;
        let patchedTag: string;
        if (sm) {
          const existing = sm[1]
            .replace(/\bbackground-image\s*:\s*(?:url\([^)]*\)|[^;]*)\s*;?\s*/gi, '')
            .replace(/\bbackground-size\s*:[^;]+;?\s*/gi, '')
            .replace(/\bbackground-position\s*:[^;]+;?\s*/gi, '')
            .trim().replace(/;$/, '');
          patchedTag = openTag.replace(styleRx, `style="${existing ? existing + ';' : ''}${bgVal}"`);
        } else {
          patchedTag = `${openTag} style="${bgVal}"`;
        }
        return { html: html.slice(0, bounds.start) + patchedTag + rest + html.slice(bounds.end), summary: 'Image applied as background' };
      }
    }

    return { error: 'Could not locate the selected image — click the image again to re-select it', statusCode: 422 };
  }

  // ── __VIDEO_INJECT__ ─────────────────────────────────────────────────────────
  // Replaces the iframe/video src inside the selected container with a new video
  // URL (normalized to embed format). Returns null when the element contains no
  // iframe/video — the LLM fallback then handles structural insertion.
  const videoInjectMatch = instruction.match(/^__VIDEO_INJECT__:([\s\S]+?)\|\|(https?:\/\/[^\|]+)(?:\|\|[\s\S]*)?$/s);
  if (videoInjectMatch) {
    const cssPath = videoInjectMatch[1].trim();
    const newSrc  = toVideoEmbedUrl(videoInjectMatch[2].trim());

    const patchVideoSrc = (target: string): string => {
      const iframePatched = target.replace(
        /(<iframe\b[^>]*?\bsrc=["'])([^'"]+)(["'])/i,
        (_m, pre, _old, post) => `${pre}${newSrc}${post}`,
      );
      if (iframePatched !== target) return iframePatched;
      return target.replace(
        /(<video\b[^>]*?\bsrc=["'])([^'"]+)(["'])/i,
        (_m, pre, _old, post) => `${pre}${newSrc}${post}`,
      );
    };

    const bounds = findByPath(html, cssPath);
    if (bounds) {
      const elementHtml = html.slice(bounds.start, bounds.end);
      const patched = patchVideoSrc(elementHtml);
      if (patched !== elementHtml) {
        return { html: html.slice(0, bounds.start) + patched + html.slice(bounds.end), summary: 'Video updated' };
      }
      // Element located but holds no player — let the LLM do the structural
      // insertion. Patching some OTHER element's iframe would silently edit
      // the wrong slide.
      return null;
    }
    // Path lookup failed entirely — fall back to the first video iframe in the document
    const globalPatched = patchVideoSrc(html);
    if (globalPatched !== html) return { html: globalPatched, summary: 'Video updated' };
    return null; // no existing player — let the LLM insert one
  }

  // ── __REMOVE_BY_PATH__ ───────────────────────────────────────────────────────
  const removeByPathMatch = instruction.match(/^__REMOVE_BY_PATH__:([\s\S]+?)(?:\|\|([\s\S]*))?$/);
  if (removeByPathMatch) {
    const cssPath  = removeByPathMatch[1].trim();
    const hintHtml = (removeByPathMatch[2] ?? '').trim();
    let bounds = findByPath(html, cssPath);

    if (!bounds && hintHtml) {
      const hintStart = locateElement(html, hintHtml);
      if (hintStart !== -1) {
        const tagName = hintHtml.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? '';
        const VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
        let end: number;
        if (VOID_TAGS.has(tagName) || hintHtml.trimEnd().endsWith('/>')) {
          end = html.indexOf('>', hintStart) + 1;
        } else {
          const close = `</${tagName}>`;
          let depth = 1, j = html.indexOf('>', hintStart) + 1;
          while (j < html.length && depth > 0) {
            const nO = html.indexOf(`<${tagName}`, j);
            const nC = html.indexOf(close, j);
            if (nC === -1) break;
            if (nO !== -1 && nO < nC) { depth++; j = nO + tagName.length + 1; }
            else { depth--; j = nC + close.length; }
          }
          end = j;
        }
        if (end > hintStart) bounds = { start: hintStart, end };
      }
    }

    if (!bounds) return { error: 'Element not found — click it again to retry', statusCode: 422 };
    const updatedHtml = html.slice(0, bounds.start) + html.slice(bounds.end);
    if (updatedHtml === html) return { error: 'Element removal produced no change', statusCode: 422 };
    return { html: updatedHtml, summary: 'Element removed' };
  }

  // ── __REMOVE_ELEMENT__ ───────────────────────────────────────────────────────
  const removeMatch = instruction.match(/^__REMOVE_ELEMENT__:([\s\S]+)$/);
  if (removeMatch) {
    const snippet = removeMatch[1];
    const openTag = snippet.match(/^<(\w+)/)?.[1] ?? '';
    const start   = locateElement(html, snippet);
    if (start === -1) return { error: 'Could not locate that element — click it again and retry', statusCode: 422 };

    const VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    let updatedHtml = html;
    if (openTag) {
      const tagEnd = html.indexOf('>', start);
      if (tagEnd === -1) return { error: 'Malformed element', statusCode: 422 };
      const isSelfClose = html[tagEnd - 1] === '/' || VOID_TAGS.has(openTag);
      if (isSelfClose) {
        updatedHtml = html.slice(0, start) + html.slice(tagEnd + 1);
      } else {
        const closeTag = `</${openTag}>`;
        let depth = 1, i = tagEnd + 1;
        while (i < html.length && depth > 0) {
          const nextOpen  = html.indexOf(`<${openTag}`, i);
          const nextClose = html.indexOf(closeTag, i);
          if (nextClose === -1) break;
          if (nextOpen !== -1 && nextOpen < nextClose) { depth++; i = nextOpen + openTag.length + 1; }
          else { depth--; i = nextClose + closeTag.length; }
        }
        updatedHtml = html.slice(0, start) + html.slice(i);
      }
    } else {
      updatedHtml = html.replace(snippet, '');
    }

    if (updatedHtml !== html) return { html: updatedHtml, summary: 'Element removed' };
    return { error: 'Element removal produced no change — try rephrasing', statusCode: 422 };
  }

  // ── __REMOVE_BACKGROUND__ ────────────────────────────────────────────────────
  const removeBgMatch = instruction.match(/^__REMOVE_BACKGROUND__:([\s\S]+)$/);
  if (removeBgMatch) {
    const cssPath = removeBgMatch[1].trim();
    const bounds  = findByPath(html, cssPath);
    if (!bounds) return { error: 'Element not found — click it again to re-select', statusCode: 422 };

    function clearBgFromElement(src: string, b: { start: number; end: number }): string {
      const elHtml = src.slice(b.start, b.end);
      const tagEnd = elHtml.indexOf('>');
      if (tagEnd === -1) return src;
      const openTag = elHtml.slice(0, tagEnd);
      const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
      const sm = styleRx.exec(openTag);
      let patchedOpen: string;
      if (sm) {
        const stripped = sm[1].replace(/\bbackground(?:-image|-color|-position|-size|-repeat|-attachment|-clip|-origin|-blend-mode)?\s*:[^;]+;?\s*/gi, '').trim().replace(/;$/, '');
        patchedOpen = openTag.replace(styleRx, `style="${stripped ? stripped + ';' : ''}background:none;background-image:none"`);
      } else {
        patchedOpen = `${openTag} style="background:none;background-image:none"`;
      }
      const classMatch = elHtml.match(/\bclass="([^"]+)"/i);
      let result = src.slice(0, b.start) + patchedOpen + elHtml.slice(tagEnd) + src.slice(b.end);
      if (classMatch) {
        const firstCls = classMatch[1].trim().split(/\s+/).find(c => c.length > 1);
        if (firstCls) {
          const clsRe = new RegExp(`(\\.${firstCls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:,[^{]*)?\\{[^}]*)background(?:-image|-color|-position|-size|-repeat|-attachment|-clip|-origin)?\\s*:[^;]+;?\\s*`, 'gi');
          result = result.replace(clsRe, '$1');
        }
      }
      return hideCoveringImage(result, b.start);
    }

    let updated = clearBgFromElement(html, bounds);
    const parentPath = cssPath.split(/\s*>\s*/).slice(0, -1).join(' > ');
    if (parentPath) {
      const parentBounds = findByPath(updated, parentPath);
      if (parentBounds) updated = clearBgFromElement(updated, parentBounds);
    }

    if (updated === html) return { error: 'No background found on this element or its parent', statusCode: 422 };
    return { html: updated, summary: 'Background removed' };
  }

  // ── __SVG_REPLACE__ ──────────────────────────────────────────────────────────
  const svgReplaceMatch = instruction.match(/^__SVG_REPLACE__:([\s\S]+?)\|\|([\s\S]+)$/s);
  if (svgReplaceMatch) {
    const cssPath = svgReplaceMatch[1].trim();
    let svgMarkup = svgReplaceMatch[2].trim();
    if (!svgMarkup.startsWith('<svg')) return { error: 'Payload must be an SVG element', statusCode: 400 };
    const bounds = findByPath(html, cssPath);
    if (!bounds) return { error: 'Target element not found — click it again to re-select', statusCode: 422 };
    const originalHtml = html.slice(bounds.start, bounds.end);
    const cls   = originalHtml.match(/\bclass="([^"]+)"/i)?.[1] ?? '';
    const style = originalHtml.match(/\bstyle="([^"]+)"/i)?.[1] ?? '';
    svgMarkup = svgMarkup.replace(/^<svg\b/, `<svg${cls ? ` class="${cls}"` : ''}${style ? ` style="${style}"` : ''}`);
    svgMarkup = svgMarkup.replace(/(<svg[^>]*)\bclass="[^"]*"\s*class="[^"]*"/, '$1');
    return { html: html.slice(0, bounds.start) + svgMarkup + html.slice(bounds.end), summary: 'Icon replaced' };
  }

  // ── __ICON_REPLACE__ ─────────────────────────────────────────────────────────
  const iconReplaceMatch = instruction.match(/^__ICON_REPLACE__:([\s\S]+?)\|\|((?:https?:\/\/|data:)[^\|]+)(?:\|\|([\s\S]*))?$/s);
  if (iconReplaceMatch) {
    const cssPath  = iconReplaceMatch[1].trim();
    const imgUrl   = iconReplaceMatch[2].trim().replace(/['"<>]/g, '');
    const hintHtml = (iconReplaceMatch[3] ?? '').trim();
    let bounds = findByPath(html, cssPath);
    // Content-based fallback when the path doesn't match (e.g. after an LLM edit
    // restructured the DOM around the icon)
    if (!bounds && hintHtml) {
      const hintStart = locateElement(html, hintHtml);
      if (hintStart !== -1) {
        const tagName = hintHtml.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? '';
        if (tagName) {
          const tagEnd = html.indexOf('>', hintStart);
          if (tagEnd !== -1) {
            const opening = html.slice(hintStart, tagEnd + 1);
            if (tagName === 'img' || opening.trimEnd().endsWith('/>')) {
              bounds = { start: hintStart, end: tagEnd + 1 };
            } else {
              const close = `</${tagName}>`;
              let depth = 1, j = tagEnd + 1;
              while (j < html.length && depth > 0) {
                const nO = html.indexOf(`<${tagName}`, j);
                const nC = html.indexOf(close, j);
                if (nC === -1) break;
                if (nO !== -1 && nO < nC) { depth++; j = nO + tagName.length + 1; }
                else { depth--; j = nC + close.length; }
              }
              bounds = { start: hintStart, end: j };
            }
          }
        }
      }
    }
    if (!bounds) return { error: 'Target element not found — click it again to re-select', statusCode: 422 };
    const elementHtml = html.slice(bounds.start, bounds.end);
    const wMatch = elementHtml.match(/\bwidth="([^"]+)"/i) || elementHtml.match(/\bwidth\s*:\s*([^;'"]+)/i);
    const hMatch = elementHtml.match(/\bheight="([^"]+)"/i) || elementHtml.match(/\bheight\s*:\s*([^;'"]+)/i);
    const cls    = elementHtml.match(/\bclass="([^"]+)"/i)?.[1] ?? '';
    const style  = elementHtml.match(/\bstyle="([^"]+)"/i)?.[1] ?? '';
    const w = wMatch?.[1] ?? '1em';
    const h = hMatch?.[1] ?? '1em';
    const imgTag = `<img src="${imgUrl}" alt="icon"${cls ? ` class="${cls}"` : ''} style="width:${w};height:${h};object-fit:contain;display:inline-block;${style ? style + ';' : ''}" />`;
    return { html: html.slice(0, bounds.start) + imgTag + html.slice(bounds.end), summary: 'Icon replaced' };
  }

  return null; // not a deterministic instruction — fall through to LLM
}
