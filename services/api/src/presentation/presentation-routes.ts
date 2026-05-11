/**
 * Presentation route handlers — create and manage proposal microsites.
 *
 * Endpoints:
 *   GET  /presentations                           — list presentations for a namespace
 *   POST /presentations/create                    — create from an approved/finalized proposal
 *   GET  /presentations/:namespace/:proposalId    — get presentation (config + sections)
 *   POST /presentations/:namespace/:proposalId/config — update theme config
 *   POST /presentations/:namespace/:proposalId/generate — generate microsite via microsite-generator-agent
 *   GET  /presentations/:namespace/:proposalId/microsite — read generated MDX content
 *   POST /presentations/:namespace/:proposalId/design-edit — AI-driven design or content edit
 *   POST /presentations/:namespace/:proposalId/publish — export to self-contained HTML
 */

import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { env } from 'node:process';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { type AuthContext, isWildcard } from '../auth.js';
import { readMeta } from '../proposal-meta.js';
import { parseProposalMarkdown } from './markdown-parser.js';
import { buildBriefFramingRule, buildSectionTypeGuidance, buildSectionOrderGuidance } from '../workflows/microsite-generation.handlers.js';
import { ContextService } from '../chat/context.service.js';
import {
  listPresentations,
  getPresentation,
  createPresentation,
  updateConfig,
  type PresentationConfig,
} from './presentation-service.js';
import { ensureRegistered, buildRunner, llmGenerateFn } from '../agent-routes.js';
import { applyDesignSkill, injectThemeCSS, generateThemeCSSTokens, generateSectionHtml, CUSTOM_HTML_SECTION_TYPES, type CSSTheme, type Tone } from '../skills/design-skill-microsite.js';
import { buildDesignSystemPrompt, buildFontUrls } from '@ai-engine/agent-microsite-generator';
import { DesignEditorAgent } from '@ai-engine/agent-design-editor';
import { renderMicrositeToHtml } from './html-exporter.js';
import { renderMicrositeToPptx } from './pptx-exporter.js';
import {
  fetchUnsplashImageUrl,
  fetchPexelsImageUrl,
  fetchLoremflickrUrl,
  generateGptImage1,
  generateDalle3Image,
  buildDallePrompt,
  resolveImageSource,
  downloadImageToFile,
  saveBase64ToFile,
  buildPicsumUrl,
} from '../image-routes.js';

/**
 * Resolve a proposal fileName to an absolute path.
 * Handles three forms:
 *   "ns::file.md"        → workdir/namespaces/ns/proposals/file.md  (new canonical)
 *   "file.md"            → workdir/namespaces/<namespace>/proposals/file.md (inferred from context)
 *   fallback             → workdir/output/file.md  (legacy)
 */
function resolveProposalMdPath(workdir: string, fileName: string, contextNamespace?: string): string {
  const sep = fileName.indexOf('::');
  if (sep !== -1) {
    return path.join(workdir, 'namespaces', fileName.slice(0, sep), 'proposals', fileName.slice(sep + 2));
  }
  if (contextNamespace) {
    return path.join(workdir, 'namespaces', contextNamespace, 'proposals', fileName);
  }
  return path.join(workdir, 'output', fileName);
}

function checkNamespaceAccess(
  auth: AuthContext,
  namespace: string,
  reply: FastifyReply,
): boolean {
  if (isWildcard(auth.allowedNamespaces)) return true;
  if (auth.allowedNamespaces.includes(namespace)) return true;
  reply.code(403).send({ error: `Access denied for namespace: ${namespace}` });
  return false;
}

function getAuth(req: FastifyRequest): AuthContext {
  return (req as FastifyRequest & { auth: AuthContext }).auth;
}

/**
 * Download a remote image URL (DALL-E or Unsplash) to local disk so it
 * never expires. Returns the persistent local URL to store in the AST.
 * Falls back to the original remote URL if download fails.
 */
async function saveImagePersistently(
  remoteUrl: string,
  namespace: string,
  sectionId: string,
  workdir: string,
): Promise<string> {
  const imagesDir = path.join(workdir, 'assets', 'presentations', namespace, 'images');
  await mkdir(imagesDir, { recursive: true });
  const ext = '.jpg';
  const filename = `${sectionId}-${crypto.randomUUID().slice(0, 8)}${ext}`;
  const destPath = path.join(imagesDir, filename);
  let ok: boolean;
  if (remoteUrl.startsWith('data:')) {
    const commaIdx = remoteUrl.indexOf(',');
    const b64 = commaIdx !== -1 ? remoteUrl.slice(commaIdx + 1) : '';
    ok = b64 ? await saveBase64ToFile(b64, destPath) : false;
  } else {
    ok = await downloadImageToFile(remoteUrl, destPath);
  }
  // Store as a root-relative path — works regardless of port or server restart.
  // Falls back to the remote URL only if the download failed.
  if (!ok) return remoteUrl;
  return `/presentation-images/${namespace}/${filename}`;
}

/**
 * Resolve a stored image URL to an absolute URL for serving.
 * Root-relative paths (/presentation-images/...) get the API base prepended.
 * Remote URLs (http/https) are returned as-is.
 */
function resolveImageUrl(storedUrl: string): string {
  if (storedUrl.startsWith('/')) {
    const apiPort = env.API_PORT ?? '3000';
    return `http://localhost:${apiPort}${storedUrl}`;
  }
  return storedUrl;
}

/**
 * Convert all image URLs in the AST to base64 data URIs so the exported HTML
 * is fully self-contained and never makes external requests.
 */
async function embedImagesAsBase64(
  ast: Record<string, unknown>,
  workdir: string,
  namespace: string,
): Promise<Record<string, unknown>> {
  const sections = ast.sections as Array<Record<string, unknown>> | undefined;
  if (!sections) return ast;

  await Promise.all(sections.map(async (sec) => {
    const image = sec.image as { url?: string | null; source?: string } | undefined;
    if (!image?.url) return;

    let localPath: string | null = null;

    if (image.url.startsWith('/presentation-images/')) {
      // Root-relative path saved by saveImagePersistently
      const parts = image.url.replace('/presentation-images/', '').split('/');
      if (parts.length === 2) {
        localPath = path.join(workdir, 'assets', 'presentations', parts[0], 'images', parts[1]);
      }
    } else if (image.url.startsWith(`http://localhost`)) {
      // Legacy absolute localhost URL — extract the file path
      try {
        const u = new URL(image.url);
        const parts = u.pathname.replace('/presentation-images/', '').split('/');
        if (parts.length === 2) {
          localPath = path.join(workdir, 'assets', 'presentations', parts[0], 'images', parts[1]);
        }
      } catch { /* ignore malformed */ }
    }

    if (localPath && existsSync(localPath)) {
      try {
        const buf = await readFile(localPath);
        image.url = `data:image/jpeg;base64,${buf.toString('base64')}`;
      } catch { /* leave URL as-is on read error */ }
    } else if (image.url.startsWith('http') && !image.url.startsWith('http://localhost')) {
      // Remote URL (unsplash fallback) — download and embed
      try {
        const res = await fetch(image.url);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const mime = res.headers.get('content-type') ?? 'image/jpeg';
          image.url = `data:${mime};base64,${buf.toString('base64')}`;
        }
      } catch { /* leave URL as-is on fetch error */ }
    }
  }));

  return ast;
}

export function registerPresentationRoutes(
  app: FastifyInstance,
  workdir: string,
): void {

  // GET /presentation-images/:namespace/:filename
  // Serves locally saved images (DALL-E downloads) — no auth required since these are just background images.
  app.get('/presentation-images/:namespace/:filename', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, filename } = req.params as { namespace: string; filename: string };
    // Basic path traversal guard
    if (filename.includes('..') || filename.includes('/') || namespace.includes('..')) {
      return reply.code(400).send({ error: 'Invalid path' });
    }
    const filePath = path.join(workdir, 'assets', 'presentations', namespace, 'images', filename);
    if (!existsSync(filePath)) return reply.code(404).send({ error: 'Not found' });
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.gif': 'image/gif' };
    const mimeType = mimeMap[ext] ?? 'image/jpeg';
    const stream = createReadStream(filePath);
    return reply.header('Access-Control-Allow-Origin', '*').type(mimeType).send(stream);
  });

  // POST /presentations/extract-url-design
  // Fetches a website URL server-side, scrapes its CSS, then uses the LLM to extract
  // a ReferenceDesign token object (colors, typography, style) for use in microsite generation.
  app.post('/presentations/extract-url-design', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { url?: string } | undefined;
    const rawUrl = body?.url?.trim();

    if (!rawUrl) return reply.code(400).send({ error: 'url is required', tokens: null });

    // Validate URL — only http/https allowed
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') throw new Error('bad protocol');
    } catch {
      return reply.code(400).send({ error: 'invalid_url', tokens: null });
    }

    // ── Step 1: Fetch HTML with 8s timeout ────────────────────────────────
    let html: string;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      const res = await fetch(parsedUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
        redirect: 'follow',
      });
      clearTimeout(timer);
      if (!res.ok) {
        // 403 is almost always Cloudflare or similar bot-protection — give a clear error
        const errCode = res.status === 403 ? 'blocked_by_bot_protection' : `fetch_failed_${res.status}`;
        return reply.code(200).send({ error: errCode, tokens: null });
      }
      html = await res.text();
      // Cloudflare challenge returns 200 with a JS challenge page — detect and bail early
      if (html.includes('cf_chl_opt') || html.includes('challenges.cloudflare.com')) {
        return reply.code(200).send({ error: 'blocked_by_bot_protection', tokens: null });
      }
    } catch (err) {
      const msg = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'fetch_failed';
      return reply.code(200).send({ error: msg, tokens: null });
    }

    // ── Extract meta image URLs and brand logo ────────────────────────────
    const resolveAbsolute = (href: string): string | null => {
      try { return new URL(href, parsedUrl.toString()).toString(); } catch { return null; }
    };

    const ogMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i) ??
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i);
    const heroImageUrl: string | null = ogMatch?.[1] ? resolveAbsolute(ogMatch[1]) : null;

    // Logo priority: JSON-LD schema.org → apple-touch-icon → SVG favicon → PNG favicon → any favicon → /favicon.ico
    let logoUrl: string | null = null;
    for (const block of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const data = JSON.parse(block[1]) as Record<string, unknown>;
        const items = Array.isArray(data['@graph']) ? data['@graph'] as Record<string, unknown>[] : [data];
        for (const item of items) {
          const logo = item.logo as Record<string, unknown> | string | undefined;
          const logoHref = typeof logo === 'string' ? logo : (logo?.url as string | undefined) ?? (logo?.contentUrl as string | undefined);
          if (logoHref) { logoUrl = resolveAbsolute(logoHref); break; }
        }
        if (logoUrl) break;
      } catch { /* malformed JSON-LD */ }
    }
    if (!logoUrl) {
      const appleMatch = html.match(/<link[^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]+href=["']([^"']+)["'][^>]*>/i)
        ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*>/i);
      if (appleMatch?.[1]) logoUrl = resolveAbsolute(appleMatch[1]);
    }
    if (!logoUrl) {
      const svgFaviconMatch = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+\.svg[^"']*)["'][^>]*>/i)
        ?? html.match(/<link[^>]+href=["']([^"']+\.svg[^"']*)["'][^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i);
      if (svgFaviconMatch?.[1]) logoUrl = resolveAbsolute(svgFaviconMatch[1]);
    }
    if (!logoUrl) {
      const pngFaviconMatch = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+\.png[^"']*)["'][^>]*>/i)
        ?? html.match(/<link[^>]+href=["']([^"']+\.png[^"']*)["'][^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i);
      if (pngFaviconMatch?.[1]) logoUrl = resolveAbsolute(pngFaviconMatch[1]);
    }
    if (!logoUrl) {
      const anyFaviconMatch = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i)
        ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i);
      if (anyFaviconMatch?.[1]) logoUrl = resolveAbsolute(anyFaviconMatch[1]);
    }
    // Final fallback: every site serves /favicon.ico at the root (404 is handled gracefully by the client)
    if (!logoUrl) logoUrl = new URL('/favicon.ico', parsedUrl.origin).toString();

    // ── Step 2: Extract CSS from HTML ─────────────────────────────────────
    const origin = parsedUrl.origin;

    // meta theme-color
    // Extract theme-color metas by media query — sites like Vercel declare both:
    //   <meta name="theme-color" content="#FAFAFA" media="(prefers-color-scheme: light)">
    //   <meta name="theme-color" content="#000"    media="(prefers-color-scheme: dark)">
    // Picking the first match blindly reads the light one and sets themeColorIsExplicitlyLight=true,
    // which then blocks ALL dark detection for the page.
    const allThemeColorTags = [...html.matchAll(/<meta\b[^>]*>/gi)]
      .map(m => m[0])
      .filter(tag => /name=["']theme-color["']/i.test(tag));

    const darkMediaThemeColor = allThemeColorTags
      .find(tag => /media=["'][^"']*prefers-color-scheme\s*:\s*dark/i.test(tag))
      ?.match(/content=["']([^"']+)["']/i)?.[1] ?? null;
    const lightOrDefaultThemeColor = allThemeColorTags
      .find(tag => !/media=["'][^"']*prefers-color-scheme\s*:\s*dark/i.test(tag))
      ?.match(/content=["']([^"']+)["']/i)?.[1] ?? null;

    const themeColorHint = (darkMediaThemeColor ?? lightOrDefaultThemeColor)
      ? `theme-color: ${darkMediaThemeColor ?? lightOrDefaultThemeColor}` : '';

    // Detect dark mode declared in HTML — read BEFORE fetching stylesheets so we can
    // prioritize dark-named CSS files over light-named ones in first-definition-wins resolution.
    const dataColorMode = (html.match(/data-color-mode=["']([^"']+)["']/i)?.[1] ?? '').toLowerCase();
    // Class-based dark mode: sites like Claude.ai set data-mode="auto" or data-mode="dark"
    // on <html>. Dark CSS variables live in [data-mode=dark] selector blocks, not :root.
    const dataMode = (html.match(/\bdata-mode=["']([^"']+)["']/i)?.[1] ?? '').toLowerCase();
    const hasClassBasedDarkMode = dataMode === 'dark' || dataMode === 'auto';

    const darkTcHex6 = darkMediaThemeColor?.match(/^#([0-9a-fA-F]{6})$/i)?.[1] ?? null;
    const darkTcIsDark = darkTcHex6 !== null && hexLum('#' + darkTcHex6) < 30 / 255;

    const lightTcHex6 = lightOrDefaultThemeColor?.match(/^#([0-9a-fA-F]{6})$/i)?.[1] ?? null;
    const lightTcLum = lightTcHex6 !== null ? hexLum('#' + lightTcHex6) : null;

    // "Explicitly light" only when the site has NO dark-media theme-color AND its only
    // theme-color is clearly light (>180/255 ≈ 0.706). A site with both light+dark metas
    // (Vercel, Next.js) must NOT be blocked from dark detection.
    const themeColorIsExplicitlyLight = !darkMediaThemeColor && lightTcLum !== null && lightTcLum > 180 / 255;
    const htmlDeclaresDark = dataColorMode === 'dark' || darkTcIsDark;

    // Google Fonts links — extract font family names
    const gFontNames = [...html.matchAll(/family=([A-Za-z0-9+]+)/gi)].map(m => m[1].replace(/\+/g, ' '));

    // Linked stylesheets — handle both href-before-rel (Webflow) and rel-before-href orderings
    const allLinkTags = [...html.matchAll(/<link\s([^>]+)>/gi)].map(m => m[1]);
    const rawSheetHrefs = allLinkTags
      .filter(attrs => /rel=["']stylesheet["']/i.test(attrs) || /rel=["']preload["'][^>]*as=["']style["']/i.test(attrs))
      .map(attrs => {
        const hm = attrs.match(/href=["']([^"']+)["']/i);
        return hm ? hm[1] : null;
      })
      .filter((h): h is string => !!h && !h.includes('fonts.googleapis.com') && !h.startsWith('data:'));

    // When the site declares dark mode, skip light-only stylesheets and put ONE base dark
    // stylesheet first. This ensures varMap (first-definition-wins) picks up dark-theme
    // variable values before the generic design-system CSS is processed.
    // We only need ONE dark CSS (the base, not high-contrast/colorblind variants) — the
    // remaining slots are filled by the generic design-system CSS (primer, global, etc.)
    // which contain actual typography, spacing, and brand tokens.
    const sheetHrefs = (() => {
      const seen = new Set<string>();
      let baseDark: string | null = null;
      const generic: string[] = [];
      for (const h of rawSheetHrefs) {
        if (seen.has(h)) continue;
        seen.add(h);
        const filename = h.split('/').pop() ?? h;
        if (htmlDeclaresDark && /(?:^|[-_./])light(?:[-_.]|$)/i.test(filename)) continue; // skip light-only on dark sites
        const isDarkFile = /(?:^|[-_./])dark(?:[-_.]|$)/i.test(filename);
        const isDarkVariant = /high.contrast|colorblind|tritanopia|dimmed/i.test(filename);
        if (isDarkFile && !isDarkVariant && !baseDark) baseDark = h; // keep only the first base dark CSS
        else if (!isDarkFile) generic.push(h);
      }
      return [...(baseDark ? [baseDark] : []), ...generic].slice(0, 6);
    })();

    // Inline <style> blocks
    const inlineStyles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');

    const allSheetCss = (await Promise.all(sheetHrefs.map(async (href) => {
      try {
        const absolute = href.startsWith('http') ? href : (href.startsWith('//') ? `https:${href}` : `${origin}${href.startsWith('/') ? '' : '/'}${href}`);
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8_000);
        const r = await fetch(absolute, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Accept': 'text/css,*/*;q=0.1', 'Referer': origin } });
        clearTimeout(t);
        if (!r.ok) return '';
        const css = await r.text();
        return css;
      } catch { return ''; }
    }))).join('\n');

    const fullCss = inlineStyles + '\n' + allSheetCss;

    // ── Color format converters ────────────────────────────────────────────────
    // Many modern sites (Tailwind v4, Radix, shadcn) define colors as oklch() or hsl().
    // These converters let us resolve all CSS color formats down to #hex.

    function hslToHex(h: number, s: number, l: number): string {
      const sn = s / 100, ln = l / 100;
      const a = sn * Math.min(ln, 1 - ln);
      const f = (n: number) => {
        const k = (n + h / 30) % 12;
        return Math.round(255 * (ln - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    }

    function rgbToHex(r: number, g: number, b: number): string {
      return `#${Math.round(Math.max(0, Math.min(255, r))).toString(16).padStart(2, '0')}${Math.round(Math.max(0, Math.min(255, g))).toString(16).padStart(2, '0')}${Math.round(Math.max(0, Math.min(255, b))).toString(16).padStart(2, '0')}`;
    }

    function oklchToHex(L: number, C: number, H: number): string {
      const hRad = (isNaN(H) ? 0 : H) * Math.PI / 180;
      const a = (isNaN(C) ? 0 : C) * Math.cos(hRad);
      const b = (isNaN(C) ? 0 : C) * Math.sin(hRad);
      const lp = L + 0.3963377774 * a + 0.2158037573 * b;
      const mp = L - 0.1055613458 * a - 0.0638541728 * b;
      const sp = L - 0.0894841775 * a - 1.2914855480 * b;
      const l3 = lp ** 3, m3 = mp ** 3, s3 = sp ** 3;
      const rLin =  4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
      const gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
      const bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;
      const toSrgb = (c: number) => { const v = Math.max(0, Math.min(1, c)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
      return rgbToHex(toSrgb(rLin) * 255, toSrgb(gLin) * 255, toSrgb(bLin) * 255);
    }

    /** Convert any CSS color string to #rrggbb hex. Returns null if unrecognised. */
    function cssColorToHex(raw: string): string | null {
      const s = raw.trim().toLowerCase();
      if (s === 'transparent' || s === 'inherit' || s === 'initial' || s === 'unset' || s === 'none') return null;
      // #hex (3, 4, 6, or 8 chars — expand short forms, strip alpha)
      if (/^#[0-9a-f]{3,8}$/.test(s)) {
        if (s.length === 4) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`; // #rgb → #rrggbb
        if (s.length === 5) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`; // #rgba → strip alpha → #rrggbb
        if (s.length === 9) return s.slice(0, 7); // #rrggbbaa → strip alpha
        return s.slice(0, 7); // #rrggbb
      }
      // hsl / hsla (comma or space separated, optional angle units on H)
      const hslM = s.match(/^hsla?\s*\(\s*([\d.]+)(?:deg|rad|turn|grad)?\s*[,\s]\s*([\d.]+)%?\s*[,\s]\s*([\d.]+)%/);
      if (hslM) return hslToHex(parseFloat(hslM[1]), parseFloat(hslM[2]), parseFloat(hslM[3]));
      // rgb / rgba
      const rgbM = s.match(/^rgba?\s*\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)/);
      if (rgbM) return rgbToHex(parseFloat(rgbM[1]), parseFloat(rgbM[2]), parseFloat(rgbM[3]));
      // oklch / oklcha (space-separated; L may have %)
      const oklchM = s.match(/^oklcha?\s*\(\s*([\d.]+)(%?)\s+([\d.none]+)\s+([\d.none]+)/);
      if (oklchM) {
        const Lv = parseFloat(oklchM[1]) * (oklchM[2] === '%' ? 0.01 : 1);
        const Cv = parseFloat(oklchM[3]);
        const Hv = parseFloat(oklchM[4]);
        return oklchToHex(isNaN(Lv) ? 0 : Lv, isNaN(Cv) ? 0 : Cv, isNaN(Hv) ? 0 : Hv);
      }
      return null;
    }

    // ── CSS variable resolution: follow var() chains to resolved hex values ────
    // Build a complete map of all CSS variable definitions (first definition wins).
    // Stores raw values — cssColorToHex/resolveVar convert on demand.
    const varMap = new Map<string, string>();
    for (const m of fullCss.matchAll(/(--[\w-]+)\s*:\s*([^;}{]+)/gu)) {
      const vname = m[1];
      if (!varMap.has(vname)) varMap.set(vname, m[2].trim());
    }

    // Class-based dark mode override (e.g. Claude.ai [data-mode=dark], Radix .dark):
    // varMap is first-definition-wins, so light :root defaults were already stored above.
    // Override them now with values from scoped dark selectors so that bgTokens / text
    // token analysis sees the actual dark palette.
    if (hasClassBasedDarkMode) {
      const darkScopeRe = /(?:\[data-mode=["']?dark["']?\]|\[data-theme=["']?dark["']?\]|\.dark\b)[^{]{0,80}\{([^}]{0,6000})\}/g;
      for (const m of fullCss.matchAll(darkScopeRe)) {
        for (const vm of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;}{]+)/gu)) {
          varMap.set(vm[1], vm[2].trim()); // intentionally overwrite light defaults
        }
      }
    }

    function resolveVar(name: string, depth = 0): string | null {
      if (depth > 8) return null;
      const val = varMap.get(name);
      if (!val) return null;
      // Try direct conversion (hex, hsl, rgb, oklch)
      const direct = cssColorToHex(val);
      if (direct) return direct;
      // Follow var() chain
      const ref = val.match(/var\s*\(\s*(--[\w-]+)/);
      return ref ? resolveVar(ref[1], depth + 1) : null;
    }

    // ── Scan CSS rules for actual body/html background-color AND text color ─────
    // Only accept PURE ROOT-LEVEL body rules: selector must be exactly 'body', 'html',
    // ':root', or comma-separated combinations of those (e.g. 'html, body').
    // This excludes scoped rules like 'html body.class em{background:X}' which are NOT
    // the page background. CSS cascade: keep the last resolved value.
    let bodyBgHex: string | null = null;
    let bodyTextHex: string | null = null;
    for (const m of fullCss.matchAll(/([^{}]{0,150})\{([^}]{0,800})\}/g)) {
      const sel = m[1].trim();
      const block = m[2];
      // Check every comma-separated part is exactly html, body, or :root (no class/id/child)
      const parts = sel.split(',').map(s => s.trim());
      const isRootBodyRule = parts.every(s => /^(?:html|body|:root)$/.test(s)) && parts.some(s => s === 'body');
      if (!isRootBodyRule) continue;
      // background-color
      const bgProp = block.match(/background(?:-color)?\s*:\s*([^;!}]{1,120})/);
      if (bgProp) {
        const raw = bgProp[1].trim();
        const directHex = cssColorToHex(raw);
        if (directHex && !/^#0{3,8}$/.test(directHex)) { bodyBgHex = directHex; }
        else if (!directHex) { const vr = raw.match(/var\s*\(\s*(--[\w-]+)/); if (vr) { const r = resolveVar(vr[1]); if (r) bodyBgHex = r; } }
      }
      // color (text) — strong dark-theme signal when it's white
      const colorProp = block.match(/(?:^|;)\s*color\s*:\s*([^;!}]{1,80})/);
      if (colorProp) {
        const raw = colorProp[1].trim();
        const directHex = cssColorToHex(raw);
        if (directHex) { bodyTextHex = directHex; }
        else { const vr = raw.match(/var\s*\(\s*(--[\w-]+)/); if (vr) { const r = resolveVar(vr[1]); if (r) bodyTextHex = r; } }
      }
    }
    // #ffffff / #fff is the browser/CSS-reset default — not a meaningful theme signal.
    // If the only body bg we found is white, ignore it and let semantic var resolution take over.
    if (/^#(?:fff|ffffff)$/i.test(bodyBgHex ?? '')) bodyBgHex = null;

    // Helper: compute relative luminance from a 6-digit hex string
    function hexLum(hex: string): number {
      const h = hex.length === 4
        ? '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
        : hex.slice(0, 7); // strip alpha if 8-char
      const r = parseInt(h.slice(1, 3), 16) / 255;
      const g = parseInt(h.slice(3, 5), 16) / 255;
      const b = parseInt(h.slice(5, 7), 16) / 255;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    // Dark-theme inference: if body text color is white/near-white and no body bg was found,
    // collect dark background-color values from element-level CSS rules as page bg candidates.
    const bodyTextIsLight = bodyTextHex ? hexLum(bodyTextHex) > 0.8 : false;
    let inferredDarkBg: string | null = null;
    if (!bodyBgHex && bodyTextIsLight) {
      const darkFreq = new Map<string, number>();
      for (const m of fullCss.matchAll(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{6,7})\b/g)) {
        const hex = m[1].toLowerCase();
        // Skip transparent, near-transparent, pure black
        if (/^#0{6}$/.test(hex)) continue;
        const lum = hexLum(hex);
        if (lum < 0.08) darkFreq.set(hex, (darkFreq.get(hex) ?? 0) + 1);
      }
      if (darkFreq.size > 0) {
        // Pick most frequent; ties broken by slightly lighter (more visible as bg)
        const sorted = [...darkFreq.entries()].sort((a, b) => b[1] - a[1] || hexLum(b[0]) - hexLum(a[0]));
        inferredDarkBg = sorted[0][0];
      }
    }

    // Generic dark-theme detection: scan both CSS files and HTML inline element styles.
    // Threshold is 0.20 luminance (catches Bootstrap dark #212529, GitHub #0d1117, etc.)
    // Sources:
    //   1. fullCss — catches CSS rules and variables hardcoded with dark hex values
    //   2. html inline style attributes — catches sites like k-m.com where sections
    //      set background via style="background-color:#292c34" on elements, not CSS files
    let dominantDarkBg: string | null = inferredDarkBg;
    const darkBgFreq = new Map<string, number>();
    const DARK_LUM_THRESHOLD = 0.20;
    for (const m of fullCss.matchAll(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{6,7})\b/g)) {
      const hex = cssColorToHex(m[1]);
      if (!hex) continue;
      if (/^#0{6}$/.test(hex)) continue; // skip pure #000000 (resets/overlays, not brand bg)
      if (hexLum(hex) <= DARK_LUM_THRESHOLD) darkBgFreq.set(hex, (darkBgFreq.get(hex) ?? 0) + 1);
    }
    // HTML inline element styles — fullCss only covers <style> blocks + external CSS.
    // Only scan structural/container tags; skip decorative/interactive ones (a, span, button,
    // svg, etc.) which carry UI widget colors like color-picker swatches (Dribbble) that
    // are not representative of the page background theme.
    for (const m of html.matchAll(/<([\w]+)[^>]*style=["'][^"']*background(?:-color)?\s*:\s*(#[0-9a-fA-F]{6,7})\b/gi)) {
      const tag = m[1].toLowerCase();
      if (/^(a|span|button|input|select|option|svg|path|circle|rect|i|em|b|strong|small|img|label|li|td|th)$/.test(tag)) continue;
      const hex = cssColorToHex(m[2]);
      if (!hex || /^#0{6}$/.test(hex)) continue;
      if (hexLum(hex) <= DARK_LUM_THRESHOLD) darkBgFreq.set(hex, (darkBgFreq.get(hex) ?? 0) + 1);
    }

    // 2+ distinct dark bg colors found = the site is visually dark-themed.
    // Guard: if theme-color meta explicitly declares a light theme, never flip to dark
    // regardless of decorative/widget dark colors found in the HTML (e.g. Dribbble color swatches).
    let isDarkTheme =
      !themeColorIsExplicitlyLight && (
        bodyTextIsLight ||
        inferredDarkBg !== null ||
        darkBgFreq.size >= 2
      );

    if (!dominantDarkBg && darkBgFreq.size > 0) {
      // Prefer the lightest qualifying dark bg — more readable as a page background than pure black
      const sorted = [...darkBgFreq.entries()].sort((a, b) => b[1] - a[1] || hexLum(b[0]) - hexLum(a[0]));
      dominantDarkBg = sorted[0][0];
    }

    // Extract resolved page-level semantic colors (background, text, primary/brand)
    // These are the most reliable signals — they tell us the actual applied colors
    const resolvedPageColors: { label: string; hex: string }[] = [];
    const seenResolvedHex = new Set<string>();

    // Body background from CSS rules takes top priority (only when it's a real theme color)
    if (bodyBgHex) {
      seenResolvedHex.add(bodyBgHex);
      resolvedPageColors.push({ label: 'PAGE BACKGROUND', hex: bodyBgHex });
    } else if (inferredDarkBg) {
      // Dark theme inferred from white body text — use most common dark bg as page background
      seenResolvedHex.add(inferredDarkBg);
      resolvedPageColors.push({ label: 'PAGE BACKGROUND (dark theme inferred from white body text)', hex: inferredDarkBg });
    }

    for (const [name] of varMap.entries()) {
      const lower = name.toLowerCase();
      let label: string | null = null;
      // Semantic theme/page-level background variables (exact or near-exact match)
      if (/--(?:_theme---)?background(?:$|-(?:color|page|base|default|main|site|body))/.test(lower)
        || /--(?:color-)?(?:page|site|body)-?bg(?:$|-)/.test(lower)) {
        label = 'PAGE BACKGROUND';
      } else if (/--(?:_theme---)?text(?:$|-color)/.test(lower)
        || /--(?:color-)?(?:body|page)-?text(?:$|-)/.test(lower)) {
        label = 'PAGE TEXT COLOR';
      } else if (/--(?:color-)?(?:primary|brand)(?:-\d+)?(?:$|-default)/.test(lower)) {
        label = 'PRIMARY/BRAND COLOR';
      }
      if (label) {
        const hex = resolveVar(name);
        if (hex && !seenResolvedHex.has(hex)) {
          seenResolvedHex.add(hex);
          resolvedPageColors.push({ label, hex });
        }
      }
    }

    // ── Pre-process CSS: categorize color tokens by semantic role ────────────
    // Iterate varMap (already deduplicated, first-definition-wins) instead of
    // rescanning fullCss. This catches oklch/hsl/rgb values that a hex-only regex misses.
    const bgTokens:     { name: string; val: string }[] = [];
    const accentTokens: { name: string; val: string }[] = [];
    const textTokens:   { name: string; val: string }[] = [];
    const otherTokens:  { name: string; val: string }[] = [];
    const seenBucketNames = new Set<string>();

    for (const [rawName, rawVal] of varMap.entries()) {
      const name = rawName.toLowerCase();
      if (seenBucketNames.has(name)) continue;
      seenBucketNames.add(name);
      // Skip well-known third-party UI library namespaces — these are widget/modal colors,
      // not the site's brand palette. Letting them through confuses the LLM.
      if (/^--(cc|wp--|swiper-|plyr-|fc-|bs-|mdb-)/.test(name)) continue;
      // Resolve the raw value to hex (handles #hex, hsl, rgb, oklch, and var() chains)
      const val = rawVal.startsWith('var(') ? resolveVar(rawName) : cssColorToHex(rawVal);
      if (!val) continue;   // not a color variable — skip
      const valLum = hexLum(val);
      const isNearWhite = valLum > 0.92;
      const isNearBlack = valLum < 0.03;
      if (/background|bg|dark|base|surface|lift|depth/.test(name))
        bgTokens.push({ name: rawName, val });
      else if (/accent|brand|primary|highlight|feature/.test(name)) {
        // White/near-white and pure-black are never brand accent colors — skip them
        if (!isNearWhite && !isNearBlack) accentTokens.push({ name: rawName, val });
      } else if (/text|foreground|label|copy/.test(name))
        textTokens.push({ name: rawName, val });
      else {
        if (!isNearWhite && !isNearBlack) otherTokens.push({ name: rawName, val });
      }
    }

    // Refine dark-theme detection using resolved bgTokens.
    // Sites like GitHub use CSS variables (background-color: var(--color-canvas-default))
    // so the direct-hex regex scan above finds nothing. bgTokens are already resolved,
    // making them the most reliable signal.
    if (bgTokens.length >= 2) {
      const darkCount = bgTokens.filter(t => hexLum(t.val) <= DARK_LUM_THRESHOLD).length;
      if (darkCount / bgTokens.length > 0.5) isDarkTheme = true;
    }
    // If isDarkTheme but no dominant dark bg yet, pick the darkest resolved bg token
    if (isDarkTheme && !dominantDarkBg) {
      const darkTokens = bgTokens.filter(t => hexLum(t.val) < 0.15);
      if (darkTokens.length > 0) {
        // Prefer the lightest of the dark tokens — it reads better as a surface bg than pure black
        darkTokens.sort((a, b) => hexLum(b.val) - hexLum(a.val));
        dominantDarkBg = darkTokens[0].val;
      }
    }

    // Gradient color stops (hex only to avoid invalid rgba in JSON output)
    const gradientStops: string[] = [];
    for (const m of fullCss.matchAll(/(?:linear|radial|conic)-gradient\s*\(([^)]{10,400})\)/g)) {
      const stops = [...m[1].matchAll(/#[0-9a-fA-F]{3,8}/g)].map(s => s[0]);
      if (stops.length >= 2) gradientStops.push(stops.join(' → '));
    }

    // font-family declarations (deduplicated, skip CSS variable references)
    const fontFamilies: string[] = [];
    for (const m of fullCss.matchAll(/font-family\s*:\s*([^;}{]{5,80})/g)) {
      const val = m[1].trim().split(',')[0].replace(/['"]/g, '').trim();
      // Skip CSS variable references (var(...)) — they're not font names
      if (!val || val.startsWith('var(') || val.startsWith('--')) continue;
      if (!fontFamilies.includes(val)) fontFamilies.push(val);
      if (fontFamilies.length >= 8) break;
    }
    if (gFontNames.length) gFontNames.forEach(f => { if (!fontFamilies.includes(f)) fontFamilies.push(f); });

    // Build structured summary — categorised sections so LLM maps correctly
    const lines: string[] = [];
    if (themeColorHint) lines.push(`META: ${themeColorHint}`);

    // Resolved page colors go FIRST — highest priority, LLM must use these
    if (resolvedPageColors.length) {
      lines.push('\nRESOLVED PAGE COLORS ⚑ USE THESE DIRECTLY — do not override with other tokens:');
      resolvedPageColors.forEach(c => lines.push(`  ${c.label}: ${c.hex}`));
    } else if (isDarkTheme) {
      const bgHint = dominantDarkBg ? ` Most common dark background found: ${dominantDarkBg}.` : '';
      lines.push(`\nTHEME: DARK — background MUST be a dark/near-black hex color (luminance < 0.2).${bgHint} Do NOT use white or any light color for background or surface.`);
    } else {
      // No body background found in CSS — browser default is white
      lines.push('\nBODY BACKGROUND: not explicitly set in CSS — default is #ffffff (white); do NOT output a dark/black background unless BACKGROUND TOKENS clearly show a dark theme');
    }

    if (bgTokens.length) {
      lines.push('\nBACKGROUND TOKENS (use these for background/surface):');
      bgTokens.slice(0, 20).forEach(t => lines.push(`  ${t.name}: ${t.val}`));
    }
    if (accentTokens.length) {
      lines.push('\nACCENT/BRAND TOKENS (use these for primary/secondary/accent):');
      accentTokens.slice(0, 20).forEach(t => lines.push(`  ${t.name}: ${t.val}`));
    }
    if (textTokens.length) {
      lines.push('\nTEXT TOKENS (use these for text/textMuted):');
      textTokens.slice(0, 10).forEach(t => lines.push(`  ${t.name}: ${t.val}`));
    }
    if (otherTokens.length) {
      lines.push('\nOTHER COLOR TOKENS:');
      otherTokens.slice(0, 20).forEach(t => lines.push(`  ${t.name}: ${t.val}`));
    }
    if (gradientStops.length) {
      lines.push('\nGRADIENT STOPS (HIGHLY SIGNIFICANT — these ARE the brand palette):');
      gradientStops.slice(0, 8).forEach(g => lines.push(`  ${g}`));
    }
    if (fontFamilies.length) {
      lines.push('\nFONT FAMILIES:');
      fontFamilies.forEach(f => lines.push(`  ${f}`));
    }

    const colorSummary = lines.join('\n').slice(0, 10_000);
    if (!colorSummary.trim()) return reply.code(200).send({ error: 'no_css_found', tokens: null });

    // ── Step 2b: Extract design layout structure from HTML DOM ────────────
    // Parse HTML to identify sections, their types, and all image URLs used on the page.
    // This gives the microsite agent structural context — not just colors/fonts but
    // section order, hero style, grid density, and actual images from the site.

    // Collect all <img src> and CSS background-image URLs from the page body
    const bodyImages: string[] = [];
    const seenImageUrls = new Set<string>();

    // <img src="..."> and <img srcset="...">
    for (const m of html.matchAll(/<img\s[^>]*>/gi)) {
      const tag = m[0];
      const srcM = tag.match(/\bsrc=["']([^"']+)["']/i);
      if (srcM?.[1]) {
        const abs = resolveAbsolute(srcM[1]);
        if (abs && !seenImageUrls.has(abs) && !abs.includes('data:') && !abs.match(/\.(svg|gif)(\?|$)/i)) {
          seenImageUrls.add(abs);
          bodyImages.push(abs);
        }
      }
      // srcset — pick the first (largest) candidate
      const ssM = tag.match(/\bsrcset=["']([^"']+)["']/i);
      if (ssM?.[1]) {
        const first = ssM[1].trim().split(/,\s*/)[0]?.split(/\s+/)[0];
        if (first) {
          const abs = resolveAbsolute(first);
          if (abs && !seenImageUrls.has(abs) && !abs.includes('data:')) {
            seenImageUrls.add(abs);
            bodyImages.push(abs);
          }
        }
      }
    }

    // CSS background-image: url(...) from inline styles
    for (const m of html.matchAll(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/gi)) {
      const abs = resolveAbsolute(m[1].trim());
      if (abs && !seenImageUrls.has(abs) && !abs.includes('data:') && !abs.match(/\.(svg|gif)(\?|$)/i)) {
        seenImageUrls.add(abs);
        bodyImages.push(abs);
      }
    }

    // background-image from stylesheets
    for (const m of fullCss.matchAll(/background(?:-image)?\s*:\s*url\(["']?([^"')]+)["']?\)/gi)) {
      const abs = resolveAbsolute(m[1].trim());
      if (abs && !seenImageUrls.has(abs) && !abs.includes('data:') && !abs.match(/\.(svg|gif)(\?|$)/i)) {
        seenImageUrls.add(abs);
        bodyImages.push(abs);
      }
    }

    // Identify named sections from semantic HTML — extract tag, role/aria-label, id, class keywords, and first heading text
    interface HtmlSection {
      tag: string;
      label: string;
      headingText: string;
      classHints: string[];
      hasImage: boolean;
    }

    const SECTION_TAGS = /^(header|nav|section|main|article|aside|footer|div)$/i;
    const LAYOUT_CLASS_KEYWORDS = /hero|banner|feature|benefit|service|about|team|testimonial|review|pricing|plan|faq|contact|cta|call-to-action|gallery|portfolio|case-study|stat|counter|highlight|intro|solution|problem|partner|client|logo|blog|news|video/i;

    const htmlSections: HtmlSection[] = [];

    // Simple regex-based tag extraction (no full DOM parser — keeps it lightweight)
    for (const m of html.matchAll(/<(header|nav|section|main|article|aside|footer)(\s[^>]*)?>[\s\S]{0,3000}?<\/\1>/gi)) {
      const tag = m[1].toLowerCase();
      const attrs = m[2] ?? '';
      const content = m[0];

      // Collect class + id + aria-label for type inference
      const classM = attrs.match(/class=["']([^"']+)["']/i);
      const idM    = attrs.match(/id=["']([^"']+)["']/i);
      const ariaM  = attrs.match(/aria-label=["']([^"']+)["']/i);
      const roleM  = attrs.match(/role=["']([^"']+)["']/i);

      const classWords = (classM?.[1] ?? '').toLowerCase().split(/\s+/).filter(w => LAYOUT_CLASS_KEYWORDS.test(w));
      const idWords    = (idM?.[1] ?? '').toLowerCase().split(/[-_\s]+/).filter(w => LAYOUT_CLASS_KEYWORDS.test(w));
      const ariaLabel  = ariaM?.[1] ?? roleM?.[1] ?? '';

      // Extract first heading text inside this section
      const headingM = content.match(/<h[1-3][^>]*>([^<]{1,80})<\/h[1-3]>/i);
      const headingText = headingM?.[1]?.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim() ?? '';

      const hasImage = /<img\s/i.test(content) || /background-image\s*:\s*url/i.test(content);
      const classHints = [...new Set([...classWords, ...idWords, ariaLabel.toLowerCase()].filter(Boolean))];

      if (classHints.length > 0 || headingText || tag !== 'div') {
        htmlSections.push({ tag, label: ariaLabel, headingText, classHints, hasImage });
      }
    }

    // Build a compact layout summary for the LLM
    const layoutLines: string[] = [];
    layoutLines.push(`PAGE URL: ${parsedUrl.toString()}`);
    layoutLines.push(`TOTAL IMAGES FOUND: ${bodyImages.length}`);
    layoutLines.push(`IMAGE URLS (first 10):\n${bodyImages.slice(0, 10).map(u => `  ${u}`).join('\n')}`);
    if (htmlSections.length > 0) {
      layoutLines.push(`\nHTML SECTIONS DETECTED (${htmlSections.length} total):`);
      htmlSections.slice(0, 20).forEach((s, i) => {
        const parts = [`  ${i + 1}. <${s.tag}>`];
        if (s.classHints.length) parts.push(`classes/id: [${s.classHints.join(', ')}]`);
        if (s.label) parts.push(`aria: "${s.label}"`);
        if (s.headingText) parts.push(`heading: "${s.headingText}"`);
        if (s.hasImage) parts.push(`(has image)`);
        layoutLines.push(parts.join(' | '));
      });
    }
    const layoutSummary = layoutLines.join('\n').slice(0, 6_000);

    // ── Step 3: LLM extraction (colors + layout in parallel) ─────────────
    const extractionPrompt = `You are a senior UI designer analyzing a website's design system.
Below are pre-categorized design tokens extracted from the site's CSS.

CRITICAL RULES — read carefully:
0. RESOLVED PAGE COLORS override everything — if this section appears, use those hex values DIRECTLY for the matching fields (PAGE BACKGROUND → background+surface, PAGE TEXT COLOR → text+textMuted, PRIMARY/BRAND COLOR → primary)
1. Use BACKGROUND TOKENS for the "background" and "surface" fields (unless overridden by rule 0)
2. Use ACCENT/BRAND TOKENS for the "primary", "secondary", and "accent" fields (unless overridden by rule 0)
3. Use TEXT TOKENS for "text" and "textMuted" fields (unless overridden by rule 0)
4. GRADIENT STOPS are the most important signal — if you see blue+pink+black gradient stops, the brand primary IS blue and secondary IS pink
5. ALL color values in your JSON must be valid hex (#rrggbb or #rgb) — never output rgba() or rgb() values
6. Dark theme rule: if THEME says DARK, or BACKGROUND TOKENS are predominantly near-black, output a dark background (luminance < 0.2). NEVER output #ffffff as background on a dark theme. White is also NOT a valid primary/secondary/accent — it belongs only in text/textMuted
7. For "headingFont" and "bodyFont" — output only the font name, no quotes, no fallback stack

Respond ONLY with a valid JSON object — no preamble, no markdown backticks.

{
  "colors": {
    "primary": "#rrggbb",
    "secondary": "#rrggbb",
    "accent": "#rrggbb",
    "background": "#rrggbb",
    "surface": "#rrggbb",
    "text": "#rrggbb",
    "textMuted": "#rrggbb"
  },
  "typography": {
    "headingFont": "font name only",
    "bodyFont": "font name only",
    "headingWeight": "700",
    "bodyWeight": "400",
    "headingStyle": "serif | sans-serif | display",
    "mood": "modern | classic | bold | minimal | playful"
  },
  "style": {
    "borderRadius": "sharp | soft | rounded",
    "spacing": "compact | comfortable | spacious",
    "vibe": "one sentence — mention the specific colors and mood"
  }
}

DESIGN TOKENS:
${colorSummary}

Remember: output ONLY the JSON object. Every color field must be a valid hex string like #0420f2.`;

    const layoutExtractionPrompt = `You are a senior UI designer analyzing a website's HTML structure and image assets.
Below is a summary of the page's HTML sections (semantic tags, class names, headings) and image URLs.

Analyze this and return a JSON object describing the design layout structure.

Respond ONLY with a valid JSON object — no preamble, no markdown backticks.

{
  "sections": ["hero", "features", "testimonials", "pricing", "cta", "footer"],
  "heroStyle": "full-bleed | split-panel | text-centered | image-left | image-right",
  "isImageHeavy": true,
  "gridColumns": 3,
  "hasVideo": false,
  "layoutDensity": "minimal | balanced | dense",
  "sectionLayouts": ["centered", "split", "card-grid", "editorial", "asymmetric"],
  "visualHierarchy": "image-led | text-led | balanced"
}

Rules:
- "sections": ordered list of section types present. Use these exact names where possible: hero, nav, features, benefits, about, team, testimonials, pricing, faq, cta, contact, gallery, stats, clients, blog, footer
- "heroStyle": how the hero section is laid out
- "isImageHeavy": true if more than 3 content images found
- "gridColumns": most common column count in feature/benefit grids (1, 2, 3, or 4)
- "sectionLayouts": one layout style per section in order (same length as "sections")
- "visualHierarchy": whether images or text dominate the visual design

HTML STRUCTURE SUMMARY:
${layoutSummary}`;

    try {
      const [colorRaw, layoutRaw] = await Promise.all([
        llmGenerateFn(extractionPrompt),
        llmGenerateFn(layoutExtractionPrompt),
      ]);

      // Parse color tokens
      const colorJsonStart = colorRaw.indexOf('{');
      const colorJsonEnd = colorRaw.lastIndexOf('}');
      if (colorJsonStart === -1 || colorJsonEnd <= colorJsonStart) {
        console.warn('[extract-url-design] LLM returned no JSON for colors');
        return reply.code(200).send({ error: 'parse_failed', tokens: null, heroImageUrl, logoUrl });
      }
      const parsed = JSON.parse(colorRaw.slice(colorJsonStart, colorJsonEnd + 1)) as Record<string, unknown>;
      const colors = parsed.colors as Record<string, string> | undefined;
      const typography = parsed.typography as Record<string, string> | undefined;
      const style = parsed.style as Record<string, string> | undefined;
      if (!colors?.primary || !typography?.headingFont || !style?.vibe) {
        console.warn('[extract-url-design] LLM returned incomplete tokens');
        return reply.code(200).send({ error: 'incomplete_tokens', tokens: null, heroImageUrl, logoUrl });
      }

      // Post-processing: deterministically fix colors the LLM got wrong
      // 1. Dark theme but LLM returned a light background or surface → override
      if (isDarkTheme && dominantDarkBg) {
        if (colors.background && hexLum(colors.background) > 0.7) {
          console.warn(`[extract-url-design] dark theme but LLM output light bg ${colors.background} — overriding with ${dominantDarkBg}`);
          colors.background = dominantDarkBg;
        }
        // Surface is checked independently — LLM often gets background right but leaves surface white
        if (colors.surface && hexLum(colors.surface) > 0.7) {
          console.warn(`[extract-url-design] dark theme but LLM output light surface ${colors.surface} — overriding with ${dominantDarkBg}`);
          colors.surface = dominantDarkBg;
        }
      }
      // 2. Near-white primary/secondary/accent → replace with best non-white accent token
      for (const field of ['primary', 'secondary', 'accent'] as const) {
        if (colors[field] && hexLum(colors[field]) > 0.92) {
          const replacement = accentTokens.find(t => hexLum(t.val) <= 0.92 && hexLum(t.val) >= 0.03);
          if (replacement) {
            console.warn(`[extract-url-design] near-white ${field} ${colors[field]} → replacing with ${replacement.val}`);
            colors[field] = replacement.val;
          }
        }
      }

      // Parse layout structure
      let layout: Record<string, unknown> | null = null;
      try {
        const layoutJsonStart = layoutRaw.indexOf('{');
        const layoutJsonEnd = layoutRaw.lastIndexOf('}');
        if (layoutJsonStart !== -1 && layoutJsonEnd > layoutJsonStart) {
          layout = JSON.parse(layoutRaw.slice(layoutJsonStart, layoutJsonEnd + 1)) as Record<string, unknown>;
        }
      } catch {
        console.warn('[extract-url-design] layout JSON parse failed — continuing without layout');
      }

      console.log(`[extract-url-design] success — vibe="${style.vibe}", primary=${colors.primary}, sections=${JSON.stringify((layout as Record<string, unknown> | null)?.sections ?? [])}${heroImageUrl ? `, og:image found` : ''}${logoUrl ? `, logo found` : ''}`);
      return reply.code(200).send({
        tokens: parsed,
        heroImageUrl,
        logoUrl,
        images: bodyImages.slice(0, 20),
        layout,
      });
    } catch (err) {
      console.warn('[extract-url-design] parse error:', err instanceof Error ? err.message : String(err));
      return reply.code(200).send({ error: 'parse_failed', tokens: null, heroImageUrl, logoUrl });
    }
  });

  // POST /presentations/synthesize-style
  // Runs Pass -1 only: synthesize a design system from an inspiration image (and optional text prompt).
  // Returns the raw design-system tokens + font URLs — the caller can store these and pass them
  // as preSynthesizedDesignSystem in the /generate body to skip Pass -1 during full generation.
  app.post('/presentations/synthesize-style', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      image?: string;
      basePlugin?: string;
      brandPrimaryColor?: string;
      textPrompt?: string;
    } | undefined;

    if (!body?.image?.trim()) {
      return reply.code(400).send({ error: 'Missing required field: image (base64 data URL)' });
    }

    const { image, basePlugin = 'cobalt', brandPrimaryColor, textPrompt = '' } = body;

    try {
      const hasImage = true;
      const imagePrefix = `DESIGN_IMAGE:${image}\n\n`;
      const prompt = imagePrefix + buildDesignSystemPrompt(textPrompt, basePlugin, brandPrimaryColor, hasImage);

      const raw = await llmGenerateFn(prompt);

      // Extract JSON from the LLM response (may contain preamble)
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd <= jsonStart) {
        return reply.code(502).send({ error: 'Design system synthesis returned invalid JSON' });
      }
      const jsonStr = raw.slice(jsonStart, jsonEnd + 1);
      let rawTokens: Record<string, unknown>;
      try {
        rawTokens = JSON.parse(jsonStr) as Record<string, unknown>;
      } catch {
        return reply.code(502).send({ error: 'Failed to parse design system JSON' });
      }

      const fonts = buildFontUrls(rawTokens);
      return reply.send({ designSystem: rawTokens, fonts });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Design system synthesis failed: ${message}` });
    }
  });

  // GET /presentations?namespace=<ns>
  app.get('/presentations', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.query as { namespace?: string };
    if (!namespace) {
      return reply.code(400).send({ error: 'Missing required query param: namespace' });
    }
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const presentations = await listPresentations(workdir, namespace);

    // Also surface chat-generated microsites (Layout AST saved by save-asset or tool-handlers).
    // These never create a presentation record in workdir/presentations/, so they would otherwise
    // be invisible to the namespace panel. We synthesize a minimal entry from the AST.
    const existingIds = new Set(presentations.map((p) => p.proposalId));
    const astCandidates = [
      path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json'),
      path.join(workdir, 'data', 'namespaces', namespace, 'assets', 'presentations', namespace, 'site-ast.json'),
    ];
    for (const astPath of astCandidates) {
      try {
        const raw = await readFile(astPath, 'utf-8');
        const ast = JSON.parse(raw) as { proposalId?: string; meta?: { title?: string }; generatedAt?: string };
        const proposalId = ast.proposalId ?? namespace;
        if (!existingIds.has(proposalId)) {
          const fileStat = await stat(astPath);
          presentations.push({
            namespace,
            proposalId,
            fileName: '',
            config: { theme: 'light', accentColor: '#2563eb', hiddenSections: [], showPricing: true },
            sections: [],
            createdAt: ast.generatedAt ?? fileStat.mtime.toISOString(),
            updatedAt: fileStat.mtime.toISOString(),
          });
          existingIds.add(proposalId);
        }
      } catch { /* no AST at this path — skip */ }
    }

    return reply.send({ presentations });
  });

  // GET /presentations/history — all saved microsite ASTs across every namespace
  app.get('/presentations/history', async (req: FastifyRequest, reply: FastifyReply) => {
    const assetsDir = path.join(workdir, 'assets', 'presentations');
    const namespacesDir = path.join(workdir, 'data', 'namespaces');

    const entriesMap = new Map<string, { namespace: string; savedAt: string; ast: unknown }>();

    // Primary path: workdir/assets/presentations/<ns>/site-ast.json  (UI builder writes here)
    let primaryDirs: string[] = [];
    try { primaryDirs = await readdir(assetsDir); } catch { /* directory may not exist yet */ }
    await Promise.all(
      primaryDirs.map(async (ns) => {
        try {
          const astPath = path.join(assetsDir, ns, 'site-ast.json');
          const raw = await readFile(astPath, 'utf-8');
          const ast = JSON.parse(raw);
          const fileStat = await stat(astPath);
          entriesMap.set(ns, { namespace: ns, savedAt: fileStat.mtime.toISOString(), ast });
        } catch { /* skip */ }
      }),
    );

    // Fallback path: workdir/data/namespaces/<ns>/assets/presentations/<ns>/site-ast.json
    // (save-asset tool writes here; chat-generated microsites land here)
    let fallbackDirs: string[] = [];
    try { fallbackDirs = await readdir(namespacesDir); } catch { /* directory may not exist */ }
    await Promise.all(
      fallbackDirs.map(async (ns) => {
        if (entriesMap.has(ns)) return; // primary path already has this namespace
        try {
          const astPath = path.join(namespacesDir, ns, 'assets', 'presentations', ns, 'site-ast.json');
          const raw = await readFile(astPath, 'utf-8');
          const ast = JSON.parse(raw);
          const fileStat = await stat(astPath);
          entriesMap.set(ns, { namespace: ns, savedAt: fileStat.mtime.toISOString(), ast });
        } catch { /* namespace has no saved AST — skip */ }
      }),
    );

    if (entriesMap.size === 0) return reply.send({ entries: [] });

    const entries = [...entriesMap.values()];
    // Sort newest first
    entries.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    return reply.send({ entries });
  });

  // POST /presentations/history/save — save an AST entry for a namespace
  app.post('/presentations/history/save', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { namespace?: string; ast?: unknown } | undefined;
    if (!body?.namespace || !body?.ast) {
      return reply.code(400).send({ error: 'Missing required fields: namespace, ast' });
    }
    const { namespace, ast } = body;
    const nsDir = path.join(workdir, 'assets', 'presentations', namespace);
    await mkdir(nsDir, { recursive: true });
    await writeFile(path.join(nsDir, 'site-ast.json'), JSON.stringify(ast, null, 2), 'utf-8');
    return reply.send({ ok: true });
  });

  // DELETE /presentations/history/:namespace — remove a namespace's saved AST
  app.delete('/presentations/history/:namespace', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string };
    const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
    try {
      await rm(astPath);
    } catch {
      // File didn't exist — still return ok
    }
    return reply.send({ ok: true });
  });

  // POST /presentations/create
  app.post('/presentations/create', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { fileName?: string; namespace?: string } | undefined;
    if (!body?.fileName || !body?.namespace) {
      return reply.code(400).send({ error: 'Missing required fields: fileName, namespace' });
    }

    const { fileName, namespace } = body;
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    // Validate proposal status
    const mdPath = resolveProposalMdPath(workdir, fileName, namespace);
    const meta = await readMeta(mdPath);
    if (!meta) {
      return reply.code(404).send({ error: `Proposal not found: ${fileName}` });
    }

    if (meta.status !== 'approved' && meta.status !== 'finalized') {
      return reply.code(400).send({
        error: 'Proposal must be approved or finalized to create a presentation',
      });
    }

    // Read proposal markdown
    let markdown: string;
    try {
      markdown = await readFile(mdPath, 'utf-8');
    } catch {
      return reply.code(404).send({ error: `Proposal file not found: ${fileName}` });
    }

    const sections = parseProposalMarkdown(markdown);
    const proposalId = fileName.replace(/\.md$/, '');

    const presentation = await createPresentation(workdir, namespace, proposalId, fileName, sections);
    return reply.code(201).send({ presentation });
  });

  // GET /presentations/:namespace/:proposalId
  app.get('/presentations/:namespace/:proposalId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    try {
      const presentation = await getPresentation(workdir, namespace, proposalId);
      return reply.send({ presentation });
    } catch (err) {
      if ((err as { code?: string }).code === 'NOT_FOUND') {
        return reply.code(404).send({ error: 'Presentation not found' });
      }
      throw err;
    }
  });

  // POST /presentations/:namespace/:proposalId/config
  app.post('/presentations/:namespace/:proposalId/config', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as Partial<PresentationConfig> | undefined;
    if (!body) {
      return reply.code(400).send({ error: 'Missing config body' });
    }

    const { theme, accentColor, hiddenSections, showPricing } = body;
    if (!theme || !['light', 'dark', 'brand'].includes(theme)) {
      return reply.code(400).send({ error: 'theme must be one of: light, dark, brand' });
    }
    if (typeof accentColor !== 'string') {
      return reply.code(400).send({ error: 'accentColor must be a string' });
    }
    if (!Array.isArray(hiddenSections)) {
      return reply.code(400).send({ error: 'hiddenSections must be an array' });
    }
    if (typeof showPricing !== 'boolean') {
      return reply.code(400).send({ error: 'showPricing must be a boolean' });
    }

    try {
      const presentation = await updateConfig(workdir, namespace, proposalId, {
        theme,
        accentColor,
        hiddenSections,
        showPricing,
      });
      return reply.send({ presentation });
    } catch (err) {
      if ((err as { code?: string }).code === 'NOT_FOUND') {
        return reply.code(404).send({ error: 'Presentation not found' });
      }
      throw err;
    }
  });

  // POST /presentations/:namespace/:proposalId/generate
  // Calls microsite-generator-agent to produce MDX presentation files.
  app.post('/presentations/:namespace/:proposalId/generate', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as {
      proposalMarkdown?: string;
      plugin?: string;
      brand?: Record<string, unknown>;
      customInstructions?: string;
      preSynthesizedDesignSystem?: Record<string, unknown>;
    } | null;

    // Use markdown from body if provided, otherwise read from disk
    let markdown: string;
    if (body?.proposalMarkdown) {
      markdown = body.proposalMarkdown;
    } else {
      let presentation: Awaited<ReturnType<typeof getPresentation>>;
      try {
        presentation = await getPresentation(workdir, namespace, proposalId);
      } catch (err) {
        if ((err as { code?: string }).code === 'NOT_FOUND') {
          return reply.code(404).send({ error: 'Presentation not found' });
        }
        throw err;
      }
      const mdPath = resolveProposalMdPath(workdir, presentation.fileName, namespace);
      try {
        markdown = await readFile(mdPath, 'utf-8');
      } catch {
        return reply.code(404).send({ error: `Proposal file not found: ${presentation.fileName}` });
      }
    }

    ensureRegistered(workdir);

    let runner;
    try {
      runner = await buildRunner(workdir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: `Failed to initialize agent runner: ${message}` });
    }

    // Build Brief-aware instructions for this namespace
    let briefPrefix = '';
    try {
      const ctxSvc = new ContextService(workdir);
      const ctx = await ctxSvc.get(namespace);
      const fields = ctx?.requirements?.fields ?? {};
      const projectType = (fields.projectType?.value as string | undefined) ?? 'professional services';
      const clientName = (fields.clientName?.value as string | undefined) ?? 'the client';
      const clientIndustry = (fields.clientIndustry?.value as string | undefined) ?? 'general';
      briefPrefix = [
        buildBriefFramingRule(projectType, clientName, clientIndustry),
        '',
        buildSectionTypeGuidance(projectType),
        '',
        buildSectionOrderGuidance(projectType),
        '',
      ].join('\n');
    } catch { /* non-fatal — proceed without Brief context */ }

    const effectiveInstructions = body?.customInstructions
      ? `${briefPrefix}${body.customInstructions}`
      : briefPrefix || undefined;

    try {
      const result = await runner.run('microsite-generator-agent', {
        namespace,
        ...(effectiveInstructions ? { prompt: effectiveInstructions } : {}),
        metadata: {
          proposalMarkdown: markdown,
          ...(body?.plugin ? { plugin: body.plugin } : {}),
          ...(body?.brand ? { brand: body.brand } : {}),
          ...(effectiveInstructions ? { customInstructions: effectiveInstructions } : {}),
          ...(body?.preSynthesizedDesignSystem ? { preSynthesizedDesignSystem: body.preSynthesizedDesignSystem } : {}),
        },
      });

      // Resolve images for all visual sections in parallel
      type AstSection = { sectionType: string; image: { source: string; query: string; url: string | null }; content: Record<string, unknown> };
      const ast = result.json as { sections?: AstSection[]; brand?: { primaryColor?: string } } | null | undefined;
      if (ast?.sections) {
        const hasUnsplash = !!(env.UNSPLASH_ACCESS_KEY?.trim());
        const hasDalle = !!(env.OPENAI_API_KEY?.trim());
        const hasPexels = !!(env.PEXELS_API_KEY?.trim());
        const accentColor = ast.brand?.primaryColor;

        await Promise.all(
          ast.sections.map(async (sec) => {
            const query = (sec.content.imageQuery as string | undefined) || sec.image.query;
            if (!query?.trim()) return;

            const chosenSource = resolveImageSource(sec.sectionType, hasUnsplash, hasDalle, hasPexels);
            if (chosenSource === 'gradient') {
              sec.image.url = null;
              sec.image.source = 'gradient';
              return;
            }

            sec.image.source = chosenSource;
            const secId = (sec as unknown as { id?: string }).id ?? sec.sectionType;

            if (chosenSource === 'pexels') {
              const remoteUrl = await fetchPexelsImageUrl(query);
              if (remoteUrl) sec.image.url = await saveImagePersistently(remoteUrl, namespace, secId, workdir);
            } else if (chosenSource === 'dalle') {
              const prompt = buildDallePrompt(sec.sectionType, query, accentColor);
              const result = await generateGptImage1(prompt);
              if (result) {
                const hash = crypto.createHash('sha1').update(result.b64.slice(0, 64)).digest('hex').slice(0, 8);
                const filename = `${secId}-${hash}.png`;
                const destPath = path.join(workdir, 'assets', 'presentations', namespace, 'images', filename);
                const saved = await saveBase64ToFile(result.b64, destPath);
                if (saved) sec.image.url = `/presentation-images/${namespace}/${filename}`;
              } else {
                // fallback to DALL-E 3 if gpt-image-1 fails
                const dallePrompt = buildDallePrompt(sec.sectionType, query, accentColor);
                const remoteUrl = await generateDalle3Image(dallePrompt);
                if (remoteUrl) sec.image.url = await saveImagePersistently(remoteUrl, namespace, secId, workdir);
              }
            } else if (chosenSource === 'picsum') {
              sec.image.url = await saveImagePersistently(buildPicsumUrl(query), namespace, secId, workdir);
            } else {
              const remoteUrl = await fetchUnsplashImageUrl(query);
              if (remoteUrl) sec.image.url = await saveImagePersistently(remoteUrl, namespace, secId, workdir);
            }
          }),
        );

        const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
        await mkdir(path.dirname(astPath), { recursive: true });
        await writeFile(astPath, JSON.stringify(ast, null, 2), 'utf-8');
      }

      return reply.send({ ast: result.json ?? null, assets: result.assets ?? [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Agent execution failed: ${message}` });
    }
  });

  /** Build a clean Pexels photo search query from section content — avoids DALL-E cinematic prompts. */
  function buildPexelsQueryFromSection(sectionType: string, content: Record<string, unknown>): string {
    const STOP = new Set(['a','an','the','and','or','of','in','at','to','for','with','by','from','into','on','our','your','this','that','is','are','be','its','how','why','what','all','any']);
    const clean = (s: string) => s.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w.toLowerCase()));
    const eyebrow = clean((content.eyebrow as string | undefined) ?? '').slice(0, 3);
    const headline = clean((content.headline as string | undefined) ?? '').slice(0, 4);
    const words = eyebrow.length >= 2 ? eyebrow : headline.slice(0, 3);
    const TYPE_DEFAULTS: Record<string, string> = {
      hero: 'vibrant outdoor adventure park',
      overview: 'business team meeting professional',
      challenge: 'problem solving strategy whiteboard',
      approach: 'strategy planning professional team',
      deliverables: 'project delivery checklist professional',
      timeline: 'project planning calendar schedule',
      pricing: 'business investment finance planning',
      whyus: 'professional team expertise collaboration',
      nextsteps: 'business handshake partnership agreement',
      generic: 'professional office workspace modern',
      testimonials: 'happy client satisfaction review',
      showcase: 'portfolio creative work professional',
      benefits: 'business growth success achievement',
      casestudy: 'case study success analysis',
      team: 'professional team collaboration office',
      comparison: 'comparison analysis chart data',
      security: 'cybersecurity protection digital',
      techstack: 'technology software development code',
      testing: 'quality testing professional lab',
      faq: 'customer support questions answers',
      stats: 'data analytics statistics dashboard',
      metrics: 'performance analytics kpi dashboard',
    };
    return words.length >= 2 ? words.join(' ') : (TYPE_DEFAULTS[sectionType] ?? 'professional business office');
  }

  // POST /presentations/:namespace/:proposalId/generate-stream
  // Like /generate but streams progress via SSE. Each section completes → SSE event.
  // Events: plan | section | images | complete | error
  app.post('/presentations/:namespace/:proposalId/generate-stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    // Hijack the reply so Fastify doesn't interfere with our raw SSE response
    reply.hijack();

    // SSE headers — must be set before any writes
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (data: Record<string, unknown>) => {
      try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client disconnected */ }
    };

    const body = req.body as {
      proposalMarkdown?: string;
      plugin?: string;
      brand?: Record<string, unknown>;
      customInstructions?: string;
      fullDesignPrompt?: string;
      designBrief?: string;
      preSynthesizedDesignSystem?: Record<string, unknown>;
      pdfFriendly?: boolean;
      referenceFile?: { base64: string; mediaType: string; fileName: string; dominantColors?: string[] };
      urlReferenceDesign?: Record<string, unknown> | null;
      urlLayout?: Record<string, unknown> | null;
      urlImages?: string[];
    } | undefined;

    // Load markdown from body or saved file
    let markdown = body?.proposalMarkdown ?? '';
    if (!markdown) {
      try {
        let presentation: Awaited<ReturnType<typeof getPresentation>>;
        try { presentation = await getPresentation(workdir, namespace, proposalId); } catch { return send({ type: 'error', message: 'Presentation not found' }); }
        const mdPath = resolveProposalMdPath(workdir, presentation.fileName, namespace);
        markdown = await readFile(mdPath, 'utf-8');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message });
        return reply.raw.end();
      }
    }

    ensureRegistered(workdir);
    let runner;
    try { runner = await buildRunner(workdir); } catch (err) {
      send({ type: 'error', message: `Runner init failed: ${err instanceof Error ? err.message : String(err)}` });
      return reply.raw.end();
    }

    // Pre-compute image config so parallel fetches can start during section generation
    const hasUnsplash = !!(env.UNSPLASH_ACCESS_KEY?.trim());
    const hasDalle = !!(env.OPENAI_API_KEY?.trim());
    const hasPexels = !!(env.PEXELS_API_KEY?.trim());
    const accentColor = (body?.brand?.primaryColor as string | undefined) ?? undefined;
    const urlHeroImageUrl = (body?.urlReferenceDesign as { heroImageUrl?: string | null } | undefined)?.heroImageUrl ?? null;


    const pdfFriendly = !!(body?.pdfFriendly);
    // Tracks how many extra continuation sections have been emitted so far;
    // used to shift the index of all subsequent sections forward correctly.
    let sectionIndexOffset = 0;

    // Item-array fields that can make a section too tall for a slide
    const PDF_ITEM_FIELDS = ['pillars','items','stats','features','benefits','steps','phases','technologies','layers','metrics','comparisons','deliverables','questions','rows','testimonials'];
    const PDF_MAX_PER_SLIDE = 4;

    // Build Brief-aware instructions — reads context.json for projectType/clientName/industry
    let streamBriefPrefix = '';
    try {
      const ctxSvc = new ContextService(workdir);
      const ctx = await ctxSvc.get(namespace);
      const fields = ctx?.requirements?.fields ?? {};
      const projectType = (fields.projectType?.value as string | undefined) ?? 'professional services';
      const clientName = (fields.clientName?.value as string | undefined) ?? 'the client';
      const clientIndustry = (fields.clientIndustry?.value as string | undefined) ?? 'general';
      streamBriefPrefix = [
        buildBriefFramingRule(projectType, clientName, clientIndustry),
        '',
        buildSectionTypeGuidance(projectType),
        '',
        buildSectionOrderGuidance(projectType),
        '',
      ].join('\n');
    } catch { /* non-fatal */ }

    const streamEffectiveInstructions = body?.customInstructions
      ? `${streamBriefPrefix}${body.customInstructions}`
      : streamBriefPrefix || undefined;

    // Design skill Phase 1 — enrich metadata with frontend-design directives before agent runs
    const { metadata: skillMetadata, tone: designTone } = applyDesignSkill(
      'microsite-generator-agent',
      {
        proposalMarkdown: markdown,
        plugin: body?.plugin ?? 'cobalt',
        brand: body?.brand ?? {},
        ...(streamEffectiveInstructions ? { customInstructions: streamEffectiveInstructions } : {}),
        ...(body?.designBrief ? { designBrief: body.designBrief } : {}),
      },
    );

    // Start CSS token generation in parallel with the agent — tone is already known.
    // This means CSS vars are ready (or nearly ready) when the first sections arrive.
    const cssThemePromise: Promise<CSSTheme | null> = generateThemeCSSTokens(
      designTone as string,
      body?.brand?.primaryColor as string | undefined,
      llmGenerateFn,
    ).catch(() => null);

    // Track per-section HTML generated during streaming so we can inject it into the final AST
    const streamedHtmlMap = new Map<string, string>(); // sectionId → customHtml
    let htmlLayoutIdx = 0; // cycles A-F layouts across sections

    try {
      send({ type: 'start', message: 'Pipeline started' });

      const result = await runner.run('microsite-generator-agent', {
        namespace,
        ...(skillMetadata.customInstructions ? { prompt: skillMetadata.customInstructions as string } : {}),
        metadata: {
          ...skillMetadata,
          ...(body?.fullDesignPrompt ? { fullDesignPrompt: body.fullDesignPrompt } : {}),
          ...(body?.designBrief ? { designBrief: body.designBrief } : {}),
          ...(body?.preSynthesizedDesignSystem ? { preSynthesizedDesignSystem: body.preSynthesizedDesignSystem } : {}),
          ...(body?.pdfFriendly ? { pdfFriendly: true } : {}),
          ...(body?.referenceFile ? { referenceFile: body.referenceFile } : {}),
          ...(body?.urlReferenceDesign ? { urlReferenceDesign: body.urlReferenceDesign } : {}),
          ...(body?.urlLayout ? { urlLayout: body.urlLayout } : {}),
          ...(body?.urlImages?.length ? { urlImages: body.urlImages } : {}),
          // Plan callback — fires once with the final section list before generation starts
          onPlanReady: (plan: Record<string, unknown>) => {
            send({ type: 'plan', totalSections: plan.totalSections, sectionTypes: plan.sectionTypes, ...(plan.referenceCssVars ? { referenceCssVars: plan.referenceCssVars } : {}) });
          },
          // Section callback — fires after each section's LLM call completes; kicks off image fetch immediately
          onSectionComplete: (section: Record<string, unknown>) => {
            const content = ((section.content ?? {}) as Record<string, unknown>);
            const rawIdx = (section.index as number | undefined) ?? 0;
            const adjustedIdx = rawIdx + sectionIndexOffset;

            // ── pdfFriendly: split oversized item arrays into continuation slides ──────
            if (pdfFriendly) {
              for (const field of PDF_ITEM_FIELDS) {
                const items = content[field];
                if (Array.isArray(items) && items.length > PDF_MAX_PER_SLIDE) {
                  // Trim the primary section to first N items
                  content[field] = items.slice(0, PDF_MAX_PER_SLIDE);
                  const pdfSectionType = section.sectionType as string | undefined;
                  const pdfChosenSource = pdfSectionType ? resolveImageSource(pdfSectionType, hasUnsplash, hasDalle, hasPexels) : 'gradient';
                  const pdfImageForClient = pdfChosenSource === 'gradient'
                    ? { ...(section.image as object ?? {}), url: null, source: 'gradient' }
                    : section.image;
                  send({ type: 'section', ...section, image: pdfImageForClient, content, index: adjustedIdx });
                  console.log(`[routes] PDF FRIENDLY: split "${section.sectionType as string}" — ${items.length} ${field} → ${PDF_MAX_PER_SLIDE} + continuation`);

                  // Emit continuation slides for remaining items
                  let remaining = items.slice(PDF_MAX_PER_SLIDE) as unknown[];
                  let contNum = 1;
                  while (remaining.length > 0) {
                    sectionIndexOffset++;
                    const chunk = remaining.slice(0, PDF_MAX_PER_SLIDE);
                    remaining = remaining.slice(PDF_MAX_PER_SLIDE);
                    const contContent: Record<string, unknown> = {
                      eyebrow: content.eyebrow ?? '',
                      headline: content.headline ?? '',
                      [field]: chunk,
                      diagram: '',
                    };
                    send({
                      type: 'section',
                      id: `${section.id as string}-cont${contNum}`,
                      heading: section.heading,
                      sectionType: section.sectionType,
                      content: contContent,
                      index: adjustedIdx + contNum,
                    });
                    contNum++;
                  }

                  return; // handled — skip normal send below
                }
              }
            }

            // ── Normal (no split needed) ──────────────────────────────────────────────
            const sectionType = section.sectionType as string | undefined;
            const chosenSource = sectionType ? resolveImageSource(sectionType, hasUnsplash, hasDalle, hasPexels) : 'gradient';
            // Strip agent's loremflickr URL for gradient sections — prevents flicker in client.
            // Agent doesn't include image.url in callback data anyway, but guard for safety.
            const imageForClient = chosenSource === 'gradient'
              ? { ...(section.image as object ?? {}), url: null, source: 'gradient' }
              : section.image;
            send({ type: 'section', ...section, image: imageForClient, content, index: adjustedIdx });

            // Fire HTML generation immediately after streaming section data — no blocking
            const capturedSection = { ...section, content: { ...content }, image: imageForClient };
            const capturedLayoutIdx = htmlLayoutIdx++;
            const capturedSectionType = sectionType ?? '';
            void (async () => {
              try {
                if (!CUSTOM_HTML_SECTION_TYPES.has(capturedSectionType)) return;
                const cssTheme = await cssThemePromise;
                if (!cssTheme) return;
                const html = await generateSectionHtml(
                  capturedSection as Record<string, unknown>,
                  designTone as unknown as Tone,
                  cssTheme.cssVars,
                  null,
                  llmGenerateFn,
                  capturedLayoutIdx,
                );
                const secId = (capturedSection as Record<string, unknown>).id as string | undefined;
                if (secId) {
                  streamedHtmlMap.set(secId, html);
                  send({ type: 'section_html', id: secId, customHtml: html });
                }
              } catch { /* non-fatal — injectThemeCSS fallback will cover this section */ }
            })();
          },
        },
      });

      type AstSection = { sectionType: string; image: { source: string; query: string; url: string | null }; content: Record<string, unknown> };
      const ast = result.json as { sections?: AstSection[]; brand?: { primaryColor?: string } } | null | undefined;
      const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');

      // Resolve and persist images for ALL sections using content-based Pexels queries.
      // Deduplication prevents the same photo appearing on multiple sections.
      if (ast?.sections) {
        const usedImageHashes = new Set<string>(); // SHA-1 of file bytes — prevents identical images
        const usedPexelsUrls = new Set<string>();  // prevents same URL assigned to two sections

        await Promise.all(
          ast.sections.map(async (sec) => {
            const secId = (sec as unknown as { id?: string }).id ?? sec.sectionType;

            if (sec.sectionType === 'hero' && urlHeroImageUrl) {
              try {
                const localUrl = await saveImagePersistently(urlHeroImageUrl, namespace, `${secId}-og`, workdir);
                sec.image.url = localUrl;
                sec.image.source = 'custom';
                return;
              } catch { /* fall through */ }
            }

            // Build a clean content-based query — never use DALL-E cinematic prompts for photo search
            const pexelsQuery = buildPexelsQueryFromSection(sec.sectionType, sec.content);
            let remoteUrl: string | null = null;

            if (hasPexels) {
              // Try full query, then progressively shorter to get a unique result
              const words = pexelsQuery.split(/\s+/);
              const candidates = [pexelsQuery, words.slice(0, 2).join(' ')].filter((q, i, a) => q && a.indexOf(q) === i);
              for (const q of candidates) {
                const url = await fetchPexelsImageUrl(q);
                if (url && !usedPexelsUrls.has(url)) { remoteUrl = url; usedPexelsUrls.add(url); break; }
              }
            }
            if (!remoteUrl) remoteUrl = await fetchLoremflickrUrl(pexelsQuery);
            if (!remoteUrl) remoteUrl = await fetchUnsplashImageUrl(pexelsQuery);
            if (!remoteUrl) remoteUrl = buildPicsumUrl(pexelsQuery);
            if (!remoteUrl) return;

            try {
              const localUrl = await saveImagePersistently(remoteUrl, namespace, secId, workdir);
              // Dedup by file content hash — reject identical bytes (cat image has fixed 248658 bytes)
              const imgRes = await fetch(localUrl.startsWith('/') ? `http://localhost:${process.env.PORT ?? 3001}${localUrl}` : remoteUrl, { signal: AbortSignal.timeout(8000) }).catch(() => null);
              if (imgRes?.ok) {
                const buf = Buffer.from(await imgRes.arrayBuffer());
                const contentHash = require('node:crypto').createHash('sha1').update(buf).digest('hex').slice(0, 12);
                if (usedImageHashes.has(contentHash)) {
                  // Identical bytes already used — fall back to loremflickr with unique seed
                  const fallbackUrl = await fetchLoremflickrUrl(`${sec.sectionType} ${pexelsQuery} ${secId}`);
                  if (fallbackUrl) { sec.image.url = fallbackUrl; sec.image.source = 'loremflickr'; }
                  return;
                }
                usedImageHashes.add(contentHash);
              }
              sec.image.url = localUrl;
              sec.image.source = hasPexels ? 'pexels' : 'unsplash';
            } catch { sec.image.url = remoteUrl; }
          }),
        );
      }

      // Download brand logo locally if it's a remote URL, so it renders reliably in the microsite
      const brandLogoRemote = (body?.brand?.logoUrl as string | null | undefined);
      if (brandLogoRemote?.startsWith('http') && ast?.brand) {
        try {
          const logoExt = (() => {
            try {
              const p = new URL(brandLogoRemote).pathname;
              const m = p.match(/\.(png|svg|jpg|jpeg|webp|ico)(?:[?#]|$)/i);
              return m ? `.${m[1].toLowerCase()}` : '.png';
            } catch { return '.png'; }
          })();
          const imagesDir = path.join(workdir, 'assets', 'presentations', namespace, 'images');
          await mkdir(imagesDir, { recursive: true });
          const logoFilename = `brand-logo-${crypto.randomUUID().slice(0, 8)}${logoExt}`;
          const ok = await downloadImageToFile(brandLogoRemote, path.join(imagesDir, logoFilename));
          if (ok) (ast.brand as Record<string, unknown>).logoUrl = `/presentation-images/${namespace}/${logoFilename}`;
        } catch { /* keep remote URL */ }
      }

      // Inject HTML that was streamed per-section during generation into the final AST
      if (ast?.sections && streamedHtmlMap.size > 0) {
        for (const sec of ast.sections) {
          const secId = (sec as unknown as { id?: string }).id;
          if (secId) {
            const html = streamedHtmlMap.get(secId);
            if (html) (sec as unknown as { customHtml?: string }).customHtml = html;
          }
        }
      }

      // Design skill Phase 2+3 — pass cached CSS theme so Phase 2 is skipped;
      // Phase 3 only runs for sections that didn't receive HTML during streaming
      const cachedTheme = await cssThemePromise;
      if (ast) {
        await injectThemeCSS(
          ast as unknown as Record<string, unknown>,
          designTone,
          (body?.brand?.primaryColor as string | undefined),
          llmGenerateFn,
          [],
          cachedTheme ?? undefined,
        );
      }

      // complete event carries local image URLs — no further reconciliation needed
      send({ type: 'complete', ast });
      if (ast?.sections) {
        await writeFile(astPath, JSON.stringify(ast, null, 2), 'utf-8');
      }
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      reply.raw.end();
    }
  });

  // GET /presentations/:namespace/:proposalId/microsite
  // Returns the previously generated site AST (null if not yet generated).
  // Checks primary path first, then fallback path used by the chat pipeline's save-asset tool.
  app.get('/presentations/:namespace/:proposalId/microsite', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const primaryPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
    const fallbackPath = path.join(workdir, 'data', 'namespaces', namespace, 'assets', 'presentations', namespace, 'site-ast.json');

    for (const astPath of [primaryPath, fallbackPath]) {
      try {
        const raw = await readFile(astPath, 'utf-8');
        const fileStat = await stat(astPath);
        return reply.send({ ast: JSON.parse(raw), savedAt: fileStat.mtime.toISOString() });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    return reply.send({ ast: null, savedAt: null });
  });

  // PUT /presentations/:namespace/:proposalId/microsite
  // Save (overwrite) the microsite AST to disk — used when user edits sections in the viewer.
  app.put('/presentations/:namespace/:proposalId/microsite', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as { ast?: Record<string, unknown> } | undefined;
    if (!body?.ast) return reply.code(400).send({ error: 'ast is required' });

    const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
    await mkdir(path.dirname(astPath), { recursive: true });
    await writeFile(astPath, JSON.stringify(body.ast, null, 2), 'utf-8');

    return reply.send({ ok: true, proposalId });
  });

  // POST /presentations/:namespace/logo
  // Upload a logo image for a namespace. Saves to workdir/assets/presentations/:namespace/logo.<ext>
  // Returns { url } — a server-relative path clients can use directly in <img> tags.
  app.post('/presentations/:namespace/logo', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });

    const mime = data.mimetype ?? '';
    const allowed = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp', 'image/x-icon'];
    if (!allowed.includes(mime)) {
      return reply.code(400).send({ error: `Unsupported image type: ${mime}` });
    }

    const extMap: Record<string, string> = {
      'image/png': 'png', 'image/svg+xml': 'svg', 'image/jpeg': 'jpg',
      'image/webp': 'webp', 'image/x-icon': 'ico',
    };
    const ext = extMap[mime] ?? 'png';
    const imagesDir = path.join(workdir, 'assets', 'presentations', namespace, 'images');
    await mkdir(imagesDir, { recursive: true });
    const logoFilename = `brand-logo.${ext}`;
    const logoPath = path.join(imagesDir, logoFilename);

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) chunks.push(chunk as Buffer);
    await writeFile(logoPath, Buffer.concat(chunks));

    const url = `/presentation-images/${namespace}/${logoFilename}`;
    return reply.send({ url });
  });

  // POST /presentations/:namespace/:proposalId/design-edit
  // Apply AI-driven design or content edits to an existing microsite AST.
  // Body: { instruction, targetSectionId?, currentAst, commit?: boolean }
  // Returns: { ast, mode, changed, summary }
  app.post('/presentations/:namespace/:proposalId/design-edit', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as {
      instruction?: string;
      targetSectionId?: string;
      currentAst?: Record<string, unknown>;
      commit?: boolean;
    };

    const instruction = body.instruction?.trim();
    if (!instruction) {
      return reply.code(400).send({ error: 'instruction is required' });
    }

    // Load AST from body or fall back to saved file
    let currentAst = body.currentAst;
    if (!currentAst) {
      const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
      try {
        const raw = await readFile(astPath, 'utf-8');
        currentAst = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return reply.code(404).send({ error: `No microsite AST found for ${namespace}/${proposalId}` });
      }
    }

    const generateFn = llmGenerateFn;

    const agent = new DesignEditorAgent();
    const result = await agent.run({
      namespace,
      metadata: {
        currentAst,
        instruction,
        targetSectionId: body.targetSectionId,
        generateFn,
      },
    });

    const editResult = result.json as { ast: Record<string, unknown>; mode: string; changed: string[] } | null;
    if (!editResult) {
      return reply.code(500).send({ error: 'Design editor returned no result' });
    }

    // Optionally save patched AST back to disk
    if (body.commit !== false) {
      const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
      await writeFile(astPath, JSON.stringify(editResult.ast, null, 2), 'utf-8');
    }

    return reply.send({
      ast: editResult.ast,
      mode: editResult.mode,
      changed: editResult.changed,
      summary: result.markdown ?? '',
    });
  });

  // POST /presentations/:namespace/:proposalId/publish
  // Export the microsite AST to a self-contained HTML file.
  // Body: { ast?: Record<string, unknown>, format?: 'html' }
  // Returns: { downloadUrl: string, size: number }
  app.post('/presentations/:namespace/:proposalId/publish', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as { ast?: Record<string, unknown>; format?: string } | undefined;

    // Load AST from body or fall back to saved file
    let ast = body?.ast;
    if (!ast) {
      const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
      try {
        const raw = await readFile(astPath, 'utf-8');
        ast = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return reply.code(404).send({ error: `No microsite AST found for ${namespace}/${proposalId}` });
      }
    }

    try {
      // Embed all images as base64 data URIs so the exported HTML is fully
      // self-contained — no external requests, no localhost dependencies.
      const astWithImages = await embedImagesAsBase64(ast, workdir, namespace);
      const html = renderMicrositeToHtml(astWithImages as Parameters<typeof renderMicrositeToHtml>[0]);
      const exportsDir = path.join(workdir, 'exports', namespace);
      await mkdir(exportsDir, { recursive: true });
      const fileName = `${proposalId}.html`;
      const filePath = path.join(exportsDir, fileName);
      await writeFile(filePath, html, 'utf-8');

      return reply.send({
        downloadUrl: `/exports/${namespace}/${fileName}`,
        size: Buffer.byteLength(html, 'utf-8'),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: `HTML export failed: ${message}` });
    }
  });

  // POST /presentations/:namespace/:proposalId/export-pptx
  // Export the microsite AST as a PowerPoint (.pptx) file download.
  // Body: { ast?: Record<string, unknown> }
  app.post('/presentations/:namespace/:proposalId/export-pptx', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as { ast?: Record<string, unknown> } | undefined;

    let ast = body?.ast;
    if (!ast) {
      const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
      try {
        const raw = await readFile(astPath, 'utf-8');
        ast = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return reply.code(404).send({ error: `No microsite AST found for ${namespace}/${proposalId}` });
      }
    }

    try {
      const buffer = await renderMicrositeToPptx(ast as unknown as Parameters<typeof renderMicrositeToPptx>[0]);
      const title = (ast.meta as { title?: string } | undefined)?.title ?? proposalId;
      const fileName = `${title.toLowerCase().replace(/\s+/g, '-')}.pptx`;

      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
      reply.header('Content-Length', buffer.length);
      return reply.send(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: `PPTX export failed: ${message}` });
    }
  });
}
