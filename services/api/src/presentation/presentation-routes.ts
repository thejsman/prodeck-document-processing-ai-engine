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
import {
  listPresentations,
  getPresentation,
  createPresentation,
  updateConfig,
  type PresentationConfig,
} from './presentation-service.js';
import { ensureRegistered, buildRunner, llmGenerateFn } from '../agent-routes.js';
import { buildDesignSystemPrompt, buildFontUrls } from '@ai-engine/agent-microsite-generator';
import { DesignEditorAgent } from '@ai-engine/agent-design-editor';
import { renderMicrositeToHtml } from './html-exporter.js';
import { renderMicrositeToPptx } from './pptx-exporter.js';
import {
  fetchUnsplashImageUrl,
  generateDalle3Image,
  buildDallePrompt,
  resolveImageSource,
  downloadImageToFile,
} from '../image-routes.js';

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
  const ok = await downloadImageToFile(remoteUrl, destPath);
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
    const stream = createReadStream(filePath);
    return reply.type('image/jpeg').send(stream);
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
    return reply.send({ presentations });
  });

  // GET /presentations/history — all saved microsite ASTs across every namespace
  app.get('/presentations/history', async (req: FastifyRequest, reply: FastifyReply) => {
    const assetsDir = path.join(workdir, 'assets', 'presentations');
    let namespaceDirs: string[];
    try {
      namespaceDirs = await readdir(assetsDir);
    } catch {
      return reply.send({ entries: [] });
    }

    const entries: Array<{ namespace: string; savedAt: string; ast: unknown }> = [];
    await Promise.all(
      namespaceDirs.map(async (ns) => {
        try {
          const astPath = path.join(assetsDir, ns, 'site-ast.json');
          const raw = await readFile(astPath, 'utf-8');
          const ast = JSON.parse(raw);
          const fileStat = await stat(astPath);
          entries.push({ namespace: ns, savedAt: fileStat.mtime.toISOString(), ast });
        } catch {
          // namespace has no saved AST — skip
        }
      }),
    );

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
    const mdPath = path.join(workdir, 'output', fileName);
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
      const mdPath = path.join(workdir, 'output', presentation.fileName);
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

    try {
      const result = await runner.run('microsite-generator-agent', {
        namespace,
        ...(body?.customInstructions ? { prompt: body.customInstructions } : {}),
        metadata: {
          proposalMarkdown: markdown,
          ...(body?.plugin ? { plugin: body.plugin } : {}),
          ...(body?.brand ? { brand: body.brand } : {}),
          ...(body?.customInstructions ? { customInstructions: body.customInstructions } : {}),
          ...(body?.preSynthesizedDesignSystem ? { preSynthesizedDesignSystem: body.preSynthesizedDesignSystem } : {}),
        },
      });

      // Resolve images for all visual sections in parallel
      type AstSection = { sectionType: string; image: { source: string; query: string; url: string | null }; content: Record<string, unknown> };
      const ast = result.json as { sections?: AstSection[]; brand?: { primaryColor?: string } } | null | undefined;
      if (ast?.sections) {
        const hasUnsplash = !!(env.UNSPLASH_ACCESS_KEY?.trim());
        const hasDalle = !!(env.OPENAI_API_KEY?.trim());
        const accentColor = ast.brand?.primaryColor;

        await Promise.all(
          ast.sections.map(async (sec) => {
            const query = (sec.content.imageQuery as string | undefined) || sec.image.query;
            if (!query?.trim()) return;

            const chosenSource = resolveImageSource(sec.sectionType, hasUnsplash, hasDalle);
            if (chosenSource === 'gradient') {
              sec.image.source = 'gradient';
              return;
            }

            sec.image.source = chosenSource;
            const secId = (sec as unknown as { id?: string }).id ?? sec.sectionType;

            if (chosenSource === 'dalle') {
              const prompt = buildDallePrompt(sec.sectionType, query, accentColor);
              const remoteUrl = await generateDalle3Image(prompt);
              if (remoteUrl) sec.image.url = await saveImagePersistently(remoteUrl, namespace, secId, workdir);
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
    } | undefined;

    // Load markdown from body or saved file
    let markdown = body?.proposalMarkdown ?? '';
    if (!markdown) {
      try {
        let presentation: Awaited<ReturnType<typeof getPresentation>>;
        try { presentation = await getPresentation(workdir, namespace, proposalId); } catch { return send({ type: 'error', message: 'Presentation not found' }); }
        const mdPath = path.join(workdir, 'output', presentation.fileName);
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
    const accentColor = (body?.brand?.primaryColor as string | undefined) ?? undefined;

    // Map of sectionId → in-flight image fetch Promise (started as sections complete)
    const imageFetches = new Map<string, Promise<string | null>>();

    try {
      send({ type: 'start', message: 'Pipeline started' });

      const result = await runner.run('microsite-generator-agent', {
        namespace,
        ...(body?.customInstructions ? { prompt: body.customInstructions } : {}),
        metadata: {
          proposalMarkdown: markdown,
          plugin: body?.plugin ?? 'cobalt',
          brand: body?.brand ?? {},
          ...(body?.customInstructions ? { customInstructions: body.customInstructions } : {}),
          ...(body?.fullDesignPrompt ? { fullDesignPrompt: body.fullDesignPrompt } : {}),
          ...(body?.designBrief ? { designBrief: body.designBrief } : {}),
          ...(body?.preSynthesizedDesignSystem ? { preSynthesizedDesignSystem: body.preSynthesizedDesignSystem } : {}),
          // Plan callback — fires once with the final section list before generation starts
          onPlanReady: (plan: Record<string, unknown>) => {
            send({ type: 'plan', totalSections: plan.totalSections, sectionTypes: plan.sectionTypes });
          },
          // Section callback — fires after each section's LLM call completes; kicks off image fetch immediately
          onSectionComplete: (section: Record<string, unknown>) => {
            send({ type: 'section', ...section });
            // Start image fetch in parallel — don't await, fire-and-forget with tracked promise
            const sectionId = section.id as string | undefined;
            const sectionType = section.sectionType as string | undefined;
            const imageQuery = (section.content as Record<string, unknown> | undefined)?.imageQuery as string | undefined;
            if (sectionId && sectionType && imageQuery?.trim()) {
              const chosenSource = resolveImageSource(sectionType, hasUnsplash, hasDalle);
              if (chosenSource !== 'gradient') {
                const fetchPromise = (async (): Promise<string | null> => {
                  try {
                    let remoteUrl: string | null = null;
                    if (chosenSource === 'dalle') {
                      const prompt = buildDallePrompt(sectionType, imageQuery, accentColor);
                      remoteUrl = await generateDalle3Image(prompt);
                    } else {
                      remoteUrl = await fetchUnsplashImageUrl(imageQuery);
                    }
                    if (!remoteUrl) return null;
                    const localUrl = await saveImagePersistently(remoteUrl, namespace, sectionId, workdir);
                    send({ type: 'image', sectionId, url: localUrl });
                    return localUrl;
                  } catch { return null; }
                })();
                imageFetches.set(sectionId, fetchPromise);
              }
            }
          },
        },
      });

      // Reconcile images: await any in-flight fetches, fetch remaining sections that had no query at callback time
      type AstSection = { sectionType: string; image: { source: string; query: string; url: string | null }; content: Record<string, unknown> };
      const ast = result.json as { sections?: AstSection[]; brand?: { primaryColor?: string } } | null | undefined;
      if (ast?.sections) {
        await Promise.all(
          ast.sections.map(async (sec) => {
            const secId = (sec as unknown as { id?: string }).id ?? sec.sectionType;
            if (imageFetches.has(secId)) {
              // Await the parallel fetch that already started during streaming (already saved locally)
              const localUrl = await imageFetches.get(secId)!;
              if (localUrl) { sec.image.url = localUrl; sec.image.source = hasDalle ? 'dalle' : 'unsplash'; }
              return;
            }
            // Section had no imageQuery at callback time — try now using AST image.query
            const query = (sec.content.imageQuery as string | undefined) || sec.image.query;
            if (!query?.trim()) return;
            const chosenSource = resolveImageSource(sec.sectionType, hasUnsplash, hasDalle);
            if (chosenSource === 'gradient') { sec.image.source = 'gradient'; return; }
            sec.image.source = chosenSource;
            if (chosenSource === 'dalle') {
              const prompt = buildDallePrompt(sec.sectionType, query, ast.brand?.primaryColor ?? accentColor);
              const remoteUrl = await generateDalle3Image(prompt);
              if (remoteUrl) {
                const localUrl = await saveImagePersistently(remoteUrl, namespace, secId, workdir);
                sec.image.url = localUrl;
                send({ type: 'image', sectionId: secId, url: localUrl });
              }
            } else {
              const remoteUrl = await fetchUnsplashImageUrl(query);
              if (remoteUrl) {
                const localUrl = await saveImagePersistently(remoteUrl, namespace, secId, workdir);
                sec.image.url = localUrl;
                send({ type: 'image', sectionId: secId, url: localUrl });
              }
            }
          }),
        );

        const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
        await writeFile(astPath, JSON.stringify(ast, null, 2), 'utf-8');
      }

      send({ type: 'complete', ast });
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      reply.raw.end();
    }
  });

  // GET /presentations/:namespace/:proposalId/microsite
  // Returns the previously generated site AST (null if not yet generated).
  // The microsite-generator-agent saves to assets/presentations/<namespace>/site-ast.json
  app.get('/presentations/:namespace/:proposalId/microsite', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
    try {
      const raw = await readFile(astPath, 'utf-8');
      const fileStat = await stat(astPath);
      return reply.send({ ast: JSON.parse(raw), savedAt: fileStat.mtime.toISOString() });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.send({ ast: null, savedAt: null });
      }
      throw err;
    }
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
