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
import { readOrgContextSettings, resolveDesignKitForContext, namespaceWorkdir } from '@ai-engine/runtime';
import { applyDesignSkill, injectThemeCSS, generateThemeCSSTokens, generateSectionHtml, CUSTOM_HTML_SECTION_TYPES, buildDesignPromptFromSkill, type CSSTheme, type Tone } from '../skills/design-skill-microsite.js';
import { getDesignSkill } from '../skills/design-skill.service.js';
import { buildDesignSystemPrompt, buildFontUrls } from '@ai-engine/agent-microsite-generator';
import { DesignEditorAgent } from '@ai-engine/agent-design-editor';
import { renderMicrositeToHtml } from './html-exporter.js';
import { renderMicrositeToPptx } from './pptx-exporter.js';
import {
  generateMicrositeDirectly,
  generateMicrositeStream as generateMicrositeStreamDirect,
} from './direct-microsite-generator.js';
import {
  generateStructuredMicrosite,
  assignSectionIds,
} from './structured-microsite-generator.js';
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
/** Extract the proposing agency/company from context.json data.
 *  Tries stakeholders (company != clientName), then knowledge source filenames (Otter.ai pattern).
 *  Falls back to markdown header patterns as last resort.
 */
function extractPreparedBy(
  ctx: Record<string, unknown> | null,
  markdown: string,
): string {
  // 1. Proposal markdown — explicit "Prepared by" / "From:" header
  const mdMatch = markdown.slice(0, 3000).match(
    /(?:Prepared\s+by|From|Submitted\s+by|Presented\s+by)\s*[:\-]\s*\**([^\n*|]{2,60})\**/i,
  );
  if (mdMatch?.[1]?.trim()) return mdMatch[1].trim();

  // 2. Knowledge source filenames — Otter.ai pattern: Speaker__Client__-_Agency_otter_ai
  if (ctx) {
    const knowledge = (ctx as Record<string, unknown[]>).knowledge ?? [];
    for (const k of knowledge) {
      const fileName = ((k as Record<string, Record<string, string>>).source?.fileName) ?? '';
      const m = fileName.match(/__-_(.+?)_otter_ai/i);
      if (m) return m[1].replace(/_/g, ' ');
    }
  }

  return '';
}

export function resolveProposalMdPath(workdir: string, fileName: string, contextNamespace?: string): string {
  const sep = fileName.indexOf('::');
  if (sep !== -1) {
    return path.join(workdir, 'namespaces', fileName.slice(0, sep), 'proposals', fileName.slice(sep + 2));
  }
  if (contextNamespace) {
    return path.join(workdir, 'namespaces', contextNamespace, 'proposals', fileName);
  }
  return path.join(workdir, 'output', fileName);
}

export function checkNamespaceAccess(
  auth: AuthContext,
  namespace: string,
  reply: FastifyReply,
): boolean {
  if (isWildcard(auth.allowedNamespaces)) return true;
  if (auth.allowedNamespaces.includes(namespace)) return true;
  reply.code(403).send({ error: `Access denied for namespace: ${namespace}` });
  return false;
}

export function getAuth(req: FastifyRequest): AuthContext {
  return (req as FastifyRequest & { auth: AuthContext }).auth;
}

/**
 * Download a remote image URL (DALL-E or Unsplash) to local disk so it
 * never expires. Returns the persistent local URL to store in the AST.
 * Falls back to the original remote URL if download fails.
 */
export async function saveImagePersistently(
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

// ---------------------------------------------------------------------------
// Preview-injection stripping
// The UI injects ephemeral CSS/JS into the srcdoc iframe for preview purposes.
// These must never be saved to disk or passed to the LLM — they could cause
// the model to absorb script code into section content fields, which then
// renders as visible text when the section is displayed.
// ---------------------------------------------------------------------------

const PREVIEW_INJECTION_IDS = [
  '__preview-cursor-reset',
  '__nav-anchor-fix',
  '__preview-reveal-fix',
  '__microsite-iframe-edit',
  '__scroll-restore',
];

function stripPreviewInjections(html: string): string {
  let out = html;
  for (const id of PREVIEW_INJECTION_IDS) {
    out = out.replace(
      new RegExp(`<(?:style|script)[^>]*\\bid="${id}"[\\s\\S]*?</(?:style|script)>\\s*`, 'g'),
      '',
    );
  }
  return out;
}

/** Strip preview injections from every customHtml field in an AST in-place. */
function stripAstInjections(ast: Record<string, unknown>): void {
  const sections = ast.sections as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(sections)) return;
  for (const sec of sections) {
    if (typeof sec.customHtml === 'string') {
      sec.customHtml = stripPreviewInjections(sec.customHtml);
    }
  }
}

// ---------------------------------------------------------------------------
// CSS token cache
// Keyed by a hash of (tone + primaryColor + industry + designPromptOverride).
// Only used on design-skill-aware paths where the tone is deterministic.
// Auto-selection paths (random industry-based tone) skip the cache intentionally.
// TTL: 24 h — design skills don't change frequently.
// ---------------------------------------------------------------------------


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

    // ── Step 2c: Deterministic business intelligence extraction ───────────
    // Extract what we can from HTML without an LLM call first.

    // Page title and meta description
    const pageTitle = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? '';
    const metaDescription =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,500})["'][^>]*>/i)?.[1]?.trim() ??
      html.match(/<meta[^>]+content=["']([^"']{1,500})["'][^>]+name=["']description["'][^>]*>/i)?.[1]?.trim() ?? '';
    const metaKeywords =
      html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']{1,300})["'][^>]*>/i)?.[1]?.trim() ??
      html.match(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+name=["']keywords["'][^>]*>/i)?.[1]?.trim() ?? '';
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,200})["'][^>]*>/i)?.[1]?.trim() ?? '';
    const ogDescription = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,500})["'][^>]*>/i)?.[1]?.trim() ?? '';
    const ogSiteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{1,100})["'][^>]*>/i)?.[1]?.trim() ?? '';
    const twitterSite = html.match(/<meta[^>]+name=["']twitter:site["'][^>]+content=["']([^"']{1,100})["'][^>]*>/i)?.[1]?.trim() ?? '';

    // Contact intel — deterministic regex extraction
    const emailMatches = [...new Set([...html.matchAll(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g)].map(m => m[0]).filter(e => !e.match(/\.(png|jpg|gif|svg|css|js)$/i)))].slice(0, 5);
    const phoneMatches = [...new Set([...html.matchAll(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g)].map(m => m[0].trim()))].slice(0, 5);
    const addressMatch = html.match(/<address[^>]*>([\s\S]{1,400}?)<\/address>/i)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';

    // Social links
    const socialPatterns: Record<string, RegExp> = {
      twitter: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,50})/,
      linkedin: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([a-zA-Z0-9_\-]{1,80})/,
      facebook: /https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9_.]{1,80})/,
      instagram: /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]{1,80})/,
      youtube: /https?:\/\/(?:www\.)?youtube\.com\/(?:channel\/|@)([a-zA-Z0-9_\-]{1,80})/,
    };
    const socialLinks: Record<string, string> = {};
    for (const [platform, pattern] of Object.entries(socialPatterns)) {
      const m = html.match(pattern);
      if (m) socialLinks[platform] = m[0];
    }

    // Tech stack signals from script srcs, meta generators
    const techHints: string[] = [];
    const generatorMeta = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']{1,100})["'][^>]*>/i)?.[1]?.trim();
    if (generatorMeta) techHints.push(generatorMeta);
    for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
      const src = m[1].toLowerCase();
      if (src.includes('wp-content') || src.includes('wordpress')) techHints.push('WordPress');
      else if (src.includes('shopify')) techHints.push('Shopify');
      else if (src.includes('squarespace')) techHints.push('Squarespace');
      else if (src.includes('wix')) techHints.push('Wix');
      else if (src.includes('webflow')) techHints.push('Webflow');
      else if (src.includes('gtag') || src.includes('google-analytics') || src.includes('analytics.js')) techHints.push('Google Analytics');
      else if (src.includes('hotjar')) techHints.push('Hotjar');
      else if (src.includes('intercom')) techHints.push('Intercom');
      else if (src.includes('hubspot')) techHints.push('HubSpot');
      else if (src.includes('segment')) techHints.push('Segment');
    }
    const uniqueTechHints = [...new Set(techHints)].slice(0, 10);

    // Canonical URL and hreflang (international signals)
    const canonicalUrl = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i)?.[1]?.trim() ?? '';
    const hreflangTags = [...html.matchAll(/<link[^>]+rel=["']alternate["'][^>]+hreflang=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]).filter(l => l !== 'x-default').slice(0, 8);

    // Schema.org structured data — extract business type, name, description
    let schemaOrgName = '';
    let schemaOrgDescription = '';
    let schemaOrgType = '';
    let schemaOrgPriceRange = '';
    for (const block of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const data = JSON.parse(block[1]) as Record<string, unknown>;
        const items = Array.isArray(data['@graph']) ? data['@graph'] as Record<string, unknown>[] : [data];
        for (const item of items) {
          if (!schemaOrgType && item['@type']) schemaOrgType = String(item['@type']);
          if (!schemaOrgName && item.name) schemaOrgName = String(item.name).slice(0, 100);
          if (!schemaOrgDescription && item.description) schemaOrgDescription = String(item.description).slice(0, 400);
          if (!schemaOrgPriceRange && item.priceRange) schemaOrgPriceRange = String(item.priceRange);
        }
      } catch { /* malformed JSON-LD */ }
    }

    // Extract visible text for LLM — strip tags, scripts, styles, limit size
    const visibleText = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 8_000);

    // Build business intel prompt context
    const biContext = [
      pageTitle && `PAGE TITLE: ${pageTitle}`,
      ogTitle && ogTitle !== pageTitle && `OG TITLE: ${ogTitle}`,
      ogSiteName && `SITE NAME: ${ogSiteName}`,
      metaDescription && `META DESCRIPTION: ${metaDescription}`,
      ogDescription && ogDescription !== metaDescription && `OG DESCRIPTION: ${ogDescription}`,
      metaKeywords && `META KEYWORDS: ${metaKeywords}`,
      schemaOrgType && `SCHEMA TYPE: ${schemaOrgType}`,
      schemaOrgName && `SCHEMA NAME: ${schemaOrgName}`,
      schemaOrgDescription && `SCHEMA DESCRIPTION: ${schemaOrgDescription}`,
      schemaOrgPriceRange && `PRICE RANGE: ${schemaOrgPriceRange}`,
      emailMatches.length && `EMAILS FOUND: ${emailMatches.join(', ')}`,
      phoneMatches.length && `PHONES FOUND: ${phoneMatches.join(', ')}`,
      addressMatch && `ADDRESS: ${addressMatch}`,
      Object.keys(socialLinks).length && `SOCIAL: ${Object.entries(socialLinks).map(([k, v]) => `${k}: ${v}`).join(', ')}`,
      uniqueTechHints.length && `TECH STACK: ${uniqueTechHints.join(', ')}`,
      canonicalUrl && `CANONICAL: ${canonicalUrl}`,
      hreflangTags.length && `LANGUAGES: ${hreflangTags.join(', ')}`,
      `\nPAGE TEXT (first 8000 chars):\n${visibleText}`,
    ].filter(Boolean).join('\n');

    const businessIntelPrompt = `You are a business analyst extracting structured intelligence from a website.
Analyze the provided page data and return a JSON object with exactly these 6 categories.
Respond ONLY with a valid JSON object — no preamble, no markdown backticks.

{
  "brandIdentity": {
    "brandName": "company or brand name",
    "tagline": "official tagline or slogan if present, else null",
    "missionStatement": "mission or vision statement if present, else null",
    "brandVoice": "professional | friendly | authoritative | playful | technical | inspirational",
    "brandPersonality": "2-5 word description of the brand personality"
  },
  "businessIdentity": {
    "industry": "primary industry (e.g. SaaS, E-commerce, Healthcare, Legal, Real Estate)",
    "businessType": "B2B | B2C | B2B2C | Marketplace | Non-profit | Government",
    "companyDescription": "1-2 sentence description of what the company does",
    "productsOrServices": ["list", "of", "key", "offerings"],
    "pricingModel": "subscription | one-time | freemium | enterprise | custom | not-mentioned"
  },
  "digitalAudit": {
    "seoTitle": "page title used",
    "metaDescription": "meta description if present, else null",
    "hasAnalytics": true,
    "hasChatWidget": true,
    "techStack": ["detected", "technologies"],
    "internationalPresence": true,
    "languages": ["en", "fr"]
  },
  "contactIntel": {
    "emails": ["list of emails found"],
    "phones": ["list of phones found"],
    "address": "physical address if found, else null",
    "socialProfiles": {"twitter": "url", "linkedin": "url"},
    "hasContactForm": true,
    "hasLiveChat": true
  },
  "contentAnalysis": {
    "primaryCTA": "main call-to-action text (e.g. Get Started, Book a Demo)",
    "secondaryCTAs": ["other", "cta", "texts"],
    "keyMessages": ["3-5 core value propositions or key messages"],
    "contentTone": "formal | conversational | technical | inspirational | persuasive",
    "hasTestimonials": true,
    "hasCaseStudies": true,
    "hasPricing": true,
    "hasVideo": true
  },
  "competitiveContext": {
    "uniqueSellingPoints": ["2-4 clear USPs"],
    "targetAudience": "description of who this is for",
    "positioning": "how the company positions itself in the market",
    "competitiveAdvantages": ["stated", "advantages"],
    "marketCategory": "the specific market category or niche"
  }
}

Rules:
- Use null for fields where information is genuinely not available — do NOT guess
- "productsOrServices" should list actual named products/services, not generic descriptions
- "keyMessages" should be extracted from headlines and hero copy, not invented
- "uniqueSellingPoints" should be based on what the site explicitly claims
- Keep all string values concise (under 200 chars each)

PAGE DATA:
${biContext}`;

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
      const [colorRaw, layoutRaw, biRaw] = await Promise.all([
        llmGenerateFn(extractionPrompt),
        llmGenerateFn(layoutExtractionPrompt),
        llmGenerateFn(businessIntelPrompt),
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

      // Parse business intelligence
      let businessIntel: Record<string, unknown> | null = null;
      try {
        const biJsonStart = biRaw.indexOf('{');
        const biJsonEnd = biRaw.lastIndexOf('}');
        if (biJsonStart !== -1 && biJsonEnd > biJsonStart) {
          businessIntel = JSON.parse(biRaw.slice(biJsonStart, biJsonEnd + 1)) as Record<string, unknown>;
        }
        // Overlay deterministic values that are more reliable than LLM extraction
        if (businessIntel) {
          const ci = businessIntel.contactIntel as Record<string, unknown> ?? {};
          if (emailMatches.length) ci.emails = emailMatches;
          if (phoneMatches.length) ci.phones = phoneMatches;
          if (addressMatch) ci.address = addressMatch;
          if (Object.keys(socialLinks).length) ci.socialProfiles = socialLinks;
          businessIntel.contactIntel = ci;

          const da = businessIntel.digitalAudit as Record<string, unknown> ?? {};
          da.techStack = uniqueTechHints.length ? uniqueTechHints : (da.techStack ?? []);
          da.seoTitle = pageTitle || da.seoTitle;
          da.metaDescription = metaDescription || da.metaDescription || null;
          da.hasAnalytics = uniqueTechHints.some(t => t.toLowerCase().includes('analytics') || t.toLowerCase().includes('segment') || t.toLowerCase().includes('hotjar'));
          da.hasChatWidget = uniqueTechHints.some(t => t.toLowerCase().includes('intercom') || t.toLowerCase().includes('hubspot'));
          if (hreflangTags.length) { da.internationalPresence = true; da.languages = hreflangTags; }
          businessIntel.digitalAudit = da;
        }
      } catch {
        console.warn('[extract-url-design] business intel JSON parse failed — continuing without it');
      }

      console.log(`[extract-url-design] success — vibe="${style.vibe}", primary=${colors.primary}, sections=${JSON.stringify((layout as Record<string, unknown> | null)?.sections ?? [])}${heroImageUrl ? `, og:image found` : ''}${logoUrl ? `, logo found` : ''}${businessIntel ? `, businessIntel extracted` : ''}`);
      return reply.code(200).send({
        tokens: parsed,
        heroImageUrl,
        logoUrl,
        images: bodyImages.slice(0, 20),
        layout,
        businessIntel,
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
      path.join(workdir, 'assets', 'presentations', namespace, 'site-ast-chat.json'),
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

  // GET /presentations/history — all saved microsite ASTs across every namespace + super-clients
  app.get('/presentations/history', async (req: FastifyRequest, reply: FastifyReply) => {
    const assetsDir = path.join(workdir, 'assets', 'presentations');
    const allEntries: { id: string; namespace: string; savedAt: string; ast: unknown; source: string; type: string; version: number; title?: string }[] = [];

    // Regular namespace history
    let namespaceDirs: string[] = [];
    try { namespaceDirs = await readdir(assetsDir); } catch { /* directory may not exist yet */ }

    await Promise.all(
      namespaceDirs.map(async (ns) => {
        const nsDir = path.join(assetsDir, ns);
        let files: string[] = [];
        try { files = await readdir(nsDir); } catch { return; }
        const micrositeFiles = files.filter(f => f.startsWith('microsite_') && f.endsWith('.json'));
        await Promise.all(
          micrositeFiles.map(async (filename) => {
            try {
              const raw = await readFile(path.join(nsDir, filename), 'utf-8');
              const entry = JSON.parse(raw) as { id: string; type: string; version: number; createdAt: string; data: unknown };
              allEntries.push({
                id: entry.id,
                namespace: ns,
                savedAt: entry.createdAt,
                ast: entry.data,
                source: 'primary',
                type: entry.type,
                version: entry.version,
              });
            } catch { /* skip malformed files */ }
          }),
        );
      }),
    );

    // Super-client microsites — read directly from each client's microsites dir
    const superClientsRoot = path.join(workdir, 'super-clients');
    let superClientDirs: string[] = [];
    try { superClientDirs = await readdir(superClientsRoot); } catch { /* no super-clients yet */ }

    await Promise.all(
      superClientDirs.map(async (clientName) => {
        const micrositesDir = path.join(superClientsRoot, clientName, 'microsites');
        let indexRaw: string;
        try { indexRaw = await readFile(path.join(superClientsRoot, clientName, 'microsites.json'), 'utf-8'); } catch { return; }
        const index = JSON.parse(indexRaw) as { id: string; title: string; proposalTitle: string; savedAt: string; version?: number }[];
        await Promise.all(
          index.map(async (meta, i) => {
            try {
              const astRaw = await readFile(path.join(micrositesDir, `${meta.id}.json`), 'utf-8');
              const ast = JSON.parse(astRaw) as Record<string, unknown>;
              const rawMode = typeof ast?.generationMode === 'string' ? ast.generationMode : null;
              const type = rawMode === 'classic' ? 'classic' : rawMode === 'v2' ? 'v2' : 'pro';
              allEntries.push({
                id: `sc:${clientName}:${meta.id}`,
                namespace: clientName,
                savedAt: meta.savedAt,
                ast,
                source: 'primary',
                type,
                version: meta.version ?? index.length - i,
                title: (() => {
                  const v = meta.version ?? index.length - i;
                  if (meta.proposalTitle) {
                    const ms = meta.proposalTitle.replace(/\bProposal\b/g, 'Microsite').replace(/\bproposal\b/g, 'microsite');
                    return `${ms} (v${v})`;
                  }
                  // strip old "ClientName — " prefix from legacy titles
                  const stripped = meta.title?.replace(/^.+?\s*—\s*/, '') ?? '';
                  return stripped || meta.title;
                })(),
              });
            } catch { /* skip missing AST files */ }
          }),
        );
      }),
    );

    if (allEntries.length === 0) return reply.send({ entries: [] });

    allEntries.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    return reply.send({ entries: allEntries });
  });

  // POST /presentations/history/save — append a new versioned entry (never overwrites)
  app.post('/presentations/history/save', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { namespace?: string; ast?: unknown } | undefined;
    if (!body?.namespace || !body?.ast) {
      return reply.code(400).send({ error: 'Missing required fields: namespace, ast' });
    }
    const { namespace, ast } = body;
    const astObj = ast as Record<string, unknown>;
    stripAstInjections(astObj);
    const rawMode = typeof astObj?.generationMode === 'string' ? astObj.generationMode : null;
    const type = rawMode === 'classic' ? 'classic' : 'pro';

    const nsDir = path.join(workdir, 'assets', 'presentations', namespace);
    await mkdir(nsDir, { recursive: true });

    let existingFiles: string[] = [];
    try { existingFiles = await readdir(nsDir); } catch { /* new namespace */ }
    const existingCount = existingFiles.filter(f => f.startsWith(`microsite_${type}_`) && f.endsWith('.json')).length;
    const version = existingCount + 1;

    const timestamp = Date.now();
    const id = `microsite:${type}:${timestamp}`;
    const filename = `microsite_${type}_${timestamp}.json`;

    const entry = { id, type, version, createdAt: new Date().toISOString(), data: ast };
    await writeFile(path.join(nsDir, filename), JSON.stringify(entry, null, 2), 'utf-8');
    return reply.send({ ok: true, id, version });
  });

  // DELETE /presentations/history/:namespace?entryId=microsite:pro:1716023445123
  // Deletes exactly one entry by its unique id. Never bulk-deletes.
  // Super-client entries use entryId format: sc:{clientName}:{scId}
  app.delete('/presentations/history/:namespace', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string };
    const { entryId } = req.query as { entryId?: string };

    if (!entryId) {
      return reply.code(400).send({ error: 'Missing required query param: entryId' });
    }

    if (entryId.startsWith('sc:')) {
      // Super-client entry — delete AST file and remove from microsites.json index
      const parts = entryId.split(':');
      // format: sc:{clientName}:{scId} — clientName may contain hyphens, scId is the remainder
      const clientName = parts[1];
      const scId = parts.slice(2).join(':');
      const clientDir = path.join(workdir, 'super-clients', clientName);
      await rm(path.join(clientDir, 'microsites', `${scId}.json`)).catch(() => {});
      try {
        const raw = await readFile(path.join(clientDir, 'microsites.json'), 'utf-8');
        const index = JSON.parse(raw) as { id: string }[];
        await writeFile(
          path.join(clientDir, 'microsites.json'),
          JSON.stringify(index.filter((m) => m.id !== scId), null, 2),
          'utf-8',
        );
      } catch { /* index missing — nothing to update */ }
      return reply.send({ ok: true });
    }

    // Regular namespace entry: microsite:pro:1716023445123 → microsite_pro_1716023445123.json
    const filename = entryId.replace(/:/g, '_') + '.json';
    const filePath = path.join(workdir, 'assets', 'presentations', namespace, filename);
    await rm(filePath).catch(() => {});
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
    let clientIndustry = 'general';
    try {
      const ctxSvc = new ContextService(workdir);
      const ctx = await ctxSvc.get(namespace);
      const fields = ctx?.requirements?.fields ?? {};
      const projectType = (fields.projectType?.value as string | undefined) ?? 'professional services';
      const clientName = (fields.clientName?.value as string | undefined) ?? 'the client';
      clientIndustry = (fields.clientIndustry?.value as string | undefined) ?? 'general';
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

    const _generationStart = Date.now();
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

        const _sectionTypes = ast.sections.map((s: AstSection) => s.sectionType);
        console.log(
          `[microsite-gen] Complete — namespace=${namespace}` +
          ` sections=${_sectionTypes.length} (${_sectionTypes.join(', ')})` +
          ` industry="${clientIndustry}"` +
          ` hasWhyUs=${_sectionTypes.includes('whyus')} hasTimeline=${_sectionTypes.includes('timeline')}` +
          ` hasPricing=${_sectionTypes.includes('pricing')} elapsed=${Date.now() - _generationStart}ms`,
        );
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

  // POST /presentations/:namespace/:proposalId/generate-stream (alias: generate-classic-stream)
  // Multi-pass AST pipeline — streams SSE events: plan | section | images | complete | error
  const _classicStreamHandler = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    // Hijack the reply so Fastify doesn't interfere with our raw SSE response
    reply.hijack();

    // SSE headers — must be set before any writes
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
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
      motionLevel?: 'none' | 'minimal' | 'standard' | 'cinematic' | 'immersive';
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
        reply.raw.end(); return;
      }
    }

    ensureRegistered(workdir);
    let runner;
    try { runner = await buildRunner(workdir); } catch (err) {
      send({ type: 'error', message: `Runner init failed: ${err instanceof Error ? err.message : String(err)}` });
      reply.raw.end(); return;
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

    // Build Brief-aware instructions — reads context.json for projectType/clientName/industry.
    // clientIndustry and clientName are hoisted so they can flow into design-skill and hero metadata.
    let streamBriefPrefix = '';
    let streamClientIndustry = 'general';
    let streamClientName = '—';
    let streamCtx: Record<string, unknown> | null = null;
    try {
      const ctxSvc = new ContextService(workdir);
      streamCtx = await ctxSvc.get(namespace) as unknown as Record<string, unknown> | null;
      const ctx = streamCtx;
      type SF = Record<string, { value?: unknown }>;
      const fields: SF = ((ctx as Record<string, unknown>)?.requirements as Record<string, SF> | undefined)?.fields ?? {};
      const projectType = (fields.projectType?.value as string | undefined) ?? 'professional services';
      streamClientName = (fields.clientName?.value as string | undefined) ?? '—';
      streamClientIndustry = (fields.clientIndustry?.value as string | undefined) ?? 'general';
      streamBriefPrefix = [
        buildBriefFramingRule(projectType, streamClientName, streamClientIndustry),
        '',
        buildSectionTypeGuidance(projectType),
        '',
        buildSectionOrderGuidance(projectType),
        '',
      ].join('\n');
    } catch { /* non-fatal */ }

    // Metadata for the hero section's bottom metadata strip.
    // preparedBy extracted from the proposal markdown (most reliable source for agency name).
    const heroProposalMeta = {
      clientName:  streamClientName,
      preparedBy:  extractPreparedBy(streamCtx ?? null, markdown) || (body?.brand?.companyName as string | undefined) || '—',
      date:        new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      version:     (() => {
        const m = (proposalId as string).match(/[_\-v]v?(\d+)$/i);
        return m ? `v${m[1]}` : 'v1';
      })(),
    };

    const streamEffectiveInstructions = body?.customInstructions
      ? `${streamBriefPrefix}${body.customInstructions}`
      : streamBriefPrefix || undefined;

    const _generationStart = Date.now();

    // Phase 2 — Design Kit gap-fill: load org design kit and merge with body
    // (body values always win — kit provides defaults only).
    const _orgSettings = await readOrgContextSettings(workdir).catch(() => null);
    const _designKit = _orgSettings?.applyDesignKit !== false
      ? await resolveDesignKitForContext(
          workdir,
          namespaceWorkdir(workdir, namespace),
          { clientName: streamClientName, clientIndustry: streamClientIndustry },
          llmGenerateFn,
        )
      : null;
    const _effectiveBrand: Record<string, unknown> = {
      ...(_designKit?.primaryColor ? { primaryColor: _designKit.primaryColor } : {}),
      ...(body?.brand ?? {}),
    };
    const _effectiveDesignBrief = body?.designBrief ?? _designKit?.designBrief ?? undefined;
    const _effectiveReferenceFile = body?.referenceFile ?? (
      _designKit?.heroBase64 ? {
        base64: _designKit.heroBase64,
        mediaType: _designKit.heroMediaType ?? 'image/jpeg',
        fileName: 'design-kit-hero',
        ...(_designKit.dominantColors.length >= 2 ? { dominantColors: _designKit.dominantColors } : {}),
      } : undefined
    );

    // Design skill — enrich metadata with frontend-design directives before agent runs.
    const { metadata: skillMetadata, tone: designTone } = applyDesignSkill(
      'microsite-generator-agent',
      {
        proposalMarkdown: markdown,
        plugin: body?.plugin ?? 'cobalt',
        brand: _effectiveBrand,
        clientIndustry: streamClientIndustry,
        ...(streamEffectiveInstructions ? { customInstructions: streamEffectiveInstructions } : {}),
        ...(_effectiveDesignBrief ? { designBrief: _effectiveDesignBrief } : {}),
      },
    );

    // Dedicated generate function for HTML section rendering — bypasses the global
    // LLM bridge pool so chat/proposals are unaffected. Uses Sonnet for richer layouts.
    const _htmlApiKey  = env.ANTHROPIC_API_KEY ?? '';
    const _htmlModel   = env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
    const htmlGenerateFn = async (prompt: string): Promise<string> => {
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': _htmlApiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: _htmlModel, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] }),
        });
        if (r.status === 429) {
          const retryAfter = parseInt(r.headers.get('retry-after') ?? '30', 10);
          await new Promise(res => setTimeout(res, retryAfter * 1000 * (attempt + 1)));
          continue;
        }
        if (!r.ok) throw new Error(`Anthropic HTML API error: ${r.status}`);
        const j = await r.json() as { content?: { text?: string }[] };
        return j.content?.[0]?.text ?? '';
      }
      throw new Error('Anthropic HTML API: max retries exceeded');
    };

    // Start CSS token generation in parallel with the agent for zero wait.
    const cssThemePromise: Promise<CSSTheme | null> = generateThemeCSSTokens(
          designTone as string,
          body?.brand?.primaryColor as string | undefined,
          llmGenerateFn,
          streamClientIndustry,
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
          ...(_effectiveDesignBrief ? { designBrief: _effectiveDesignBrief } : {}),
          ...(body?.preSynthesizedDesignSystem ? { preSynthesizedDesignSystem: body.preSynthesizedDesignSystem } : {}),
          ...(body?.pdfFriendly ? { pdfFriendly: true } : {}),
          ...(_effectiveReferenceFile ? { referenceFile: _effectiveReferenceFile } : {}),
          ...(body?.urlReferenceDesign ? { urlReferenceDesign: body.urlReferenceDesign } : {}),
          ...(body?.urlLayout ? { urlLayout: body.urlLayout } : {}),
          ...(body?.urlImages?.length ? { urlImages: body.urlImages } : {}),
          ...(body?.motionLevel ? { motionLevelOverride: body.motionLevel } : {}),
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
            const capturedSection = {
              ...section,
              content: { ...content },
              image: imageForClient,
              // Attach proposal metadata for the hero bottom strip — ignored by all other section types
              ...(sectionType === 'hero' ? { _meta: heroProposalMeta } : {}),
            };
            const capturedLayoutIdx = htmlLayoutIdx++;
            const capturedSectionType = sectionType ?? '';
            void (async () => {
              try {
                if (!CUSTOM_HTML_SECTION_TYPES.has(capturedSectionType)) return;
                const cssTheme = await cssThemePromise;
                if (!cssTheme) { console.log('[routes] hero HTML skipped — cssTheme is null'); return; }
                const html = await generateSectionHtml(
                  capturedSection as Record<string, unknown>,
                  designTone as unknown as Tone,
                  cssTheme.cssVars,
                  null,
                  htmlGenerateFn,
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

      // Attach _meta to the hero AST section so Phase 3 fallback (injectThemeCSS) can render
      // the metadata strip even if streaming HTML generation failed for the hero.
      if (ast?.sections) {
        const heroAstSec = ast.sections.find(s => (s as unknown as { sectionType?: string }).sectionType === 'hero');
        if (heroAstSec && !(heroAstSec as unknown as { customHtml?: string }).customHtml) {
          (heroAstSec as unknown as Record<string, unknown>)._meta = heroProposalMeta;
        }
      }

      // Design skill Phase 2+3 — inject LLM-generated CSS theme.
      const cachedTheme = await cssThemePromise;
      if (ast) {
        await injectThemeCSS(
          ast as unknown as Record<string, unknown>,
          designTone,
          (body?.brand?.primaryColor as string | undefined),
          llmGenerateFn,
          [],
          cachedTheme ?? undefined,
          streamClientIndustry,
        );
      }

      // complete event carries local image URLs — no further reconciliation needed
      send({ type: 'complete', ast });
      if (ast?.sections) {
        const _sectionTypes = (ast.sections as Array<{ sectionType: string }>).map(s => s.sectionType);
        console.log(
          `[microsite-gen] Complete — namespace=${namespace}` +
          ` sections=${_sectionTypes.length} (${_sectionTypes.join(', ')})` +
          ` tone="${designTone}" industry="${streamClientIndustry}"` +
          ` hasWhyUs=${_sectionTypes.includes('whyus')} hasTimeline=${_sectionTypes.includes('timeline')}` +
          ` hasPricing=${_sectionTypes.includes('pricing')} elapsed=${Date.now() - _generationStart}ms`,
        );
      }
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      reply.raw.end();
    }
  };
  app.post('/presentations/:namespace/:proposalId/generate-stream', _classicStreamHandler);

  // ── V2: Analyze proposal sections ─────────────────────────────────────────
  // Quick LLM call that parses the proposal and returns detected sections,
  // client name, project type, and key themes. Used by the V2 wizard Step 1.
  app.post('/presentations/:namespace/:proposalId/analyze-v2', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as { proposalMarkdown?: string } | undefined;
    let markdown = body?.proposalMarkdown ?? '';
    if (!markdown) {
      try {
        const pres = await getPresentation(workdir, namespace, proposalId);
        markdown = await readFile(resolveProposalMdPath(workdir, pres.fileName, namespace), 'utf-8');
      } catch {
        return reply.status(404).send({ error: 'Proposal not found' });
      }
    }

    const apiKey = env.ANTHROPIC_API_KEY ?? '';
    const model  = env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

    const prompt = `Analyze this proposal and return a JSON summary.

PROPOSAL:
${markdown.slice(0, 8000)}

Return ONLY valid JSON, no explanation:
{
  "clientName": "company or client name",
  "projectType": "type of engagement (e.g. Website Redesign, Mobile App, Consulting)",
  "sections": [
    { "id": "hero", "type": "hero", "heading": "short label", "summary": "one sentence what this covers" }
  ],
  "keyThemes": ["theme1", "theme2", "theme3"]
}

Section types: hero, overview, challenge, approach, deliverables, timeline, pricing, whyus, faq, nextsteps, team, testimonials, benefits, stats, comparison
Always include hero and nextsteps. Suggest 5-9 sections based on what's actually in the proposal.`;

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!r.ok) return reply.status(500).send({ error: 'LLM analysis failed' });
      const j = await r.json() as { content?: { text?: string }[] };
      const text = j.content?.[0]?.text ?? '';
      const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
      return reply.send(JSON.parse(json));
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Analysis failed' });
    }
  });

  // ── V2 experimental generation route ──────────────────────────────────────
  // Completely independent from the existing agent/plugin pipeline.
  // Accepts: proposalMarkdown, userPrompt (content instructions), designPrompt
  // (design text instructions), referenceImage (base64 screenshot for vision
  // design extraction). Streams plan → section* → complete SSE events.
  app.post('/presentations/:namespace/:proposalId/generate-v2-stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (data: Record<string, unknown>) => {
      try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
    };

    const body = req.body as {
      proposalMarkdown?: string;
      userPrompt?: string;       // content/section instructions from user
      designPrompt?: string;     // design text instructions from user
      referenceImage?: { base64: string; mediaType: string }; // screenshot for vision
      coldStart?: boolean;       // bypass proposal — generate content from scratch
      motionLevel?: 'none' | 'minimal' | 'standard' | 'cinematic' | 'immersive'; // explicit motion override
      contextImages?: Array<{   // client-pasted images — prepared by the /images/prepare skill
        url: string;
        analysis: {
          index: number;
          source: unknown;
          metadata: {
            description: string;
            objects: string[];
            dominantColors: string[];
            readableText: string;
            formatHint: string;
            tags: string[];
            sentiment: string;
            dimensions: { width: number; height: number } | null;
          };
        };
        placementHint?: string; // LLM-generated brief for where this image fits in the microsite
      }>;
      pdfPresentation?: boolean; // each section is a fixed-aspect slide for PDF download
      pdfOrientation?: 'landscape' | 'portrait'; // landscape = 16:9 (default), portrait = 9:16
    } | undefined;

    const isColdStart = body?.coldStart === true;
    let markdown = body?.proposalMarkdown ?? '';
    if (!isColdStart && !markdown) {
      try {
        const pres = await getPresentation(workdir, namespace, proposalId);
        markdown = await readFile(resolveProposalMdPath(workdir, pres.fileName, namespace), 'utf-8');
      } catch {
        send({ type: 'error', message: 'Could not load proposal markdown' });
        reply.raw.end();
        return;
      }
    }

    const apiKey = env.ANTHROPIC_API_KEY ?? '';
    const model  = env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

    const hasPexels = !!(env.PEXELS_API_KEY?.trim());

    const contextImgs = body?.contextImages ?? [];

    const imageInstructions = contextImgs.length > 0
      ? (() => {
          const lines: string[] = [
            'CLIENT-PROVIDED IMAGES — MANDATORY INCLUSION',
            `Every one of the ${contextImgs.length} image(s) listed below MUST appear somewhere in the final microsite. Do NOT use image:// URLs for these. Do NOT substitute them with stock photos.`,
            '',
            'IMAGE CONTEXT (from visual analysis):',
            ...contextImgs.flatMap((img, i) => {
              const m = img.analysis?.metadata ?? {};
              const dims = m.dimensions ? `${m.dimensions.width}×${m.dimensions.height}` : '';
              const imgLines = [
                `Image ${i + 1} — src="${img.url}"`,
                `  Description: ${m.description ?? ''}`,
                `  Objects: ${(m.objects ?? []).slice(0, 5).join(', ')}`,
                `  Tags: ${(m.tags ?? []).slice(0, 6).join(', ')}`,
                `  Mood: ${m.sentiment ?? ''}${dims ? ` | Dimensions: ${dims}` : ''}`,
              ];
              if ((img as { placementHint?: string }).placementHint) {
                imgLines.push(`  Placement brief: ${(img as { placementHint?: string }).placementHint}`);
              }
              imgLines.push('');
              return imgLines;
            }),
            'You have full creative freedom on how to use these images. Think like a creative director: place them as heroes, full-bleed backgrounds, parallax layers, inline section images, gallery grids, team/about photos — whatever amplifies the proposal narrative and design. Cross-reference the proposal document to place each image where it most powerfully serves the story.',
            'On mobile, all images must be responsive (max-width:100%; height:auto or object-fit:cover with a bounded height).',
            '',
            hasPexels
              ? 'For any additional decorative images beyond the above, use: <img src="image://descriptive+query" alt="...">'
              : 'For any additional decorative images beyond the above, use real Unsplash URLs from your training data.',
          ];
          return lines.join('\n');
        })()
      : hasPexels
        ? `For images, always follow the user's instructions first.
If the user says no images, use CSS gradients and SVGs only.
Otherwise use this exact format for every image:
  <img src="image://descriptive+search+query+subject+mood+setting" alt="brief description">
  background-image: url('image://descriptive+search+query+subject+mood+setting')
Write specific queries — subject, setting, mood, lighting, style. Never generic. These are replaced with real professional photography by the server.`
        : `For images, always follow the user's instructions first.
If the user says no images, use CSS gradients and SVGs only.
Otherwise use real Unsplash photo URLs from your training data:
  https://images.unsplash.com/photo-{id}?w=1920&q=80&fit=crop&auto=format
Pick photos genuinely relevant to the section content — subject, industry, mood, setting.
Always write descriptive alt attributes. Never use placeholder services.`;

    const ARTIFACT_SYSTEM = `You are a world-class frontend developer and creative director with deep expertise in modern CSS, animation, and interaction design. You have an exceptional eye for typography, spacing, color, and visual hierarchy. You build websites that feel premium, polished, and alive — the kind of work that wins design awards.

When asked to create a website or microsite:
- Use your full frontend skills: CSS custom properties, smooth scroll, parallax, scroll-driven animations, glassmorphism, gradients, blur effects, micro-interactions
- Choose fonts, colors, and layouts that feel intentional and high-end
- Write clean, semantic HTML5 with all CSS and JS embedded inline
- For scroll-driven text reveals, animate each word or character individually using GSAP ScrollTrigger or IntersectionObserver
- For sticky card stacking effects, use position:sticky with GSAP ScrollTrigger scale transforms
- CRITICAL: NEVER use React, Vue, Angular, JSX, or any component framework. NEVER write JSX syntax like <ComponentName /> or ReactDOM.createRoot(). Output only vanilla HTML, CSS, and browser-native JavaScript. If a design spec references React or Framer Motion, translate those patterns directly into HTML+CSS+JS equivalents.
- Output ONLY the complete HTML file starting with <!DOCTYPE html> — no explanations, no markdown, no commentary

FRAMEWORK TRANSLATION RULES — apply these when the prompt references any JS framework:
- React component → vanilla JS function using document.createElement / innerHTML
- Framer Motion initial/animate/transition → CSS @keyframes + IntersectionObserver, or GSAP if motion is needed
- Framer Motion whileHover → CSS :hover with transform / box-shadow
- Tailwind utility classes → equivalent inline styles or a <style> block with the same values
- <script type="text/babel"> → standard <script> tag with plain ES6 JS
- window.X = X component exports → not needed; keep all JS inline in one <script> block
- CDN links for React, ReactDOM, Babel standalone, or Framer Motion → omit them entirely; use GSAP from jsdelivr if animation is needed
- BlurText / word-by-word animation → JS that splits text into <span> words and stagger-fades them via IntersectionObserver or GSAP
- FadingVideo crossfade → vanilla JS using requestAnimationFrame to tween video.style.opacity, with ended + timeupdate listeners for manual looping

NAV INTEGRITY RULE — always enforce this:
- Every href="#anchor" in the navigation must have a matching id="anchor" on a real page section
- Scan every nav link you generate; if a nav item points to a section not explicitly defined in the prompt, generate a minimal but styled placeholder section for it — same visual language as the rest of the page, with a heading and 1–2 lines of relevant placeholder copy
- Never wire multiple nav items to the same section ID just because that section is the closest match
- After writing all sections, do a final mental check: for each nav href, confirm its target id exists in the HTML

MOBILE-FIRST REQUIREMENTS — these are non-negotiable and must be in every output:
- Always include <meta name="viewport" content="width=device-width, initial-scale=1"> in <head>
- Write base styles for 320px–768px first, then layer on desktop enhancements with min-width media queries
- Never use fixed pixel widths on layout containers — use %, max-width + width:100%, or clamp()
- Body text minimum 15px on mobile; headings at least 26px on small screens; use clamp() for fluid scaling (e.g. font-size: clamp(26px, 5vw, 56px))
- All tap targets (buttons, links, nav items) must be at least 44×44px with adequate padding
- Multi-column grids must collapse to a single column below 768px — never let columns overflow or shrink to unreadable widths
- Hero sections must be fully legible at 375px wide — no content cut off, no horizontal scroll
- Horizontal overflow is forbidden: add overflow-x:hidden to html,body and any fixed-width inner containers
- Navigation on mobile (<768px): use a hamburger toggle or vertical stacked list — never a horizontal nav row that overflows
- Section padding must scale: use clamp() or percentage-based values (e.g. padding: clamp(48px, 8vw, 120px) clamp(20px, 5vw, 80px))
- Images: always width:100%; height:auto, or object-fit:cover inside a container with explicit height
- Avoid hover-only states for essential interactions — every interactive element must also respond to touch/click

NAVBAR LOGO REQUIREMENTS — non-negotiable in every microsite:
- Every microsite must have a sticky or fixed navbar at the top
- The navbar must use display:flex;align-items:center so all children are vertically centered
- The navbar left side must contain exactly this logo element as the first child inside the navbar: <img id="__site-logo__" src="data:," alt="Company Logo" style="height:44px;width:auto;max-width:180px;object-fit:contain;display:block;flex-shrink:0;">
- Wrap the logo in a flex container that is the first child of the nav: <div style="display:flex;align-items:center;flex-shrink:0;"><img id="__site-logo__" src="data:," alt="Company Logo" style="height:44px;width:auto;max-width:180px;object-fit:contain;display:block;flex-shrink:0;"></div>
- The src must be exactly "data:," — it will be replaced with the real logo URL or an SVG initials badge by the system. Do not invent a src value and do not add an onerror attribute.
- The navbar height must be at least 60px so the logo has room to breathe vertically

ICON SYSTEM — always use modern icons:
- Choose whichever icon library or inline SVG approach best suits the theme and style you've chosen
- Icons must be current-trend: clean, geometric, purposeful — not dated clip-art or old-style glyph fonts
- Size icons at 20–24px; match colour to accent or muted text tone
- Icons must be contextually meaningful — reinforce the content they accompany, never just decorate

SMOOTH SCROLL — always:
- html { scroll-behavior: smooth; }
- All internal anchor links use href="#sectionId" with a matching id on the target section

MOTION BASELINE — when no explicit MOTION override is present:
- IntersectionObserver fade-up on every section (opacity 0→1, translateY 24px→0, 0.55s ease-out, 0.08s stagger between siblings)
- Hero: subtle parallax on background image or gradient (CSS transform driven by scroll listener, 0.25× speed ratio)
- Buttons: scale(1.04) + box-shadow lift on :hover, transition 0.18s ease
- Cards: translateY(-4px) + shadow deepen on :hover, transition 0.2s ease
- This is the floor — exceed it whenever the brand mood warrants it

LAYOUT INTEGRITY — outcome constraints only. Achieve these however best fits your design:
- Content must never be hidden under the fixed navbar — anchor scroll targets and first-section top spacing must account for navbar height
- Sections must not visually bleed into each other — absolutely-positioned decorative elements (blobs, shapes, gradients) must stay within their section's bounds
- The navbar must always sit above all other elements — no section card, parallax layer, or overlay may appear in front of it
- Flex and grid children that contain text must not overflow their container at any viewport width
- Scroll-reveal animations must not leave any content permanently invisible — include a fallback that ensures visibility if the animation observer never fires
- Parallax backgrounds must always fully cover their container at every scroll position — no gaps at top or bottom edges
- Multi-column layouts must collapse gracefully — no column may become unreadably narrow; wrap or stack before that happens
- Cards must size to their content — a fixed height that clips text at different screen sizes is a bug
- The mobile hamburger menu must open on tap and close when a link is selected
- No horizontal scrollbar at any viewport width

${imageInstructions}`;

    const resolveImagePlaceholders = async (html: string): Promise<string> => {
      const re = /image:\/\/([^'")\s]+)/g;
      const placeholders = new Map<string, string>();
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        const query = decodeURIComponent(m[1].replace(/\+/g, ' '));
        placeholders.set(m[0], query);
      }
      if (placeholders.size === 0) return html;

      const results = await Promise.all(
        [...placeholders.entries()].map(async ([placeholder, query]) => {
          const url =
            await fetchPexelsImageUrl(query) ??
            buildPicsumUrl(query);
          return [placeholder, url] as const;
        }),
      );

      let out = html;
      for (const [placeholder, url] of results) {
        out = out.split(placeholder).join(url);
      }
      return out;
    };

    // Streaming LLM call — consumes SSE chunks from Anthropic and returns the full text.
    // Streaming is used for all calls so output arrives faster (lower time-to-first-token).
    const callLLMStream = async (
      messages: { role: string; content: unknown }[],
      maxTokens = 16000,
      onChunk?: (chunk: string) => void,
    ): Promise<string> => {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, stream: true, system: ARTIFACT_SYSTEM, messages }),
      });
      if (!r.ok) {
        const errBody = await r.text().catch(() => '');
        throw new Error(`LLM error: ${r.status} — ${errBody.slice(0, 300)}`);
      }
      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const evt = JSON.parse(raw) as { type?: string; delta?: { type?: string; text?: string } };
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              const chunk = evt.delta.text ?? '';
              text += chunk;
              if (chunk && onChunk) onChunk(chunk);
            }
          } catch { /* skip malformed */ }
        }
      }
      return text;
    };

    // Injected when user provides no prompt — full creative brief derived from the proposal.
    const NO_INSTRUCTION_DIRECTIVE = `NO INSTRUCTION MODE — no constraints from the user. This is your creative brief.

Read the full proposal before writing a single line of HTML. Then make every design decision from scratch based on what you read — not from a template, not from a default.

THEME — derive it, don't default it
There is no prescribed color scheme. Read the proposal and ask: what does this project feel like? What would a world-class design director choose if they had full creative freedom and were trying to make this specific client feel that this vendor truly understood them?

The palette, typography, and visual tone should emerge from the content — the industry, the ambition in the language, the size of the numbers, the nature of the deliverables. A fintech risk platform and a children's education startup should look nothing alike. A government infrastructure bid and a boutique creative agency pitch should feel completely different.

Use color boldly. Not everything needs to be light-on-dark or dark-on-light. Consider unexpected combinations that feel native to the industry and emotionally resonant. Pick 2 Google Fonts (one display, one text) that match the character — load via @import in <style>. No two proposals should produce the same visual identity.

IMAGERY — make it contextual, not stock
Derive every image query from the proposal's actual content. What is the client's world? What do the locations, services, outcomes, and people in this proposal look like? A query should pass this test: would it work for any other proposal? If yes, it's too generic. Make it specific to this one.

MOTION — always include, calibrate to the mood you chose
- html { scroll-behavior: smooth; } always
- IntersectionObserver scroll reveals on every section (opacity + translateY, 0.55s ease-out)
- Hero: background parallax (0.25× speed) or a CSS gradient animation or subtle ambient motion
- Hover micro-interactions on every button and card (scale, glow, lift — whatever fits the theme)
- If the theme is bold and expressive: add GSAP + ScrollTrigger from jsdelivr CDN for staggered headline reveals, animated counters, pinned scroll effects
- If the theme is calm and minimal: keep motion restrained to subtle fades and smooth transitions only
- Motion should feel like a natural extension of the visual theme — not bolted on

ICONS — always modern, your choice of library or inline SVG
Use icons that reinforce meaning, not just decorate. Match icon style and weight to the theme you chose. Never use dated iconography — always current-trend, clean, and geometric.

SECTIONS — from the proposal, not from a template
Build sections around the proposal's actual content and narrative arc. Name them in natural language. Include every major topic. Sequence them to tell a story: the problem, the solution, the proof, the investment, the next step.

This microsite must look and feel like it was designed specifically for this client, this proposal, and this moment — not assembled from a pattern. Push the craft.`;

    // Injected when user gave instructions but didn't specify a visual theme.
    const THEME_FALLBACK_DIRECTIVE = `THEME INTELLIGENCE — read the proposal for visual direction unless already specified above:
If the instructions above do not explicitly specify a visual theme, colors, or design style — derive those from the proposal itself. Read the proposal's industry, tone, and ambition, then choose a palette, typography, and visual mood that feels native to this specific engagement. Do not default to a generic look. The user's content instructions take full priority; this applies only to any visual direction they left unspecified.`;

    try {
      send({ type: 'start', message: 'Generating…' });
      send({ type: 'progress', message: 'Analyzing proposal…' });

      // Detect Vimeo URL in user instructions and inject technical embed guidance
      const vimeoMatch = body?.userPrompt?.match(/https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/i);
      const vimeoNote = vimeoMatch
        ? `Technical note for the Vimeo background video (ID: ${vimeoMatch[1]}):
Use this embed URL: https://player.vimeo.com/video/${vimeoMatch[1]}?background=1&autoplay=1&loop=1&muted=1&controls=0
Implement as a full-bleed iframe background inside a position:relative container:
  iframe { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:177.78vh; min-width:100%; height:56.25vw; min-height:100%; border:none; pointer-events:none; }
The hero section must have position:relative; overflow:hidden. All overlay text sits above with position:relative; z-index:1.`
        : '';

      // Strip framework-specific CDN script tags and export patterns from the prompt so the LLM
      // isn't confused into attempting React/Babel output instead of vanilla HTML.
      const sanitizeFrameworkPrompt = (text: string): string => {
        let out = text;
        // Remove <script> tags loading React, ReactDOM, Babel, Framer Motion, Vue, Angular
        out = out.replace(/<script[^>]*(?:unpkg\.com\/react|unpkg\.com\/react-dom|unpkg\.com\/@babel|framer-motion|vue(?:\.global|\.esm)|angular)[^>]*><\/script>/gi, '');
        // Remove integrity/crossorigin CDN <script> tags for the above (self-closing or paired)
        out = out.replace(/<script[^>]*(?:react|babel\.min|framer-motion)[^>]*(?:\/>|>[\s\S]*?<\/script>)/gi, '');
        // Remove window.X = X export lines
        out = out.replace(/window\.\w+\s*=\s*\w+\s*;?/g, '');
        // Neutralise <script type="text/babel"> mentions in prose
        out = out.replace(/<script\s+type=["']text\/babel["']/gi, '<script');
        // Prepend translation note if any framework keyword was found in the original text
        if (/react|framer.?motion|babel|jsx|\.createRoot|window\.\w+\s*=/i.test(text)) {
          out = `NOTE: Translate all React/JSX/Framer Motion patterns to equivalent vanilla HTML, CSS, and JS — do NOT emit any React, Babel, or Framer Motion code.\n\n${out}`;
        }
        return out;
      };

      // Structure the message like the Claude app: instruction first, then the proposal as an attachment.
      const parts: string[] = [];
      const hasUserInstructions = !!(body?.userPrompt?.trim() || body?.designPrompt?.trim());
      if (body?.userPrompt?.trim()) parts.push(sanitizeFrameworkPrompt(body.userPrompt.trim()));
      if (body?.designPrompt?.trim()) parts.push(`DESIGN REFERENCE:\n${sanitizeFrameworkPrompt(body.designPrompt.trim())}`);
      // Inject intelligent default directive — full creative brief when no instructions, theme fallback when instructions lack visual direction
      if (!hasUserInstructions) {
        parts.push(NO_INSTRUCTION_DIRECTIVE);
      } else {
        parts.push(THEME_FALLBACK_DIRECTIVE);
      }
      if (vimeoNote) parts.push(vimeoNote);
      if (body?.referenceImage?.base64) parts.push('A reference design screenshot is attached.');
      // PDF presentation directive — overrides motion and enforces fixed-aspect slide layout
      if (body?.pdfPresentation) {
        const isPortrait = body?.pdfOrientation === 'portrait';
        if (isPortrait) {
          parts.push(`PDF PORTRAIT SLIDE MODE (9:16) — Build a mobile-portrait presentation at 720px wide × 1280px tall. Every slide must feel COMPLETE and DENSE — content spread across the full height with NO dead zones, NO empty sections, NO placeholder text.

═══ SLIDE WRAPPER (copy exactly for every section) ═══
<section data-section-id="slide-N" style="aspect-ratio:9/16;overflow:hidden;position:relative;display:flex;flex-direction:column;width:100%;box-sizing:border-box;padding:0">

The section has NO padding. Children depend on slide position:
- slide-1 ONLY: top nav bar (52px) → content area (flex:1). Content area height = 1280 − 52 = 1228px.
- Middle slides (slides 2 through N-1): content area ONLY (flex:1). Content area fills full 1280px.
- Last slide (slide-N) ONLY: content area (flex:1) → bottom bar (52px). Content area height = 1280 − 52 = 1228px.

═══ TOP NAV BAR (FIRST SLIDE ONLY — slide-1, NOT on any other slide) ═══
<div data-pdf-hide="true" style="height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 36px;flex-shrink:0;background:rgba(0,0,0,0.18);border-bottom:1px solid rgba(255,255,255,0.09);position:relative;z-index:2;">
  Left: logo img placeholder (slide-1 only)
  Right: slide counter "01 / N" — replace N with the total slide count (font-size:11px;text-transform:uppercase;letter-spacing:0.1em;opacity:0.5;)
</div>
On light background slides: use rgba(0,0,0,0.06) background and rgba(0,0,0,0.08) border instead.
IMPORTANT: the data-pdf-hide="true" attribute is required on this div — it hides the bar in PDF export so the slide content fills the full page cleanly.
DO NOT add this top nav bar to slides 2 through N.

═══ CONTENT AREA (the ONLY child on middle slides; first child on last slide) ═══
<div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:28px 36px;overflow:hidden;position:relative;z-index:1;">
  Place all slide content here. Use justify-content:space-between + a middle body div with flex:1 to fill the available height.
</div>

═══ BOTTOM BAR (LAST SLIDE ONLY — slide-N, NOT on any other slide) ═══
<div data-pdf-hide="true" style="height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 36px;flex-shrink:0;background:rgba(0,0,0,0.18);border-top:1px solid rgba(255,255,255,0.09);position:relative;z-index:2;">
  Left: company name or brand tagline (font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:accent)
  Right: CTA or contact (font-size:13px;font-weight:600;) e.g. "Get Started →" or website URL
</div>
On light background slides: use rgba(0,0,0,0.06) background and rgba(0,0,0,0.08) border instead.
IMPORTANT: the data-pdf-hide="true" attribute is required on this div — hidden in PDF export.
DO NOT add this bottom bar to any slide other than the last slide.

═══ LOGO — CRITICAL RULES ═══
- The logo placeholder ONLY appears ONCE in the ENTIRE HTML — in the TOP NAV BAR of slide-1 only
- The exact element: <img id="__site-logo__" src="data:," alt="Company Logo" style="height:30px;width:auto;max-width:120px;object-fit:contain;display:block;flex-shrink:0;">
- id must be EXACTLY "__site-logo__" — never "__site-logo-2__", "__site-logo-N__", or any variant
- Slides 2 through N: NO top nav bar — do not add any navigation bar to these slides
- NEVER repeat id="__site-logo__" or any __site-logo* variant beyond slide-1

═══ TYPOGRAPHY — always px, never vw/rem ═══
Display headline ............. 44–52px, line-height:1.1, font-weight:800 — must be bold and large
Section title ................ 30–36px, line-height:1.2, font-weight:700
Subheading / eyebrow ......... 16–18px, font-weight:600, letter-spacing:0.04em
Body paragraph ............... 16px, line-height:1.75 — must be readable, not tiny
List item / card body ........ 14–15px, line-height:1.65
Label / tag / caption ........ 12px, uppercase, letter-spacing:0.07em, font-weight:600
Stats / big numbers .......... 52–64px, font-weight:900, line-height:1.0

CRITICAL: These font sizes are minimums. Every slide MUST use them. Small text = rejected output.

═══ CONTENT DENSITY — non-negotiable ═══
Every slide content area (1228px on slide-1 and last slide; 1280px on middle slides) MUST contain at minimum:
- 1 headline (30px+)
- 2+ supporting content blocks (paragraphs, cards, list items, or stats)
- 1 bottom anchor (tagline, CTA, stat strip, or pull-quote)
Content must fill the visible area. If a zone feels empty, add more content. Aim for 70% content density.

═══ SLIDE LAYOUT PATTERNS ═══
HERO SLIDE (slide-1)
  Top zone (≈12% of 1228px ≈ 147px): eyebrow label (12px uppercase) + company tagline (18px)
  Middle zone (≈58% ≈ 712px): display headline (2–3 lines, 44–52px) + 2-line description (16px)
  Bottom zone (≈30% ≈ 369px): large CTA button + 3 social-proof stats in a row (big number 52px + label 13px)
  Background: full-bleed gradient or image (position:absolute;inset:0;z-index:0), content z-index:1

FEATURE SLIDE
  Top zone (≈15% ≈ 176px): eyebrow label (12px uppercase) + section title (32px)
  Middle zone (flex:1): 2×2 icon card grid (grid-template-columns:1fr 1fr; gap:16px)
    Each card: padding:20px; icon (40px SVG); bold title (16px); 2–3 line description (14px)
  Bottom zone (≈10% ≈ 118px): accent tagline or stat strip

STATS SLIDE
  Top zone (≈15%): eyebrow + section title (32px)
  Middle zone: 2×2 big-number grid — each cell: big number (56px, font-weight:900) + unit + 2-line label (14px)
  Bottom zone: context sentence (16px) + CTA or accent bar

TEXT / STORY SLIDE
  Top zone: eyebrow tag (12px) + section title (32px) + 1-line intro (16px)
  Middle zone (flex:1): 3–4 body paragraphs (16px, line-height:1.75, gap:20px) OR large pull-quote (22px italic, left border 4px accent)
  Bottom zone: highlighted callout box (background:accent at 15% opacity, padding:20px 24px, border-radius:12px, border-left:4px solid accent, 16px bold text)

IMAGE + TEXT SLIDE
  Top zone: full-width image (height:38%, object-fit:cover, border-radius:12px) with overlaid eyebrow tag
  Below image: title (30px, margin-top:24px) + 3 bullet points (icon + 15px text, gap:12px) + CTA link (16px bold, accent color)

LIST SLIDE
  Top zone (≈12%): eyebrow + section title (30px)
  Middle zone (flex:1): 5–7 items, each row = colored icon (32px) + bold label (15px) + description (14px, 2 lines), padding:14px 0, border-bottom:1px solid rgba(255,255,255,0.1)
  Bottom zone: summary statement (16px italic) or accent pill

═══ SPACING RULES ═══
- Content area padding: 28px top, 36px sides — do not reduce
- Gap between top/middle/bottom content zones: handled by justify-content:space-between on content area
- Gap within middle content: 24–32px
- Gap between list items / cards: 16–20px
- Never use <div style="height:Xpx"> empty spacers — use gap and flex instead
- Each card / row / item must have enough padding (16–20px) to feel substantial

═══ NARROW ROW LAYOUTS (allowed for small elements) ═══
- Icon + label within a card (flex-direction:row, ok)
- Big stat + unit on same line (flex-direction:row, ok)
- Button group side by side (flex-direction:row, ok)

═══ FORBIDDEN ═══
- 3-column or 4-column grids for main content
- 50/50 or 60/40 side-by-side full-text panels
- Empty containers taller than 40px
- fixed / sticky positioned children (use the flow-based top/bottom bars only)
- CSS animations, JS transitions, IntersectionObserver, scroll effects
- Any <img> with id containing "__site-logo" in slides 2–N
- Small font sizes below 14px for body content
- Sparse slides with only a headline and no supporting content
- Adding padding to the <section> itself — all padding belongs inside the content area div

═══ CONTRAST & READABILITY — non-negotiable ═══
Text MUST be clearly readable against its background at all times:
- Dark background slides: use white (#fff) or very near-white (rgba 255,255,255,≥0.92) for all text
- Never use rgba text color with opacity below 0.85
- Card/surface backgrounds: minimum 18% luminance difference from slide background — avoid near-identical tones
- Use rgba(255,255,255,0.10) to rgba(255,255,255,0.18) for card backgrounds on dark slides — never below 0.08
- Card border: always add 1px solid rgba(255,255,255,0.18) so cards are visible even on similar-colored backgrounds
- If a card has a colored tinted background (blue, green tint), ensure text is solid white, not muted
- Pull-quote or callout boxes: use border-left:4px solid accent + background:rgba(accent,0.15) + white text
- NEVER create a card where the text blends into the background — every word must be immediately legible`);
        } else {
          parts.push(`PDF LANDSCAPE SLIDE MODE (16:9) — Build a widescreen presentation at exactly 1280px wide × 720px tall. Each slide covers ONE idea with generous breathing room. Spread content across more slides rather than cramming onto fewer — aim for 8–12 slides total. A slide with 2–3 well-spaced cards beats a slide with 6 crowded ones.

═══ SLIDE WRAPPER (copy exactly for every section) ═══
<section data-section-id="slide-N" style="width:1280px;min-height:720px;overflow:hidden;position:relative;display:flex;flex-direction:column;justify-content:flex-start;box-sizing:border-box;padding:48px 72px 48px">

Use justify-content:flex-start so content anchors to the top and fills downward. Padding (48px top, 72px sides, 48px bottom) provides generous breathing room. White space is intentional — do not force extra content to fill a slide. NEVER put more than 6 items on one slide — if a section has 7+ items, split across two slides.

═══ MICROSITE NAV BAR (once in <body>, before all slides — browser only) ═══
Place ONE nav bar as the VERY FIRST child of <body>, before any <section>. This is a normal website navigation bar, not part of any slide:
<nav data-pdf-hide="true" style="position:fixed;top:0;left:0;right:0;height:64px;z-index:1000;display:flex;align-items:center;justify-content:space-between;padding:0 48px;box-sizing:border-box;background:rgba(MATCH_SITE_DARK_BG,0.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid rgba(255,255,255,0.08);">
  <img id="__site-logo__" src="data:," alt="Logo" style="height:28px;width:auto;max-width:120px;object-fit:contain;display:block;">
  <span style="font-size:13px;font-weight:600;letter-spacing:0.05em;color:rgba(255,255,255,0.5);">CLIENT × AGENCY · tagline or proposal title</span>
</nav>
- data-pdf-hide="true" is required — hides this bar automatically in PDF export
- Place ONCE as the very first child of <body> — never inside any <section>
- Use the site's primary dark background color for the nav background (matching the slide palette)
- REQUIRED: the <body> tag MUST have style="padding-top:64px" so slides start below the fixed nav bar. Without this the first slide is hidden behind the navbar. Example: <body style="padding-top:64px;margin:0">

═══ LOGO — CRITICAL RULES ═══
- The logo img with id="__site-logo__" belongs ONLY in the microsite nav bar above — NEVER inside any <section>
- id must be EXACTLY "__site-logo__" — never "__site-logo-2__" or any variant
- Inside slides: use text-only eyebrow labels or styled brand name — never an <img> for the logo
- NEVER place id="__site-logo__" or any __site-logo* variant inside any <section>

═══ TYPOGRAPHY — always px, never vw/clamp/rem ═══
Display headline ............. 36–44px, line-height:1.1, font-weight:800 — must dominate the slide
Section title ................ 28–34px, line-height:1.15, font-weight:700
Subheading / eyebrow ......... 13–15px, font-weight:600, letter-spacing:0.06em, text-transform:uppercase
Body paragraph ............... 15–16px, line-height:1.65 — must be readable, not tiny
List item / card body ........ 13–14px, line-height:1.6
Label / tag / caption ........ 11–12px, uppercase, letter-spacing:0.07em, font-weight:600
Stats / big numbers .......... 48–60px, font-weight:900, line-height:1.0

CRITICAL: These font sizes are MINIMUMS. Never use vw, clamp(), or em/rem for font-size, padding, or gap. Small text = rejected output.

═══ CONTENT DENSITY — fit everything within the slide ═══
LAYOUT CHOICE based on item count (decide BEFORE building):
- 2–4 items → CARD STYLE: full card with background, border, icon, padding — 2×2 or 1×3 grid
- 5–6 items → COMPACT LIST: icon-row layout (no card backgrounds) — rows evenly spaced with justify-content:space-between
- 7+ items → SPLIT across two slides: each slide gets 3–4 items using CARD STYLE
NEVER mix tall cards with compact rows in the same slide — pick one style for all items
Every slide MUST have 1 headline (28px+) near the top

═══ SLIDE LAYOUT PATTERNS ═══
HERO SLIDE (slide-1)
  Layout: 2-column side-by-side (display:grid;grid-template-columns:1.1fr 0.9fr;flex:1 — fills the 624px content area; do NOT set an explicit height)
  Left column (display:flex;flex-direction:column;justify-content:space-between):
    - Eyebrow label: client name + agency (12px uppercase, accent color, letter-spacing:0.08em)
    - Display headline (40–44px, 2–3 lines) + tagline (16px, 1–2 lines)
    - 3 social-proof stats in a row (big number 48px weight:900 + label 13px)
    - CTA button row or contact block at bottom
  Right column: full-bleed image (border-radius:14px;overflow:hidden) or rich graphic element with brand color and large bold text

PROBLEM / SOLUTION SLIDE (2-column)
  Header row: eyebrow (12px uppercase) + section title (30–32px) — height ~70px, margin-bottom:24px
  Content: display:grid;grid-template-columns:1fr 1fr;gap:32px;flex:1
    Left: "Challenge" column — 3 items max, display:flex;flex-direction:column;justify-content:space-between; each item: bold label (15px) + 2-line desc (13px), padding:18px 20px, border-left:3px solid accent
    Right: "Solution" column — 3 items max, display:flex;flex-direction:column;justify-content:space-between; each item: checkmark icon + bold label (15px) + 2-line desc (13px), padding:18px 20px, background:rgba(accent,0.08)
  Bottom: insight callout bar (padding:16px 22px;border-radius:10px;background:accent;font-size:14px) full-width

FEATURE GRID SLIDE (2–4 items — card style)
  Header: eyebrow + section title (30–32px) — ~70px, margin-bottom:20px
  Content: display:grid;grid-template-columns:repeat(2,1fr);gap:22px;flex:1 — max 4 cards (2×2)
    Each card: padding:22px 24px;border-radius:12px;overflow:hidden; icon (32–36px SVG); bold title (15px); 2–3 line description (13px)
    3 cards: use repeat(3,1fr) single row — taller cards, more impact
    ALL text inside cards must use word-wrap:break-word and never overflow the card boundary
  Do NOT use this pattern for 5+ items — use COMPACT LIST instead

COMPACT LIST SLIDE (5–6 items — row style, no card backgrounds)
  Header: eyebrow + section title (30–32px) — ~70px, margin-bottom:20px
  Content: display:flex;flex-direction:column;justify-content:space-between;flex:1
    Each row: display:flex;align-items:flex-start;gap:16px;padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.08)
      Icon: 32px SVG or colored circle with initial, flex-shrink:0
      Text block: bold label (14px, font-weight:700) on top + description (13px, 1–2 lines, color:rgba(255,255,255,0.7)) below
    Last row: no border-bottom
  For 2-column compact list: display:grid;grid-template-columns:1fr 1fr;gap:0 40px — keeps all items visible with breathing room
  Each row height ~64–76px — space-between distributes rows evenly across the full 624px content area

STATS / KPI SLIDE
  Header: eyebrow + section title (30–32px) — ~70px, margin-bottom:20px
  Content: display:grid;grid-template-columns:repeat(3,1fr);gap:28px;flex:1
    Each stat cell: big number (52–60px weight:900) + unit/label (14px uppercase) + 2–3 line context (13px) + optional mini progress bar
    3 stats is the default; use a 2×2 grid only if there are exactly 4 stats and each needs more description
  Bottom: summary insight bar (~40px)

PROCESS / STEPS SLIDE
  Header: eyebrow + section title (30–32px) — ~70px, margin-bottom:20px
  Content: display:flex;gap:20px;flex:1;align-items:stretch — 3–4 horizontal step cards side by side
    Each step card: padding:20px 16px;border-radius:12px; step number (32px accent); icon (28px SVG); bold title (14px); 2–3 line description (13px); connector arrow between cards (position:absolute, right:-14px)
    Step cards must stretch tall (min-height:420px) to fill the content area
  Bottom: outcome strip or investment summary (~50px)

QUOTE / PROOF SLIDE
  Full-height layout (display:flex;flex-direction:column;justify-content:center;gap:32px)
  Center: large pull-quote (28–32px, font-style:italic, line-height:1.4, max-width:860px, margin:0 auto, border-left:6px solid accent, padding-left:28px)
  Below quote: attribution row (name 16px bold + role 13px muted) + 2–3 supporting proof points (13px each)
  Background: rich gradient or full-bleed image with dark overlay (z-index:0), content z-index:1

═══ SPACING RULES ═══
- Slide padding: 48px top, 72px left/right, 48px bottom — equal top/bottom, DO NOT use vw or clamp
- Content area is defined by section padding — do NOT set explicit widths on content containers; use flex:1 or omit width entirely
- Grid columns MUST use fr units (1fr 1fr, not fixed px) so they fill the available padded width automatically
- NEVER set width:1280px or width:100vw on any element inside a section — that bypasses padding and causes overflow
- Header-to-content gap: 20–28px
- Card inner padding: 18–24px
- Grid gap between cards/columns: 16–28px
- NEVER use empty <div> spacers — use gap, flex:1, or min-height to fill space

═══ IMAGE RULES ═══
- Full-bleed slide background: position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0 with a gradient overlay on top
- Column image (in a 2-col layout): width:100%;height:100%;object-fit:cover;border-radius:12px — fills the full column height
- Inset showcase image: width:100%;object-fit:cover;border-radius:14px;max-height:320px
- NEVER use max-height:42% — it clips images to an arbitrary fraction

═══ FORBIDDEN ═══
- justify-content:center on sections — creates dead zones above and below content
- vw, clamp(), em, rem for font-size, padding, or gap — px only throughout
- aspect-ratio on sections — width and height are fixed at 1280×720
- Sticky/fixed positioned children
- CSS animations, transitions, IntersectionObserver, scroll effects
- Any <img> with id containing "__site-logo" in slides 2–N
- Slides that try to cover more than one topic — one idea per slide, always
- width:1280px or width:100vw on ANY element inside a section — always causes overflow past the padding boundary
- Fixed pixel widths on grid columns — use fr units only
- Unbalanced column layouts with dead space — use asymmetric fr splits (e.g. 1.2fr 0.8fr) to fill the full width
- Setting width:1280px on body — the constraint CSS handles body sizing
- Explicit height on inner content wrappers (any fixed pixel value) — always use flex:1 so section padding defines the available height
- repeat(4,1fr) or more than 3 columns in any content grid — maximum 3 columns

═══ CONTRAST & READABILITY — non-negotiable ═══
- Dark background slides: use white #fff or rgba(255,255,255,0.92+) for all body text
- Light background slides: use near-black (e.g. #111827 or #0d1f18) for body text — never mid-gray
- Never use rgba opacity below 0.85 for body text
- Card backgrounds on dark slides: rgba(255,255,255,0.08–0.16) with 1px solid rgba(255,255,255,0.15) border
- NEVER create a card where text blends into the background — every word must be immediately legible`);
        }
      }

      // Motion level hint — tells Claude what animation approach to use
      const effectiveMotionLevel = body?.pdfPresentation ? 'none' : body?.motionLevel;
      const motionHint = effectiveMotionLevel === 'none'
        ? 'MOTION: Generate a fully static site — no CSS animations, no JS animations, no transitions whatsoever.'
        : effectiveMotionLevel === 'minimal'
        ? 'MOTION: Use only subtle CSS fade-in transitions on page load. No scroll animations.'
        : effectiveMotionLevel === 'cinematic'
        ? 'MOTION: Add high-end scroll-driven animations via GSAP loaded from CDN. Include: parallax background layers, 3D card tilt on hover (CSS perspective + JS), staggered fade-up on scroll, animated number counters. Add GSAP + ScrollTrigger scripts in <head> from https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/'
        : effectiveMotionLevel === 'immersive'
        ? 'MOTION: Maximum cinematic motion. Load GSAP + ScrollTrigger from jsdelivr CDN. Include: deep parallax scrub on backgrounds, canvas particle system in hero section, split-text headline reveals (animate each word), 3D perspective card tilts, staggered section entrances, smooth magnetic cursor effect on CTAs. Use requestAnimationFrame for all continuous animations.'
        : null;
      if (motionHint) parts.push(motionHint);

      // Remind the LLM about client images (full spec is already in the system prompt via imageInstructions)
      if (contextImgs.length > 0) {
        parts.push(`Reminder: embed all ${contextImgs.length} client-provided image(s) listed in your system instructions using their exact src URLs.`);
      }

      if (markdown) parts.push(`<document>\n${markdown}\n</document>`);
      const prompt = parts.join('\n\n');

      // Log the full prompt to disk for auditing — fire-and-forget, never blocks generation
      {
        const logDir = path.join(workdir, 'namespaces', namespace, 'logs');
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(logDir, `microsite-prompt-${proposalId}-${ts}.txt`);
        const logContent = [
          `=== Microsite Generation Prompt Log ===`,
          `Timestamp : ${new Date().toISOString()}`,
          `Namespace : ${namespace}`,
          `ProposalId: ${proposalId}`,
          `Model     : ${model}`,
          ``,
          `--- SYSTEM PROMPT ---`,
          ARTIFACT_SYSTEM,
          ``,
          `--- USER PROMPT ---`,
          prompt,
        ].join('\n');
        mkdir(logDir, { recursive: true })
          .then(() => writeFile(logPath, logContent, 'utf-8'))
          .catch((e) => console.error('[microsite-gen] Failed to write prompt log:', e));
      }

      // Heartbeat: send progress messages every 6 s while the LLM is generating
      const heartbeatSteps = ['Designing layout…', 'Building hero section…', 'Writing content…', 'Applying styles…', 'Polishing design…'];
      let hbIdx = 0;
      const hbTimer = setInterval(() => {
        send({ type: 'progress', message: heartbeatSteps[hbIdx % heartbeatSteps.length] });
        hbIdx++;
      }, 6000);

      let raw: string;
      try {
        const messages = body?.referenceImage?.base64
          ? [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: body.referenceImage.mediaType || 'image/jpeg', data: body.referenceImage.base64 } },
              { type: 'text', text: prompt },
            ] }]
          : [{ role: 'user', content: prompt }];
        raw = await callLLMStream(messages, 32000, (chunk) => { send({ type: 'html_chunk', chunk }); });
      } finally {
        clearInterval(hbTimer);
      }

      send({ type: 'progress', message: 'Fetching images…' });

      // Strip markdown fences, resolve image:// placeholders with real photos, inject onerror fallback
      const rawHtml = raw
        .replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
        // Strip em dashes the LLM generates despite being told not to.
        // " — " (spaced) → ", "  |  bare "—" → "-"
        .replace(/ — /g, ', ').replace(/—/g, '-');

      const html = (await resolveImagePlaceholders(rawHtml))
        .replace(
          // Skip imgs that already have onerror AND skip __site-logo* (replaced client-side)
          /<img\b(?![^>]*\bonerror\b)(?![^>]*\bid="__site-logo)([^>]*\balt="([^"]*)"[^>]*)>/gi,
          (_m, attrs: string, alt: string) => {
            const keyword = (alt || 'abstract').trim().split(/\s+/).slice(0, 3).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
            return `<img${attrs} onerror="this.onerror=null;this.src='https://picsum.photos/seed/${keyword}/1920/1080'">`;
          },
        );

      // Inject hard CSS constraints for PDF presentation mode — fallback if LLM drifts.
      // Only constrains layout/overflow; does NOT change colors, fonts, or visual style.
      const isPortrait = body?.pdfPresentation && body?.pdfOrientation === 'portrait';
      const finalHtml = body?.pdfPresentation
        ? html.replace(
            /(<head[^>]*>)/i,
            isPortrait
              ? `$1<style id="__pdf-slide-constraints__">
[data-section-id]{aspect-ratio:9/16!important;overflow:hidden!important;position:relative!important;min-height:unset!important;height:auto!important;max-height:none!important;width:100%!important;max-width:720px!important;margin-left:auto!important;margin-right:auto!important;box-sizing:border-box!important;}
[data-section-id] img:not([id^="__site-logo"]){max-height:380px!important;}
[data-section-id] svg{max-height:120px!important;max-width:120px!important;}
</style>`
              : `$1<style id="__pdf-slide-constraints__">body{overflow-x:hidden!important;width:auto!important;margin:0!important;max-width:none!important;}[data-section-id]{width:1280px!important;height:720px!important;min-height:unset!important;max-height:720px!important;overflow:hidden!important;position:relative!important;box-sizing:border-box!important;flex-shrink:0!important;transform-origin:top left!important;padding:48px 72px 48px!important;}[data-section-id]>*:not([style*="position:absolute"]):not([style*="position: absolute"]){max-height:624px;overflow:hidden;min-height:0;}[data-section-id] img:not([id^="__site-logo"]){max-height:none!important;}[data-section-id] svg{max-height:140px!important;max-width:140px!important;}</style><script id="__slide-scaler__">(function(){function sc(){var vw=document.documentElement.clientWidth||window.innerWidth;if(!vw)return;var s=vw/1280;var la=s<1;if(la){document.body.style.display='block';document.body.style.flexDirection='';document.body.style.alignItems='';}else{document.body.style.display='flex';document.body.style.flexDirection='column';document.body.style.alignItems='center';}document.querySelectorAll('[data-section-id]').forEach(function(el){el.style.setProperty('transform-origin',la?'top left':'top center','important');if(Math.abs(s-1)<0.005){el.style.transform='';el.style.marginBottom='';}else{el.style.transform='scale('+s+')';el.style.marginBottom=Math.round(720*(s-1))+'px';}});}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',sc);}else{sc();}window.addEventListener('resize',sc);}());<\/script>`,
          )
        : html;

      send({ type: 'plan', totalSections: 1, sectionTypes: ['overview'] });

      send({
        type: 'section',
        id: 'microsite',
        heading: 'microsite',
        sectionType: 'overview',
        customHtml: finalHtml,
        content: { headline: 'microsite' },
        index: 0,
        image: { source: 'gradient', query: '', url: null, fallback: '' },
        editable: true,
        version: 1,
      });

      const ast = {
        generationMode: 'v2',
        ...(body?.pdfPresentation ? { pdfPresentation: true } : {}),
        ...(body?.pdfPresentation && body?.pdfOrientation ? { pdfOrientation: body.pdfOrientation } : {}),
        sections: [{
          id: 'microsite',
          heading: 'microsite',
          sectionType: 'overview',
          customHtml: finalHtml,
          content: { headline: 'microsite' },
          image: { source: 'gradient', query: '', url: null, fallback: '' },
          editable: true,
          version: 1,
        }],
        brand: {},
      };

      send({ type: 'complete', ast });
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      reply.raw.end();
    }
  });

  // ── Direct single-pass generation routes ──────────────────────────────────
  // These bypass the multi-step agent pipeline entirely. One LLM call reads
  // the full proposal and writes complete HTML directly — no AST, no themes.

  // POST /presentations/:namespace/:proposalId/generate-direct
  // Non-streaming direct generation. Returns { html, elapsed }.
  app.post('/presentations/:namespace/:proposalId/generate-direct', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as { proposalMarkdown?: string; brandConfig?: Record<string, unknown>; designSkillSlug?: string } | undefined;
    const apiKey = env.ANTHROPIC_API_KEY ?? '';
    const model = env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

    // Load proposal markdown — from body first, then disk
    let markdown = body?.proposalMarkdown ?? '';
    if (!markdown) {
      try {
        const pres = await getPresentation(workdir, namespace, proposalId);
        const mdPath = resolveProposalMdPath(workdir, pres.fileName, namespace);
        markdown = await readFile(mdPath, 'utf-8');
      } catch { /* fall through to direct fallback */ }
    }
    // Fallback: treat proposalId as the fileName directly (handles namespace::file format)
    if (!markdown) {
      try {
        const fallbackName = proposalId.endsWith('.md') ? proposalId : `${proposalId}.md`;
        const mdPath = resolveProposalMdPath(workdir, fallbackName, namespace);
        markdown = await readFile(mdPath, 'utf-8');
      } catch { /* fall through */ }
    }
    if (!markdown) return reply.code(400).send({ error: 'proposalMarkdown is required' });
    if (!apiKey) return reply.code(500).send({ error: 'ANTHROPIC_API_KEY is not configured' });

    // Read context.json for brand info
    let brandConfig: { companyName: string; primaryColor?: string; industry?: string; clientName?: string } = { companyName: '' };
    try {
      const ctxSvc = new ContextService(workdir);
      const ctx = await ctxSvc.get(namespace);
      const fields = ctx?.requirements?.fields ?? {};
      brandConfig = {
        companyName: (fields.clientName?.value as string | undefined) ?? '',
        clientName:  (fields.clientName?.value as string | undefined) ?? '',
        industry:    (fields.clientIndustry?.value as string | undefined) ?? '',
        primaryColor: undefined,
      };
    } catch { /* non-fatal */ }

    // Apply any brandConfig overrides from request body
    if (body?.brandConfig) Object.assign(brandConfig, body.brandConfig);

    // Resolve design skill → aesthetic override string for the HTML generator
    let designStyleOverride: string | undefined;
    if (body?.designSkillSlug) {
      try {
        const skill = await getDesignSkill(workdir, body.designSkillSlug);
        const built = buildDesignPromptFromSkill(skill);
        designStyleOverride = built.prompt;
        if (skill.colorPalette.primary && !brandConfig.primaryColor) {
          brandConfig = { ...brandConfig, primaryColor: skill.colorPalette.primary };
        }
      } catch { /* skill not found — fall through to auto-selection */ }
    }

    try {
      const { html, elapsed } = await generateMicrositeDirectly({ proposalMarkdown: markdown, brandConfig, designStyleOverride }, apiKey, model);
      const htmlPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-direct.html');
      await mkdir(path.dirname(htmlPath), { recursive: true });
      await writeFile(htmlPath, html, 'utf-8');
      console.log(`[direct-gen] Complete — namespace=${namespace} elapsed=${elapsed}ms size=${html.length}`);
      return reply.send({ html, elapsed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Direct generation failed: ${message}` });
    }
  });

  // POST /presentations/:namespace/:proposalId/generate-direct-stream
  // Streaming direct generation via SSE.
  // Events: { type: 'start' } | { type: 'html_chunk', chunk } | { type: 'complete', elapsed, size } | { type: 'error', message }
  app.post('/presentations/:namespace/:proposalId/generate-direct-stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as { proposalMarkdown?: string; brandConfig?: Record<string, unknown> } | undefined;
    const apiKey = env.ANTHROPIC_API_KEY ?? '';
    const model = env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

    // Setup SSE
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (data: Record<string, unknown>) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Load markdown — from body first, then disk
    let markdown = body?.proposalMarkdown ?? '';
    if (!markdown) {
      try {
        const pres = await getPresentation(workdir, namespace, proposalId);
        const mdPath = resolveProposalMdPath(workdir, pres.fileName, namespace);
        markdown = await readFile(mdPath, 'utf-8');
      } catch { /* fall through to direct fallback */ }
    }
    // Fallback: treat proposalId as the fileName directly (handles namespace::file format)
    if (!markdown) {
      try {
        const fallbackName = proposalId.endsWith('.md') ? proposalId : `${proposalId}.md`;
        const mdPath = resolveProposalMdPath(workdir, fallbackName, namespace);
        markdown = await readFile(mdPath, 'utf-8');
      } catch { /* fall through */ }
    }
    if (!markdown || !apiKey) {
      send({ type: 'error', message: !markdown ? 'proposalMarkdown is required' : 'ANTHROPIC_API_KEY is not configured' });
      reply.raw.end();
      return;
    }

    // Read context.json for brand info
    let brandConfig: { companyName: string; primaryColor?: string; industry?: string; clientName?: string } = { companyName: '' };
    try {
      const ctxSvc = new ContextService(workdir);
      const ctx = await ctxSvc.get(namespace);
      const fields = ctx?.requirements?.fields ?? {};
      brandConfig = {
        companyName: (fields.clientName?.value as string | undefined) ?? '',
        clientName:  (fields.clientName?.value as string | undefined) ?? '',
        industry:    (fields.clientIndustry?.value as string | undefined) ?? '',
        primaryColor: undefined,
      };
    } catch { /* non-fatal */ }
    if (body?.brandConfig) Object.assign(brandConfig, body.brandConfig);

    try {
      send({ type: 'start' });
      let accumulated = '';

      await generateMicrositeStreamDirect(
        { proposalMarkdown: markdown, brandConfig },
        (chunk) => {
          accumulated += chunk;
          send({ type: 'html_chunk', chunk });
        },
        async ({ elapsed }) => {
          const htmlPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-direct.html');
          await mkdir(path.dirname(htmlPath), { recursive: true });
          await writeFile(htmlPath, accumulated, 'utf-8');
          console.log(`[direct-gen] Stream complete — namespace=${namespace} elapsed=${elapsed}ms size=${accumulated.length}`);
          send({ type: 'complete', elapsed, size: accumulated.length });
          reply.raw.end();
        },
        apiKey,
        model,
      );
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      reply.raw.end();
    }
  });

  // GET /presentations/:namespace/:proposalId/site-html
  // Serve the directly-generated HTML file (text/html).
  app.get('/presentations/:namespace/:proposalId/site-html', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string; proposalId: string };

    const htmlPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-direct.html');
    try {
      const html = await readFile(htmlPath, 'utf-8');
      return reply.type('text/html').send(html);
    } catch {
      return reply.code(404).send({ error: 'No direct HTML generated yet for this namespace' });
    }
  });

  // ── Structured single-pass generation ────────────────────────────────────────
  // POST /presentations/:namespace/:proposalId/generate-structured-stream
  // One LLM call → complete AST (all sections with content fields, no customHtml).
  // Streams the same SSE event types as /generate-stream so PresentationPage works
  // without modification. Sections render via existing typed React components and
  // are fully editable in the editor.
  app.post('/presentations/:namespace/:proposalId/generate-structured-stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body    = req.body as { proposalMarkdown?: string; brand?: Record<string, unknown>; plugin?: string; customInstructions?: string; fullDesignPrompt?: string; urlReferenceDesign?: { colors: { primary: string; secondary: string; accent?: string; background: string; surface: string; text: string; textMuted: string }; typography: { headingFont: string; bodyFont: string; headingWeight: string; bodyWeight: string; headingStyle?: string; mood?: string }; style: { borderRadius: string; spacing: string; vibe: string }; heroImageUrl?: string | null } | null; urlLayout?: Record<string, unknown> | null } | undefined;
    const apiKey  = env.ANTHROPIC_API_KEY ?? '';
    const model   = env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
    const htmlModel = model; // Sonnet for HTML — richer, more varied layouts
    // Custom design prompt from the user — drives tone selection and design override.
    // fullDesignPrompt takes priority over customInstructions (same hierarchy as /generate-stream).
    const customDesignPrompt = (body?.fullDesignPrompt ?? body?.customInstructions ?? '').trim();

    // Detect "full site spec" prompts — user provided a complete HTML/site specification
    // (with section definitions, color tokens, font specs, etc.) instead of a proposal file.
    // These need different handling:
    //   1. The spec itself becomes the proposal input (content comes from the spec, not disk)
    //   2. designOverride is trimmed to style-relevant lines only (stops the LLM from trying
    //      to generate a complete HTML file for each individual section)
    const isFullSiteSpec = customDesignPrompt.length > 500 && (
      /html\s+file|single.page|all\s+css\s+inline|GLOBAL\s+RULES|inline\s+css/i.test(customDesignPrompt) ||
      /\d+\.\s+[A-Z]{3,}/.test(customDesignPrompt)  // numbered section definitions like "1. HERO"
    );

    // For a full spec: extract only the style-relevant portion (up to the SECTIONS block)
    // to use as designOverride — prevents per-section generators seeing "single HTML file" instruction.
    const styleTokensOnly = isFullSiteSpec
      ? (() => {
          const cutoff = customDesignPrompt.search(/SECTIONS?\s*[\(:]/i);
          const raw = cutoff > 0 ? customDesignPrompt.slice(0, cutoff) : customDesignPrompt.slice(0, 500);
          return raw.trim();
        })()
      : customDesignPrompt;

    // For a full spec: also try to extract the primary color so CSS generation matches the spec.
    const specPrimaryColor = isFullSiteSpec
      ? (customDesignPrompt.match(/[Pp]rimary[^#\n]*#([0-9a-fA-F]{3,6})/)?.[1]
          ? '#' + customDesignPrompt.match(/[Pp]rimary[^#\n]*#([0-9a-fA-F]{3,6})/)![1]
          : undefined)
      : undefined;

    // URL brand tokens — extracted from the client's website via the site-intel panel.
    // When present, these drive tone selection, CSS generation, and per-section HTML so the
    // microsite matches the client's real visual identity exactly.
    const urlRefDesign = body?.urlReferenceDesign ?? null;

    // Build a design directive from URL tokens to guide the CSS and HTML LLM calls.
    const urlDesignHint = urlRefDesign ? [
      'BRAND TOKEN OVERRIDE — use EXACTLY these values, do not invent alternatives:',
      `  Palette: bg=${urlRefDesign.colors.background}, surface=${urlRefDesign.colors.surface}, primary=${urlRefDesign.colors.primary}, secondary=${urlRefDesign.colors.secondary}, text=${urlRefDesign.colors.text}, muted=${urlRefDesign.colors.textMuted}`,
      `  Typography: headings="${urlRefDesign.typography.headingFont}" weight ${urlRefDesign.typography.headingWeight}, body="${urlRefDesign.typography.bodyFont}" weight ${urlRefDesign.typography.bodyWeight}`,
      `  Style: border-radius=${urlRefDesign.style.borderRadius}, spacing=${urlRefDesign.style.spacing}`,
      `  Visual identity: ${urlRefDesign.style.vibe}`,
    ].join('\n') : null;

    // Combine user custom prompt (higher priority) with URL brand tokens (additional context).
    const effectiveDesignOverride = [styleTokensOnly || null, urlDesignHint].filter(Boolean).join('\n\n') || undefined;

    // Setup SSE
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (data: Record<string, unknown>) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      // Load markdown — body first, then disk (with fallback)
      let markdown = body?.proposalMarkdown ?? '';
      if (!markdown) {
        try {
          const pres = await getPresentation(workdir, namespace, proposalId);
          markdown = await readFile(resolveProposalMdPath(workdir, pres.fileName, namespace), 'utf-8');
        } catch { /* fall through */ }
      }
      if (!markdown) {
        try {
          const fallbackName = proposalId.endsWith('.md') ? proposalId : `${proposalId}.md`;
          markdown = await readFile(resolveProposalMdPath(workdir, fallbackName, namespace), 'utf-8');
        } catch { /* fall through */ }
      }
      // Full site spec: use the spec itself as the proposal input so sections are
      // derived from the user's spec (not from a mismatched disk proposal).
      if (isFullSiteSpec && !markdown) markdown = customDesignPrompt;
      if (isFullSiteSpec && markdown) markdown = customDesignPrompt; // always override with spec

      if (!markdown) { send({ type: 'error', message: 'Could not load proposal markdown' }); reply.raw.end(); return; }
      if (!apiKey)   { send({ type: 'error', message: 'ANTHROPIC_API_KEY not configured' });  reply.raw.end(); return; }

      // Read brand/context from context.json
      let brandHint: { companyName?: string; industry?: string; clientName?: string; primaryColor?: string } = {};
      let structuredCtx: Record<string, unknown> | null = null;
      try {
        const ctxSvc = new ContextService(workdir);
        structuredCtx = await ctxSvc.get(namespace) as unknown as Record<string, unknown> | null;
        const fields  = ((structuredCtx as Record<string, unknown>)?.requirements as Record<string, Record<string, { value?: unknown }>> | undefined)?.fields ?? {};
        brandHint = {
          companyName:  (fields.clientName?.value as string | undefined) ?? '',
          clientName:   (fields.clientName?.value as string | undefined) ?? '',
          industry:     (fields.clientIndustry?.value as string | undefined) ?? '',
          // Priority: spec-extracted > URL brand token > manual brand input
          primaryColor: specPrimaryColor ?? urlRefDesign?.colors.primary ?? (body?.brand?.primaryColor as string | undefined),
        };
      } catch { /* non-fatal */ }

      send({ type: 'start', message: 'Structured generation started' });
      const _t0 = Date.now();

      const clientIndustry = brandHint.industry ?? '';

      // Tone selection:
      // - Custom prompt present → detect from custom prompt keywords
      // - URL tokens present (no custom prompt) → detect from vibe/mood string
      // - Neither → industry-aware default (existing behaviour)
      const toneSignal = customDesignPrompt || [urlRefDesign?.style.vibe, urlRefDesign?.typography.mood].filter(Boolean).join(' ');
      const detectedTone = toneSignal ? (() => {
        const lower = toneSignal.toLowerCase();
        const map: Array<[string[], string]> = [
          [['retro', 'futuristic', 'synthwave', 'cyberpunk', 'neon', 'sci-fi', 'crt', 'arcade', 'vaporwave', 'holograph'], 'retro-futuristic'],
          [['brutalist', 'raw', 'concrete', 'brutal'], 'brutalist/raw'],
          [['minimal', 'stark', 'clean', 'stripped'], 'brutally minimal'],
          [['maximalist', 'chaos', 'excess', 'energetic', 'bold', 'adventurous', 'exciting', 'vibrant', 'dynamic', 'lively', 'electric', 'high-energy', 'sporty', 'athletic'], 'maximalist chaos'],
          [['luxury', 'premium', 'elegant', 'refined', 'sophisticated', 'exclusive', 'upscale'], 'luxury/refined'],
          [['playful', 'toy', 'whimsical', 'cartoon', 'fun', 'friendly', 'approachable'], 'playful/toy-like'],
          [['editorial', 'magazine', 'journalistic', 'print'], 'editorial/magazine'],
          [['art deco', 'geometric', 'bauhaus', 'angular', 'structured'], 'art deco/geometric'],
          [['soft', 'pastel', 'gentle', 'delicate', 'airy', 'calm', 'peaceful'], 'soft/pastel'],
          [['industrial', 'utilitarian', 'mechanical', 'factory', 'technical'], 'industrial/utilitarian'],
          [['organic', 'natural', 'earthy', 'botanical', 'sustainable', 'eco'], 'organic/natural'],
        ];
        for (const [kws, tone] of map) {
          if (kws.some(k => lower.includes(k))) return tone;
        }
        // Custom prompt present but no keyword matched — use 'brutally minimal' as neutral fallback.
        // It doesn't enforce dark or light, so the designOverride directive drives the aesthetic.
        return 'brutally minimal';
      })() : null;

      const { tone: industryTone } = applyDesignSkill('microsite-generator-agent', {
        proposalMarkdown: markdown,
        // Suppress industry override when user supplies a custom prompt or URL tokens
        // so their aesthetic intent is not overridden by the industry heuristic.
        clientIndustry: (customDesignPrompt || urlRefDesign) ? '' : clientIndustry,
      });
      const structuredTone = detectedTone ?? industryTone;

      // Phase 1 cache disabled — always run full Sonnet call for fresh content

      // Phase 1 + CSS in parallel:
      //   - Single LLM call → complete AST structure
      //   - CSS token generation (custom prompt or industry-aware tone selection)
      const [ast, cssTheme] = await Promise.all([
        generateStructuredMicrosite(markdown, brandHint, proposalId, apiKey, model),
        generateThemeCSSTokens(
          structuredTone as string,
          brandHint.primaryColor,
          llmGenerateFn,
          (customDesignPrompt || urlRefDesign) ? undefined : clientIndustry,  // skip industry when design is driven by prompt or URL tokens
          effectiveDesignOverride,                          // combined custom prompt + URL brand tokens
        ).catch(() => null),
      ]);

      const sections = assignSectionIds(ast.sections);
      ast.sections   = sections;

      // Inject CSS theme into brand
      if (cssTheme) {
        // Patch exact URL brand token values on top of LLM-generated CSS — ensures the
        // microsite uses the client's real colors and fonts, not LLM approximations.
        if (urlRefDesign) {
          const vars = cssTheme.cssVars as Record<string, string>;
          const u = urlRefDesign;
          if (u.colors.background) vars['--ms-bg']          = u.colors.background;
          if (u.colors.surface)    vars['--ms-surface']     = u.colors.surface;
          if (u.colors.primary)    vars['--ms-accent']      = u.colors.primary;
          if (u.colors.secondary)  vars['--ms-accent2']     = u.colors.secondary;
          if (u.colors.text)       vars['--ms-text']        = u.colors.text;
          if (u.colors.textMuted)  vars['--ms-text3']       = u.colors.textMuted;
          if (u.typography.headingFont) vars['--ms-font-heading'] = `"${u.typography.headingFont}", sans-serif`;
          if (u.typography.bodyFont)    vars['--ms-font-body']    = `"${u.typography.bodyFont}", sans-serif`;
          // Recompute dark/light based on actual background luminance
          const bgHex = u.colors.background.replace('#', '');
          if (bgHex.length === 6) {
            const r = parseInt(bgHex.slice(0, 2), 16);
            const g = parseInt(bgHex.slice(2, 4), 16);
            const b = parseInt(bgHex.slice(4, 6), 16);
            vars['--ms-is-dark'] = (r * 0.299 + g * 0.587 + b * 0.114) < 128 ? '1' : '0';
          }
        }
        ast.brand = {
          ...ast.brand,
          extractedCssVariables: cssTheme.cssVars,
          overrideTheme: true,
          ...(cssTheme.googleFontsUrl ? { googleFontsUrl: cssTheme.googleFontsUrl } : {}),
          ...(cssTheme.fontFaceDeclarations ? { fontFaceDeclarations: cssTheme.fontFaceDeclarations } : {}),
        } as typeof ast.brand;
      }

      // Stream plan + section events so PresentationPage shows progress
      send({ type: 'plan', totalSections: sections.length, sectionTypes: sections.map(s => s.sectionType) });
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        send({ type: 'section', id: s.id, sectionType: s.sectionType, heading: s.heading, content: s.content, image: s.image, index: i });
      }

      // Attach proposal metadata to the hero section so generateSectionHtml can inject the strip.
      const structuredHeroMeta = {
        clientName:  brandHint.clientName || '—',
        preparedBy:  extractPreparedBy(structuredCtx, markdown) || (body?.brand?.companyName as string | undefined) || '—',
        date:        new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        version:     (() => { const m = (proposalId as string).match(/[_\-v]v?(\d+)$/i); return m ? `v${m[1]}` : 'v1'; })(),
      };
      const heroSec = sections.find(s => s.sectionType === 'hero');
      if (heroSec) (heroSec as unknown as Record<string, unknown>)._meta = structuredHeroMeta;

      // Phase 2: Generate customHtml for all sections using a dedicated 5-concurrent
      // function isolated from the global LLM bridge pool (which stays at size=2 for
      // chat, proposals, and agents). Includes 429 retry so it's production-safe.
      send({ type: 'progress', message: 'Generating section HTML in parallel…' });
      if (cssTheme) {
        // Haiku handles per-section HTML — mechanical template-filling task that
        // doesn't need Sonnet reasoning. ~5× faster, ~10× cheaper per call.
        // Isolated from the global LLM_BRIDGE_POOL so chat/proposals are unaffected.
        const micrositeGenerateFn = async (prompt: string): Promise<string> => {
          console.log(`[microsite-gen] Phase 3 HTML prompt (${prompt.length}c):\n${prompt.slice(0, 800)}...\n`);
          const MAX_RETRIES = 3;
          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            const r = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: htmlModel,
                max_tokens: 16000,
                messages: [{ role: 'user', content: prompt }],
              }),
            });

            if (r.status === 429) {
              const retryAfter = parseInt(r.headers.get('retry-after') ?? '30', 10);
              const delay = retryAfter * 1000 * (attempt + 1);
              console.warn(`[structured-gen] 429 rate limit — retrying in ${delay}ms (attempt ${attempt + 1})`);
              await new Promise(res => setTimeout(res, delay));
              continue;
            }

            if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
            const d = await r.json() as { content: Array<{ type: string; text: string }> };
            const result = d.content.filter(b => b.type === 'text').map(b => b.text).join('');
            console.log(`[microsite-gen] Phase 3 HTML response (${result.length}c):\n${result.slice(0, 300)}...\n`);
            return result;
          }
          throw new Error('Microsite HTML generation: max retries exceeded');
        };

        const CONCURRENCY = 8; // Haiku handles higher concurrency cheaply
        const targets = sections.filter(s => CUSTOM_HTML_SECTION_TYPES.has(s.sectionType));
        let cursor = 0;

        async function htmlWorker() {
          while (cursor < targets.length) {
            const section = targets[cursor++];
            const idx     = sections.indexOf(section);
            try {
              const html = await generateSectionHtml(
                section as unknown as Record<string, unknown>,
                structuredTone as import('../skills/design-skill-microsite.js').Tone,
                cssTheme!.cssVars,
                null,
                micrositeGenerateFn,
                idx,
                effectiveDesignOverride,        // combined custom prompt + URL brand tokens
              );
              section.customHtml = html;
              send({ type: 'section_html', id: section.id, customHtml: html });
              console.log(`[structured-gen] HTML done: ${section.sectionType} (${idx + 1}/${sections.length})`);
            } catch (err) {
              console.warn(`[structured-gen] HTML failed: ${section.sectionType}:`, err instanceof Error ? err.message : err);
            }
          }
        }

        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => htmlWorker()),
        );
      }

      const elapsed = Date.now() - _t0;
      console.log(`[structured-gen] Complete — namespace=${namespace} sections=${sections.length} tone="${structuredTone}" elapsed=${elapsed}ms`);

      send({ type: 'complete', ast });
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      reply.raw.end();
    }
  });

  // GET /presentations/:namespace/:proposalId/microsite
  // Returns the previously generated site AST (null if not yet generated).
  // ?entryId=microsite:pro:1716023445123 — loads that exact entry.
  // ?mode=pro|classic — fallback: loads the most recent entry of that type.
  app.get('/presentations/:namespace/:proposalId/microsite', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const { mode, entryId } = req.query as { mode?: string; entryId?: string };

    const base = path.join(workdir, 'assets', 'presentations', namespace);

    // Exact entry requested — load only that file
    if (entryId) {
      const filename = entryId.replace(/:/g, '_') + '.json';
      try {
        const raw = await readFile(path.join(base, filename), 'utf-8');
        const entry = JSON.parse(raw) as { createdAt: string; data: unknown };
        return reply.send({ ast: entry.data, savedAt: entry.createdAt });
      } catch {
        return reply.send({ ast: null, savedAt: null });
      }
    }

    // Super-client lookup — microsite stored under super-clients/{namespace}/microsites/{proposalId}.json
    const superClientPath = path.join(workdir, 'super-clients', namespace, 'microsites', `${proposalId}.json`);
    try {
      const raw = await readFile(superClientPath, 'utf-8');
      const ast = JSON.parse(raw);
      return reply.send({ ast, savedAt: null });
    } catch { /* not a super-client microsite — fall through to standard presentations */ }

    // Fallback: most recent versioned file for the given mode
    const type = mode === 'classic' ? 'classic' : 'pro';
    let files: string[] = [];
    try { files = await readdir(base); } catch { return reply.send({ ast: null, savedAt: null }); }

    const match = files
      .filter(f => f.startsWith(`microsite_${type}_`) && f.endsWith('.json'))
      .sort()
      .at(-1); // highest timestamp = most recent

    if (!match) return reply.send({ ast: null, savedAt: null });

    try {
      const raw = await readFile(path.join(base, match), 'utf-8');
      const entry = JSON.parse(raw) as { createdAt: string; data: unknown };
      return reply.send({ ast: entry.data, savedAt: entry.createdAt });
    } catch {
      return reply.send({ ast: null, savedAt: null });
    }
  });

  // PUT /presentations/:namespace/:proposalId/microsite
  // In-place edit of an existing versioned entry — updates only the data field, never creates a new entry.
  // ?entryId=microsite:pro:1716023445123 — targets that exact file (required for correct per-entry edits).
  // Without entryId, falls back to updating the most recent file of the matching type.
  app.put('/presentations/:namespace/:proposalId/microsite', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string; proposalId: string };
    const { entryId } = req.query as { entryId?: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as { ast?: Record<string, unknown> } | undefined;
    if (!body?.ast) return reply.code(400).send({ error: 'ast is required' });

    // Strip preview injections before persisting — the UI injects ephemeral
    // scripts into the srcdoc iframe for display; they must never reach disk.
    stripAstInjections(body.ast);

    const base = path.join(workdir, 'assets', 'presentations', namespace);
    await mkdir(base, { recursive: true });

    if (entryId) {
      // Update the specific entry in place
      const filename = entryId.replace(/:/g, '_') + '.json';
      const filePath = path.join(base, filename);
      try {
        const raw = await readFile(filePath, 'utf-8');
        const existing = JSON.parse(raw) as { id: string; type: string; version: number; createdAt: string; data: unknown };
        existing.data = body.ast;
        await writeFile(filePath, JSON.stringify(existing, null, 2), 'utf-8');
      } catch {
        // File missing — write it fresh so the editor never loses work
        await writeFile(filePath, JSON.stringify({ id: entryId, type: 'pro', version: 1, createdAt: new Date().toISOString(), data: body.ast }, null, 2), 'utf-8');
      }
      return reply.send({ ok: true });
    }

    // No entryId — update the most recent file of the matching type
    const rawMode = typeof body.ast.generationMode === 'string' ? body.ast.generationMode : null;
    const type = rawMode === 'classic' ? 'classic' : 'pro';
    let files: string[] = [];
    try { files = await readdir(base); } catch { files = []; }
    const match = files.filter(f => f.startsWith(`microsite_${type}_`) && f.endsWith('.json')).sort().at(-1);

    if (match) {
      const filePath = path.join(base, match);
      const raw = await readFile(filePath, 'utf-8');
      const existing = JSON.parse(raw) as { id: string; type: string; version: number; createdAt: string; data: unknown };
      existing.data = body.ast;
      await writeFile(filePath, JSON.stringify(existing, null, 2), 'utf-8');
    } else {
      const timestamp = Date.now();
      const id = `microsite:${type}:${timestamp}`;
      await writeFile(path.join(base, `microsite_${type}_${timestamp}.json`), JSON.stringify({ id, type, version: 1, createdAt: new Date().toISOString(), data: body.ast }, null, 2), 'utf-8');
    }
    return reply.send({ ok: true });
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

  // POST /presentations/:namespace/images/upload
  // Accepts up to 11 base64-encoded images, saves them to the presentation images
  // directory, and returns their persistent root-relative URLs.
  // Body: { images: Array<{ base64: string; mediaType: string }> }
  // Returns: { urls: string[] }
  app.post('/presentations/:namespace/images/upload', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as { images?: Array<{ base64: string; mediaType: string }> } | undefined;
    const images = body?.images;

    if (!Array.isArray(images) || images.length === 0) {
      return reply.code(400).send({ error: 'images must be a non-empty array' });
    }
    if (images.length > 11) {
      return reply.code(400).send({ error: 'Maximum 11 images allowed per upload' });
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    for (const img of images) {
      if (!img.base64 || typeof img.base64 !== 'string') {
        return reply.code(400).send({ error: 'Each image must have a base64 field' });
      }
      if (!allowedTypes.includes(img.mediaType)) {
        return reply.code(400).send({ error: `Unsupported mediaType: ${img.mediaType}` });
      }
    }

    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    };
    const imagesDir = path.join(workdir, 'assets', 'presentations', namespace, 'images');
    await mkdir(imagesDir, { recursive: true });

    const urls = await Promise.all(images.map(async (img) => {
      const ext = extMap[img.mediaType] ?? 'jpg';
      const filename = `upload-${crypto.randomUUID().slice(0, 12)}.${ext}`;
      const destPath = path.join(imagesDir, filename);
      await writeFile(destPath, Buffer.from(img.base64, 'base64'));
      return `/presentation-images/${namespace}/${filename}`;
    }));

    return reply.send({ urls });
  });

  // POST /presentations/:namespace/images/prepare
  // Skill that runs when the user uploads images for microsite generation.
  // 1. Uploads images to disk (same as /upload)
  // 2. Analyzes all images via Claude Vision in a single batch call
  // 3. If proposalMarkdown or userInstructions provided, generates a per-image placement brief
  // Returns: { images: Array<{ url, analysis, placementHint? }> }
  // Body: { images: [{base64, mediaType}], proposalMarkdown?: string, userInstructions?: string }
  app.post('/presentations/:namespace/images/prepare', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as {
      images?: Array<{ base64: string; mediaType: string }>;
      proposalMarkdown?: string;
      userInstructions?: string;
    } | undefined;

    const images = body?.images;
    const proposalMarkdown = body?.proposalMarkdown?.trim() ?? '';
    const userInstructions = body?.userInstructions?.trim() ?? '';

    if (!Array.isArray(images) || images.length === 0) {
      return reply.code(400).send({ error: 'images must be a non-empty array' });
    }
    if (images.length > 11) {
      return reply.code(400).send({ error: 'Maximum 11 images allowed' });
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    for (const img of images) {
      if (!img.base64 || typeof img.base64 !== 'string') {
        return reply.code(400).send({ error: 'Each image must have a base64 field' });
      }
      if (!allowedTypes.includes(img.mediaType)) {
        return reply.code(400).send({ error: `Unsupported mediaType: ${img.mediaType}` });
      }
    }

    const apiKey = env.ANTHROPIC_API_KEY ?? '';
    if (!apiKey) return reply.code(503).send({ error: 'ANTHROPIC_API_KEY not configured' });
    const model = env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    };
    const imagesDir = path.join(workdir, 'assets', 'presentations', namespace, 'images');
    await mkdir(imagesDir, { recursive: true });

    // Step 1: Upload all images in parallel
    const urls = await Promise.all(images.map(async (img) => {
      const ext = extMap[img.mediaType] ?? 'jpg';
      const filename = `upload-${crypto.randomUUID().slice(0, 12)}.${ext}`;
      const destPath = path.join(imagesDir, filename);
      await writeFile(destPath, Buffer.from(img.base64, 'base64'));
      return `/presentation-images/${namespace}/${filename}`;
    }));

    // Step 2: Vision analysis — batch all images in a single Claude call
    type VisionMeta = {
      description: string;
      objects: string[];
      tags: string[];
      sentiment: string;
      dominantColors: string[];
      readableText: string;
    };

    const visionContent: Array<
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
      | { type: 'text'; text: string }
    > = [
      ...images.map((img) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
      })),
      {
        type: 'text' as const,
        text: `Analyze each of the ${images.length} image(s) above and return a JSON array with exactly ${images.length} objects. Each object must have: description (1-2 sentences), objects (string[]), tags (5-8 keywords), sentiment (one word: warm/cool/neutral/professional/energetic/calm/bold/minimal), dominantColors (2-3 color names), readableText (visible text or empty string). Return ONLY the JSON array.`,
      },
    ];

    const visionRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: 'user', content: visionContent }] }),
    });

    if (!visionRes.ok) {
      const errText = await visionRes.text().catch(() => '?');
      return reply.code(502).send({ error: `Vision analysis failed: ${errText.slice(0, 200)}` });
    }

    const visionJson = await visionRes.json() as { content: Array<{ type: string; text?: string }> };
    const rawVisionText = visionJson.content.find((b) => b.type === 'text')?.text ?? '[]';
    // Strip markdown code fences Claude sometimes wraps around JSON
    const visionText = rawVisionText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    let analysisResults: VisionMeta[];
    try {
      const parsed = JSON.parse(visionText);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      // Pad or trim to match image count (Claude occasionally miscounts)
      while (parsed.length < images.length) {
        parsed.push({ description: '', objects: [], tags: [], sentiment: 'neutral', dominantColors: [], readableText: '' });
      }
      analysisResults = parsed.slice(0, images.length) as VisionMeta[];
    } catch (e) {
      return reply.code(502).send({ error: `Vision analysis returned unexpected format: ${String(e).slice(0, 100)}` });
    }

    // Step 3: Placement brief — one LLM call to contextualise each image within the proposal
    let placementHints: string[] = [];
    if (proposalMarkdown || userInstructions) {
      const briefParts: string[] = [];
      if (userInstructions) briefParts.push(`User's instructions for image usage: ${userInstructions}`);
      if (proposalMarkdown) briefParts.push(`Proposal content (excerpt):\n${proposalMarkdown.slice(0, 2500)}`);
      briefParts.push('');
      briefParts.push('Images to place:');
      analysisResults.forEach((r, i) => {
        briefParts.push(`  Image ${i + 1}: ${r.description} — tags: ${r.tags.join(', ')} — mood: ${r.sentiment}`);
      });
      briefParts.push('');
      briefParts.push(`For each of the ${images.length} image(s), write ONE sentence: which section of the microsite it fits best and why, being specific to this proposal's content. Return a JSON array of ${images.length} strings.`);

      try {
        const briefRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 512,
            messages: [{ role: 'user', content: briefParts.join('\n') }],
          }),
        });
        if (briefRes.ok) {
          const briefJson = await briefRes.json() as { content: Array<{ type: string; text?: string }> };
          const briefText = briefJson.content.find((b) => b.type === 'text')?.text ?? '[]';
          const hints = JSON.parse(briefText);
          if (Array.isArray(hints) && hints.length === images.length) placementHints = hints as string[];
        }
      } catch {
        // Placement hints are optional — don't fail the whole skill
      }
    }

    const result = urls.map((url, i) => ({
      url,
      analysis: {
        index: i,
        source: 'base64',
        metadata: {
          ...analysisResults[i],
          formatHint: images[i].mediaType,
          dimensions: null as { width: number; height: number } | null,
        },
      },
      ...(placementHints[i] ? { placementHint: placementHints[i] } : {}),
    }));

    return reply.send({ images: result });
  });

  // POST /presentations/:namespace/:proposalId/regenerate-section
  // Regenerates the customHtml for a single section using the existing AST content
  // and CSS vars. Used by MicrositeEditorPro's per-section Regenerate button.
  // Body: { sectionId: string; currentAst: object }
  // Returns: { sectionId: string; html: string; elapsed: number }
  app.post('/presentations/:namespace/:proposalId/regenerate-section', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as { sectionId?: string; currentAst?: Record<string, unknown> } | undefined;
    const sectionId = body?.sectionId?.trim();
    if (!sectionId) return reply.code(400).send({ error: 'sectionId is required' });

    const apiKey = env.ANTHROPIC_API_KEY ?? '';
    if (!apiKey) return reply.code(500).send({ error: 'ANTHROPIC_API_KEY not configured' });

    // Load AST from body or fall back to saved file
    let ast = body?.currentAst;
    if (!ast) {
      const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
      try { ast = JSON.parse(await readFile(astPath, 'utf-8')) as Record<string, unknown>; }
      catch { return reply.code(404).send({ error: 'No AST found' }); }
    }

    const sections = ast.sections as Array<Record<string, unknown>> | undefined;
    const sectionIdx = sections?.findIndex(s => s.id === sectionId) ?? -1;
    if (sectionIdx < 0) return reply.code(404).send({ error: `Section ${sectionId} not found in AST` });
    const section = sections![sectionIdx];

    // Get CSS vars and tone from the AST brand
    const brand = ast.brand as Record<string, unknown> | undefined;
    const cssVars = (brand?.extractedCssVariables as Record<string, string> | undefined) ?? {};
    const tone: import('../skills/design-skill-microsite.js').Tone = 'editorial/magazine';

    // Haiku for single-section regeneration — same mechanical task as Phase 3
    const regenFn = async (prompt: string): Promise<string> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }),
        });
        if (r.status === 429) {
          const delay = parseInt(r.headers.get('retry-after') ?? '30', 10) * 1000 * (attempt + 1);
          await new Promise(res => setTimeout(res, delay));
          continue;
        }
        if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
        const d = await r.json() as { content: Array<{ type: string; text: string }> };
        return d.content.filter(b => b.type === 'text').map(b => b.text).join('');
      }
      throw new Error('Max retries exceeded');
    };

    const t0 = Date.now();
    try {
      const html = await generateSectionHtml(section, tone, cssVars, null, regenFn, sectionIdx);
      return reply.send({ sectionId, html, elapsed: Date.now() - t0 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Section regeneration failed: ${message}` });
    }
  });

  // POST /presentations/:namespace/:proposalId/edit-section-html
  // Natural language edit: applies a user instruction to a section's existing HTML.
  // The AI returns ONLY the modified HTML — no explanation, no markdown.
  // Body: { sectionHtml: string; instruction: string }
  // Returns: { html: string }
  app.post('/presentations/:namespace/:proposalId/edit-section-html', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as { sectionHtml?: string; instruction?: string } | undefined;
    const sectionHtml = body?.sectionHtml?.trim();
    const instruction = body?.instruction?.trim();
    if (!sectionHtml) return reply.code(400).send({ error: 'sectionHtml is required' });
    if (!instruction) return reply.code(400).send({ error: 'instruction is required' });

    const apiKey = env.ANTHROPIC_API_KEY ?? '';
    const model  = env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
    if (!apiKey) return reply.code(500).send({ error: 'ANTHROPIC_API_KEY not configured' });

    const systemPrompt = 'You are an HTML editor. You will receive a section\'s HTML and a user instruction. Return ONLY the modified HTML for that section with no explanation, no markdown, no code fences. Start directly with the opening HTML tag.';
    const userPrompt   = `USER INSTRUCTION: ${instruction}\n\nSECTION HTML:\n${sectionHtml}`;

    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model, max_tokens: 8000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      if (r.status === 429) {
        const delay = parseInt(r.headers.get('retry-after') ?? '30', 10) * 1000 * (attempt + 1);
        await new Promise(res => setTimeout(res, delay));
        continue;
      }
      if (!r.ok) return reply.code(502).send({ error: `Anthropic ${r.status}: ${await r.text()}` });
      const d = await r.json() as { content: Array<{ type: string; text: string }> };
      const html = d.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      return reply.send({ html });
    }
    return reply.code(502).send({ error: 'Max retries exceeded' });
  });

  // POST /presentations/:namespace/:proposalId/edit-tokens
  // Direct LLM call: given current CSS custom-property tokens + instruction,
  // returns only the token keys that need to change. No agent layer.
  // Body: { instruction: string; currentTokens: Record<string, string> }
  // Returns: { tokens: Record<string, string>; changed: string[]; summary: string }
  app.post('/presentations/:namespace/:proposalId/edit-tokens', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const body = req.body as { instruction?: string; currentTokens?: Record<string, string> } | undefined;
    const instruction   = body?.instruction?.trim();
    const currentTokens = body?.currentTokens ?? {};
    if (!instruction) return reply.code(400).send({ error: 'instruction is required' });

    const apiKey = env.ANTHROPIC_API_KEY ?? '';
    const model  = env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
    if (!apiKey) return reply.code(500).send({ error: 'ANTHROPIC_API_KEY not configured' });

    const systemPrompt = `You are a CSS design token editor for a professional microsite.
You receive a JSON map of CSS custom properties and a user instruction.
Return ONLY a valid JSON object containing the tokens that need to be updated.
Only include keys that should change. Do not include unchanged tokens.
Do not explain. No markdown. No code fences. Raw JSON only.

Common token names and their roles:
--ms-bg: main background  --ms-surface: card/surface bg  --ms-accent: brand accent color
--ms-text: primary text   --ms-muted: secondary text     --ms-border: border/divider color
--ms-font-body: body font family  --ms-font-heading: heading font  --ms-is-dark: "1" dark / "0" light
--ms-gradient: hero gradient  --ms-overlay: overlay/scrim color  --ms-radius: base border-radius (px)`;

    const userPrompt = `INSTRUCTION: ${instruction}\n\nCURRENT TOKENS:\n${JSON.stringify(currentTokens, null, 2)}`;

    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model, max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      if (r.status === 429) {
        const delay = parseInt(r.headers.get('retry-after') ?? '30', 10) * 1000 * (attempt + 1);
        await new Promise(res => setTimeout(res, delay));
        continue;
      }
      if (!r.ok) return reply.code(502).send({ error: `Anthropic ${r.status}: ${await r.text()}` });
      const d = await r.json() as { content: Array<{ type: string; text: string }> };
      const raw = d.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      let newTokens: Record<string, string> = {};
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        newTokens = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      } catch {
        return reply.code(502).send({ error: 'Failed to parse token response', raw });
      }
      const changed = Object.keys(newTokens);
      const summary = changed.length > 0
        ? `Updated ${changed.length} token${changed.length === 1 ? '' : 's'}: ${changed.slice(0, 3).join(', ')}${changed.length > 3 ? '…' : ''}`
        : 'No tokens changed';
      return reply.send({ tokens: newTokens, changed, summary });
    }
    return reply.code(502).send({ error: 'Max retries exceeded' });
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

    // Load AST from body or fall back to most recent versioned file
    let currentAst = body.currentAst;
    if (!currentAst) {
      try {
        const _base = path.join(workdir, 'assets', 'presentations', namespace);
        const _files = await readdir(_base).catch(() => [] as string[]);
        const _match = _files.filter(f => f.startsWith('microsite_') && f.endsWith('.json')).sort().at(-1);
        if (!_match) throw new Error('not found');
        const _raw = await readFile(path.join(_base, _match), 'utf-8');
        currentAst = (JSON.parse(_raw) as { data: Record<string, unknown> }).data;
      } catch {
        return reply.code(404).send({ error: `No microsite AST found for ${namespace}/${proposalId}` });
      }
    }

    // Strip preview injections before passing to the LLM — if the client-side
    // iframe has injected ephemeral scripts into customHtml, the model must
    // never see them (it can absorb the code into section content fields).
    stripAstInjections(currentAst);

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

    // Strip injections from the returned AST too — belt-and-suspenders.
    stripAstInjections(editResult.ast);

    // Optionally save patched AST back — update the most recent versioned file in place
    if (body.commit !== false) {
      const _base = path.join(workdir, 'assets', 'presentations', namespace);
      const _files = await readdir(_base).catch(() => [] as string[]);
      const _match = _files.filter(f => f.startsWith('microsite_') && f.endsWith('.json')).sort().at(-1);
      if (_match) {
        const _fp = path.join(_base, _match);
        const _existing = JSON.parse(await readFile(_fp, 'utf-8')) as { id: string; type: string; version: number; createdAt: string; data: unknown };
        _existing.data = editResult.ast;
        await writeFile(_fp, JSON.stringify(_existing, null, 2), 'utf-8');
      }
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

    // Load AST from body or fall back to most recent versioned file
    let ast = body?.ast;
    if (!ast) {
      try {
        const _base = path.join(workdir, 'assets', 'presentations', namespace);
        const _files = await readdir(_base).catch(() => [] as string[]);
        const _match = _files.filter(f => f.startsWith('microsite_') && f.endsWith('.json')).sort().at(-1);
        if (!_match) throw new Error('not found');
        ast = (JSON.parse(await readFile(path.join(_base, _match), 'utf-8')) as { data: Record<string, unknown> }).data;
      } catch {
        return reply.code(404).send({ error: `No microsite AST found for ${namespace}/${proposalId}` });
      }
    }

    try {
      let html: string;

      // v2 microsites store a complete HTML document in sections[0].customHtml —
      // the React renderer wraps it in another document, so extract it directly.
      const isV2 = ast.generationMode === 'v2';
      if (isV2) {
        const sections = ast.sections as Array<{ customHtml?: string }> | undefined;
        html = sections?.[0]?.customHtml ?? '';
        if (!html) {
          return reply.code(422).send({ error: 'v2 microsite has no HTML content to export' });
        }
      } else {
        // Embed all images as base64 data URIs so the exported HTML is fully
        // self-contained — no external requests, no localhost dependencies.
        const astWithImages = await embedImagesAsBase64(ast, workdir, namespace);
        html = renderMicrositeToHtml(astWithImages as Parameters<typeof renderMicrositeToHtml>[0]);
      }

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

  // GET /presentations/:namespace/:proposalId/publish-meta
  // Returns the last published subdomain/url for a microsite, or null if never published.
  // Public — no auth required (same policy as /microsite route).
  app.get('/presentations/:namespace/:proposalId/publish-meta', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const superClientMetaPath = path.join(workdir, 'super-clients', namespace, 'microsites', `${proposalId}.publish.json`);
    const standardMetaPath = path.join(workdir, 'assets', 'presentations', namespace, `${proposalId}.publish.json`);
    for (const metaPath of [superClientMetaPath, standardMetaPath]) {
      try {
        const raw = await readFile(metaPath, 'utf-8');
        return reply.send(JSON.parse(raw));
      } catch { /* try next */ }
    }
    return reply.send(null);
  });

  // POST /presentations/:namespace/:proposalId/publish-meta
  // Saves the published subdomain/url (or custom domain) after a successful S3 publish.
  app.post('/presentations/:namespace/:proposalId/publish-meta', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;
    const body = req.body as { subdomain?: string; customDomain?: string; url: string; publishedAt: string };
    // Prefer super-client directory if microsite exists there
    const superClientMicrosite = path.join(workdir, 'super-clients', namespace, 'microsites', `${proposalId}.json`);
    let metaDir: string;
    try {
      await readFile(superClientMicrosite, 'utf-8');
      metaDir = path.join(workdir, 'super-clients', namespace, 'microsites');
    } catch {
      metaDir = path.join(workdir, 'assets', 'presentations', namespace);
    }
    await mkdir(metaDir, { recursive: true });
    await writeFile(path.join(metaDir, `${proposalId}.publish.json`), JSON.stringify(body, null, 2), 'utf-8');
    return reply.send({ ok: true });
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
      try {
        const _base = path.join(workdir, 'assets', 'presentations', namespace);
        const _files = await readdir(_base).catch(() => [] as string[]);
        const _match = _files.filter(f => f.startsWith('microsite_') && f.endsWith('.json')).sort().at(-1);
        if (!_match) throw new Error('not found');
        ast = (JSON.parse(await readFile(path.join(_base, _match), 'utf-8')) as { data: Record<string, unknown> }).data;
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
