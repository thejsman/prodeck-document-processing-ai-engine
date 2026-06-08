/**
 * Classic microsite generation — matches the microsite/Optimization branch exactly.
 *
 * No design-skill pipeline, no CSS token generation, no injectThemeCSS.
 * Plugin-based theming drives the entire visual design.
 *
 * Endpoint:
 *   POST /presentations/:namespace/:proposalId/generate-classic-stream
 */

import { writeFile, mkdir } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { env } from 'node:process';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { buildBriefFramingRule, buildSectionTypeGuidance, buildSectionOrderGuidance } from '../workflows/microsite-generation.handlers.js';
import { ContextService } from '../chat/context.service.js';
import { getPresentation } from './presentation-service.js';
import { ensureRegistered, buildRunner } from '../agent-routes.js';
import {
  fetchUnsplashImageUrl,
  generateDalle3Image,
  buildDallePrompt,
  downloadImageToFile,
} from '../image-routes.js';

// Only hero sections get real images when an API key is available; otherwise use gradient.
function resolveClassicImageSource(
  sectionType: string,
  hasUnsplash: boolean,
  hasDalle: boolean,
): 'dalle' | 'unsplash' | 'gradient' {
  if (sectionType !== 'hero') return 'gradient';
  if (hasDalle) return 'dalle';
  if (hasUnsplash) return 'unsplash';
  return 'gradient';
}
import {
  resolveProposalMdPath,
  checkNamespaceAccess,
  getAuth,
  saveImagePersistently,
} from './presentation-routes.js';
import { readFile } from 'node:fs/promises';

const PDF_ITEM_FIELDS = ['pillars','items','stats','features','benefits','steps','phases','technologies','layers','metrics','comparisons','deliverables','questions','rows','testimonials'];
const PDF_MAX_PER_SLIDE = 4;

export function registerClassicPresentationRoutes(
  app: FastifyInstance,
  workdir: string,
): void {
  // POST /presentations/:namespace/:proposalId/generate-classic-stream
  // Optimization-branch style generation — plugin-theme driven, no design skills.
  app.post('/presentations/:namespace/:proposalId/generate-classic-stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalId } = req.params as { namespace: string; proposalId: string };
    const auth = getAuth(req);
    if (!checkNamespaceAccess(auth, namespace, reply)) return;

    // Hijack the reply so Fastify doesn't buffer the SSE response
    reply.hijack();
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

    const hasUnsplash = !!(env.UNSPLASH_ACCESS_KEY?.trim());
    const hasDalle = !!(env.OPENAI_API_KEY?.trim());
    const accentColor = (body?.brand?.primaryColor as string | undefined) ?? undefined;
    const urlHeroImageUrl = (body?.urlReferenceDesign as { heroImageUrl?: string | null } | undefined)?.heroImageUrl ?? null;
    const pdfFriendly = !!(body?.pdfFriendly);
    let sectionIndexOffset = 0;

    // Brief-aware instructions from context.json
    let streamBriefPrefix = '';
    let streamClientIndustry = 'general';
    let streamClientName = '—';
    try {
      const ctxSvc = new ContextService(workdir);
      const ctx = await ctxSvc.get(namespace);
      type SF = Record<string, { value?: unknown }>;
      const fields: SF = ((ctx as unknown as Record<string, unknown>)?.requirements as Record<string, SF> | undefined)?.fields ?? {};
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

    const streamEffectiveInstructions = body?.customInstructions
      ? `${streamBriefPrefix}${body.customInstructions}`
      : streamBriefPrefix || undefined;

    try {
      send({ type: 'start', message: 'Pipeline started' });

      const result = await runner.run('microsite-generator-agent', {
        namespace,
        ...(streamEffectiveInstructions ? { prompt: streamEffectiveInstructions } : {}),
        metadata: {
          proposalMarkdown: markdown,
          plugin: body?.plugin ?? 'none',
          brand: body?.brand ?? {},
          clientIndustry: streamClientIndustry,
          ...(streamEffectiveInstructions ? { customInstructions: streamEffectiveInstructions } : {}),
          ...(body?.fullDesignPrompt ? { fullDesignPrompt: body.fullDesignPrompt } : {}),
          ...(body?.designBrief ? { designBrief: body.designBrief } : {}),
          // Always skip Pass -1 (design system synthesis) — classic mode uses plugin theming, not CSS tokens.
          // Pass a non-null rawTokens so the agent's preSynthesized check is truthy and skips the LLM call.
          preSynthesizedDesignSystem: body?.preSynthesizedDesignSystem ?? { rawTokens: {} },
          ...(body?.pdfFriendly ? { pdfFriendly: true } : {}),
          ...(body?.referenceFile ? { referenceFile: body.referenceFile } : {}),
          ...(body?.urlReferenceDesign ? { urlReferenceDesign: body.urlReferenceDesign } : {}),
          ...(body?.urlLayout ? { urlLayout: body.urlLayout } : {}),
          ...(body?.urlImages?.length ? { urlImages: body.urlImages } : {}),
          onPlanReady: (plan: Record<string, unknown>) => {
            send({ type: 'plan', totalSections: plan.totalSections, sectionTypes: plan.sectionTypes, ...(plan.referenceCssVars ? { referenceCssVars: plan.referenceCssVars } : {}) });
          },
          onSectionComplete: (section: Record<string, unknown>) => {
            const content = ((section.content ?? {}) as Record<string, unknown>);
            const rawIdx = (section.index as number | undefined) ?? 0;
            const adjustedIdx = rawIdx + sectionIndexOffset;

            if (pdfFriendly) {
              for (const field of PDF_ITEM_FIELDS) {
                const items = content[field];
                if (Array.isArray(items) && items.length > PDF_MAX_PER_SLIDE) {
                  content[field] = items.slice(0, PDF_MAX_PER_SLIDE);
                  const pdfSectionType = section.sectionType as string | undefined;
                  const pdfChosenSource = pdfSectionType ? resolveClassicImageSource(pdfSectionType, hasUnsplash, hasDalle) : 'gradient';
                  const pdfImageForClient = pdfChosenSource === 'gradient'
                    ? { ...(section.image as object ?? {}), url: null, source: 'gradient' }
                    : section.image;
                  send({ type: 'section', ...section, image: pdfImageForClient, content, index: adjustedIdx });

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
                  return;
                }
              }
            }

            const sectionType = section.sectionType as string | undefined;
            const chosenSource = sectionType ? resolveClassicImageSource(sectionType, hasUnsplash, hasDalle) : 'gradient';
            const sectionImgUrl = (section.image as { url?: string } | undefined)?.url;
            const agentHasUrl = !!(sectionImgUrl && sectionImgUrl.startsWith('http'));
            const imageForClient = (chosenSource === 'gradient' && !agentHasUrl)
              ? { ...(section.image as object ?? {}), url: null, source: 'gradient' }
              : section.image;
            send({ type: 'section', ...section, image: imageForClient, content, index: adjustedIdx });
          },
        },
      });

      type AstSection = { sectionType: string; image: { source: string; query: string; url: string | null }; content: Record<string, unknown> };
      const ast = result.json as { sections?: AstSection[]; brand?: { primaryColor?: string } } | null | undefined;
      const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');

      if (ast?.sections) {
        await Promise.all(
          ast.sections.map(async (sec) => {
            const secId = (sec as unknown as { id?: string }).id ?? sec.sectionType;
            const chosenSource = resolveClassicImageSource(sec.sectionType, hasUnsplash, hasDalle);

            if (sec.sectionType === 'hero' && urlHeroImageUrl) {
              try {
                const localUrl = await saveImagePersistently(urlHeroImageUrl, namespace, `${secId}-og`, workdir);
                sec.image.url = localUrl;
                sec.image.source = 'custom';
                return;
              } catch { /* fall through */ }
            }

            // Use the URL the agent already resolved (loremflickr / DALL-E) when available.
            const agentUrl = sec.image?.url;
            const agentRemoteUrl: string | null = (agentUrl && agentUrl.startsWith('http')) ? agentUrl : null;

            // No API key and no agent URL → gradient, no image fetch.
            if (chosenSource === 'gradient' && !agentRemoteUrl) {
              sec.image.url = null;
              sec.image.source = 'gradient';
              return;
            }

            let remoteUrl: string | null = agentRemoteUrl;

            if (!remoteUrl) {
              const query = (sec.content.imageQuery as string | undefined) || sec.image.query;
              if (!query?.trim()) return;
              if (chosenSource === 'dalle') {
                const prompt = buildDallePrompt(sec.sectionType, query, ast.brand?.primaryColor ?? accentColor);
                remoteUrl = await generateDalle3Image(prompt);
              } else {
                remoteUrl = await fetchUnsplashImageUrl(query);
              }
            }

            if (!remoteUrl) return;
            try {
              const localUrl = await saveImagePersistently(remoteUrl, namespace, secId, workdir);
              sec.image.url = localUrl;
              sec.image.source = chosenSource;
            } catch { /* keep original remote URL */ }
          }),
        );
      }

      // Download brand logo locally if remote
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
}
