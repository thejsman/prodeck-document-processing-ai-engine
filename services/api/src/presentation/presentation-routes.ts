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
 */

import { readFile, writeFile } from 'node:fs/promises';
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

/**
 * Fetch a contextual landscape photo URL from the Unsplash API.
 * Returns null when no key is configured or the request fails.
 */
async function fetchUnsplashImageUrl(query: string): Promise<string | null> {
  const key = env.UNSPLASH_ACCESS_KEY;
  if (!key?.trim()) return null;
  const words = query.trim().split(/\s+/);
  const candidates = [query, words.slice(0, 3).join(' '), words.slice(0, 2).join(' '), words[0]]
    .filter((q, i, arr) => q && arr.indexOf(q) === i);
  for (const q of candidates) {
    try {
      const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(q)}&orientation=landscape&client_id=${key}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const photo = await res.json() as { urls?: { regular?: string }; errors?: string[] };
      if (photo.errors?.length || !photo.urls?.regular) continue;
      return photo.urls.regular;
    } catch { continue; }
  }
  return null;
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

      // Resolve hero background image via Unsplash API and patch the saved AST
      const ast = result.json as { sections?: Array<{ sectionType: string; image: { source: string; query: string; url: string | null }; content: Record<string, unknown> }> } | null | undefined;
      if (ast?.sections) {
        const hero = ast.sections.find(s => s.sectionType === 'hero' && s.image.source === 'unsplash');
        if (hero) {
          const query = (hero.content.imageQuery as string | undefined) || hero.image.query;
          if (query) {
            const imageUrl = await fetchUnsplashImageUrl(query);
            if (imageUrl) {
              hero.image.url = imageUrl;
              const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
              await writeFile(astPath, JSON.stringify(ast, null, 2), 'utf-8');
            }
          }
        }
      }

      return reply.send({ assets: result.assets ?? [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Agent execution failed: ${message}` });
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
}
