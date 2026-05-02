// services/api/src/skills/skill-routes.ts
// Fastify REST API endpoints for the Skills system.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { llmGenerateFn } from '../agent-routes.js';
import { resolvePolicy, executeWithPolicy, type ProviderPolicyConfig } from '../provider-policy.js';
import {
  listSkills,
  getSkill,
  loadSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  findBestMatch,
  listAssets,
  uploadAsset,
  readAsset,
  deleteAsset,
  createVersion,
  listVersions,
} from './skill.service.js';
import { generateSkillFromDescription, generateSkillFromProposal, applyTabAssist } from './skill-generator.js';
import type { SectionDefinition, Skill } from './skill.types.js';

// ---------------------------------------------------------------------------
// Slug guard
// ---------------------------------------------------------------------------

function validSlug(reply: FastifyReply, slug: string): boolean {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    reply.code(400).send({ error: `Invalid slug: "${slug}"` });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerSkillRoutes(
  app: FastifyInstance,
  workdir: string,
  policyConfig: ProviderPolicyConfig | null,
): void {
  // ── List all skills ────────────────────────────────────────────────────────
  app.get('/skills', async (_req: FastifyRequest, reply: FastifyReply) => {
    const skills = await listSkills(workdir);
    return reply.send({ skills });
  });

  // ── Get full skill ─────────────────────────────────────────────────────────
  app.get('/skills/:slug', async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    if (!validSlug(reply, slug)) return;
    try {
      const loaded = await loadSkill(workdir, slug);
      return reply.send({
        skill: loaded.skill,
        instructionsMd: loaded.instructionsMd,
        sections: loaded.sections,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return reply.code(404).send({ error: msg });
      throw err;
    }
  });

  // ── Create skill (manual) ─────────────────────────────────────────────────
  app.post('/skills', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Partial<Skill> & { instructionsMd?: string; sections?: SectionDefinition[] };
    try {
      const skill = await createSkill(workdir, {
        slug: body.slug ?? slugify(body.displayName ?? ''),
        displayName: body.displayName ?? 'New Skill',
        description: body.description ?? '',
        industries: body.industries ?? [],
        projectTypes: body.projectTypes ?? [],
        tags: body.tags ?? [],
        toneDescription: body.toneDescription ?? '',
        micrositeDefaults: body.micrositeDefaults ?? {},
        pricingDefaults: body.pricingDefaults,
        defaultTemplate: body.defaultTemplate,
        scope: body.scope ?? 'global',
        namespace: body.namespace,
        author: body.author ?? 'user',
        version: '1.0',
        instructionsMd: body.instructionsMd,
        sections: body.sections,
      });
      return reply.code(201).send({ skill });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: msg });
    }
  });

  // ── Update skill ──────────────────────────────────────────────────────────
  app.put('/skills/:slug', async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    if (!validSlug(reply, slug)) return;
    const body = req.body as Partial<Skill> & { instructionsMd?: string; sections?: SectionDefinition[] };
    try {
      const skill = await updateSkill(workdir, slug, body);
      return reply.send({ skill });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return reply.code(404).send({ error: msg });
      return reply.code(400).send({ error: msg });
    }
  });

  // ── Delete skill ──────────────────────────────────────────────────────────
  app.delete('/skills/:slug', async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    if (!validSlug(reply, slug)) return;
    try {
      await deleteSkill(workdir, slug);
      return reply.send({ deleted: slug });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(404).send({ error: msg });
    }
  });

  // ── AI: generate full skill from description ──────────────────────────────
  // NOTE: This must be registered BEFORE /skills/:slug to avoid slug capture
  app.post('/skills/generate', async (req: FastifyRequest, reply: FastifyReply) => {
    const { description } = req.body as { description: string };
    if (!description?.trim()) {
      return reply.code(400).send({ error: 'description is required' });
    }
    try {
      let generated;
      if (policyConfig) {
        const policy = resolvePolicy(policyConfig, 'global', 'query');
        const { result } = await executeWithPolicy(policy, () =>
          generateSkillFromDescription(description, llmGenerateFn),
        );
        generated = result;
      } else {
        generated = await generateSkillFromDescription(description, llmGenerateFn);
      }
      return reply.send({ generated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: msg });
    }
  });

  // ── AI: generate skill from existing proposal ─────────────────────────────
  app.post('/skills/generate-from-proposal', async (req: FastifyRequest, reply: FastifyReply) => {
    const { namespace, proposalFileName } = req.body as {
      namespace: string;
      proposalFileName: string;
    };
    if (!namespace || !proposalFileName) {
      return reply.code(400).send({ error: 'namespace and proposalFileName are required' });
    }
    if (proposalFileName.includes('..') || path.isAbsolute(proposalFileName)) {
      return reply.code(400).send({ error: 'Invalid proposalFileName' });
    }
    const proposalPath = path.join(workdir, 'namespaces', namespace, 'proposals', proposalFileName);
    let proposalContent: string;
    try {
      proposalContent = await readFile(proposalPath, 'utf-8');
    } catch {
      return reply.code(404).send({ error: `Proposal not found: ${proposalFileName}` });
    }
    try {
      let generated;
      if (policyConfig) {
        const policy = resolvePolicy(policyConfig, namespace, 'query');
        const { result } = await executeWithPolicy(policy, () =>
          generateSkillFromProposal(proposalContent, llmGenerateFn),
        );
        generated = result;
      } else {
        generated = await generateSkillFromProposal(proposalContent, llmGenerateFn);
      }
      return reply.send({ generated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: msg });
    }
  });

  // ── AI: per-tab assist ────────────────────────────────────────────────────
  app.post('/skills/:slug/assist', async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    if (!validSlug(reply, slug)) return;
    const { tab, currentContent, instruction } = req.body as {
      tab: string;
      currentContent: unknown;
      instruction: string;
    };
    const validTabs = ['overview', 'sections', 'instructions', 'pricing', 'branding'] as const;
    type Tab = typeof validTabs[number];
    if (!validTabs.includes(tab as Tab)) {
      return reply.code(400).send({ error: `Invalid tab: ${tab}` });
    }
    if (!instruction?.trim()) {
      return reply.code(400).send({ error: 'instruction is required' });
    }
    try {
      const result = await applyTabAssist(tab as Tab, currentContent, instruction, llmGenerateFn);
      return reply.send({ result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: msg });
    }
  });

  // ── Assets: list ──────────────────────────────────────────────────────────
  app.get('/skills/:slug/assets', async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    if (!validSlug(reply, slug)) return;
    const assets = await listAssets(workdir, slug);
    return reply.send({ assets });
  });

  // ── Assets: upload ────────────────────────────────────────────────────────
  app.post('/skills/:slug/assets', async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    if (!validSlug(reply, slug)) return;

    const part = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
    if (!part) return reply.code(400).send({ error: 'No file in request' });

    const fileName = part.filename;
    if (!fileName) return reply.code(400).send({ error: 'File must have a filename' });

    const ext = path.extname(fileName).toLowerCase();
    const allowed = new Set(['.md', '.txt', '.json', '.png', '.svg', '.jpg', '.jpeg']);
    if (!allowed.has(ext)) {
      // Drain the stream to avoid memory leak
      part.file.resume();
      return reply.code(400).send({ error: `File type not allowed: ${ext}` });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of part.file) chunks.push(chunk as Buffer);
    const content = Buffer.concat(chunks);

    try {
      await uploadAsset(workdir, slug, fileName, content);
      return reply.code(201).send({ asset: { fileName, sizeBytes: content.length } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: msg });
    }
  });

  // ── Assets: delete ────────────────────────────────────────────────────────
  app.delete('/skills/:slug/assets/:fileName', async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug, fileName } = req.params as { slug: string; fileName: string };
    if (!validSlug(reply, slug)) return;
    try {
      await deleteAsset(workdir, slug, decodeURIComponent(fileName));
      return reply.send({ deleted: fileName });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(404).send({ error: msg });
    }
  });

  // ── Assets: download ─────────────────────────────────────────────────────
  app.get('/skills/:slug/assets/:fileName', async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug, fileName } = req.params as { slug: string; fileName: string };
    if (!validSlug(reply, slug)) return;
    try {
      const decoded = decodeURIComponent(fileName);
      const content = await readAsset(workdir, slug, decoded);
      const ext = path.extname(decoded).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.md': 'text/markdown',
        '.txt': 'text/plain',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
      };
      reply.header('Content-Type', mimeMap[ext] ?? 'application/octet-stream');
      return reply.send(content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(404).send({ error: msg });
    }
  });

  // ── Versions: list ────────────────────────────────────────────────────────
  app.get('/skills/:slug/versions', async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    if (!validSlug(reply, slug)) return;
    const versions = await listVersions(workdir, slug);
    return reply.send({ versions });
  });

  // ── Versions: create snapshot ─────────────────────────────────────────────
  app.post('/skills/:slug/versions', async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    if (!validSlug(reply, slug)) return;
    try {
      const version = await createVersion(workdir, slug);
      return reply.code(201).send({ version });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(404).send({ error: msg });
    }
  });

  // ── Find best match (used by chat pipeline) ───────────────────────────────
  app.get('/skills/match', async (req: FastifyRequest, reply: FastifyReply) => {
    const { industry, projectType } = req.query as { industry?: string; projectType?: string };
    const match = await findBestMatch(workdir, industry, projectType);
    return reply.send({ match: match ?? null });
  });
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'new-skill';
}
