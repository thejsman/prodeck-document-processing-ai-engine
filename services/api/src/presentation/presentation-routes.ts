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

import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

export function registerPresentationRoutes(
  app: FastifyInstance,
  workdir: string,
): void {

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

    // Load presentation to get fileName and theme config
    let presentation: Awaited<ReturnType<typeof getPresentation>>;
    try {
      presentation = await getPresentation(workdir, namespace, proposalId);
    } catch (err) {
      if ((err as { code?: string }).code === 'NOT_FOUND') {
        return reply.code(404).send({ error: 'Presentation not found' });
      }
      throw err;
    }

    // Read proposal markdown
    const mdPath = path.join(workdir, 'output', presentation.fileName);
    let markdown: string;
    try {
      markdown = await readFile(mdPath, 'utf-8');
    } catch {
      return reply.code(404).send({ error: `Proposal file not found: ${presentation.fileName}` });
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
        metadata: {
          proposalMarkdown: markdown,
          designConfig: {
            theme: presentation.config.theme,
            primaryColor: presentation.config.accentColor,
          },
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

            if (chosenSource === 'dalle') {
              const prompt = buildDallePrompt(sec.sectionType, query, accentColor);
              const url = await generateDalle3Image(prompt);
              if (url) sec.image.url = url;
            } else {
              const url = await fetchUnsplashImageUrl(query);
              if (url) sec.image.url = url;
            }
          }),
        );

        const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
        await writeFile(astPath, JSON.stringify(ast, null, 2), 'utf-8');
      }

      return reply.send({ assets: result.assets ?? [] });
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

    try {
      send({ type: 'start', message: 'Pipeline started' });

      const result = await runner.run('microsite-generator-agent', {
        namespace,
        metadata: {
          proposalMarkdown: markdown,
          plugin: body?.plugin ?? 'cobalt',
          brand: body?.brand ?? {},
          designBrief: body?.designBrief ?? '',
          ...(body?.preSynthesizedDesignSystem ? { preSynthesizedDesignSystem: body.preSynthesizedDesignSystem } : {}),
          // Streaming callback — fires after each section's LLM call completes
          onSectionComplete: (section: Record<string, unknown>) => {
            send({ type: 'section', ...section });
          },
        },
      });

      // Resolve images for all sections
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
            if (chosenSource === 'gradient') { sec.image.source = 'gradient'; return; }
            sec.image.source = chosenSource;
            if (chosenSource === 'dalle') {
              const prompt = buildDallePrompt(sec.sectionType, query, accentColor);
              const url = await generateDalle3Image(prompt);
              if (url) { sec.image.url = url; send({ type: 'image', sectionId: (sec as unknown as { id?: string }).id ?? sec.sectionType, url }); }
            } else {
              const url = await fetchUnsplashImageUrl(query);
              if (url) { sec.image.url = url; send({ type: 'image', sectionId: (sec as unknown as { id?: string }).id ?? sec.sectionType, url }); }
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
      return reply.send({ ast: JSON.parse(raw) });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.send({ ast: null });
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
      const html = renderMicrositeToHtml(ast as Parameters<typeof renderMicrositeToHtml>[0]);
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
