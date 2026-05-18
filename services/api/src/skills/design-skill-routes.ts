// services/api/src/skills/design-skill-routes.ts
// Fastify REST endpoints for Design Skills.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listDesignSkills,
  getDesignSkill,
  createDesignSkill,
  updateDesignSkill,
  deleteDesignSkill,
} from './design-skill.service.js';
import type { CreateDesignSkillInput, DesignSkill } from './design-skill.types.js';

function validSlug(reply: FastifyReply, slug: string): boolean {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    reply.code(400).send({ error: `Invalid slug: "${slug}"` });
    return false;
  }
  return true;
}

export function registerDesignSkillRoutes(app: FastifyInstance, workdir: string): void {
  // ── List all design skills ─────────────────────────────────────────────────
  app.get('/design-skills', async (_req: FastifyRequest, reply: FastifyReply) => {
    const skills = await listDesignSkills(workdir);
    return reply.send({ skills });
  });

  // ── Get single design skill ────────────────────────────────────────────────
  app.get('/design-skills/:slug', async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    if (!validSlug(reply, slug)) return;
    try {
      const skill = await getDesignSkill(workdir, slug);
      return reply.send({ skill });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return reply.code(404).send({ error: msg });
      throw err;
    }
  });

  // ── Create design skill ────────────────────────────────────────────────────
  app.post('/design-skills', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as CreateDesignSkillInput;
    if (!body.displayName) {
      return reply.code(400).send({ error: 'displayName is required' });
    }
    try {
      const skill = await createDesignSkill(workdir, body);
      return reply.code(201).send({ skill });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: msg });
    }
  });

  // ── Update design skill ────────────────────────────────────────────────────
  app.put('/design-skills/:slug', async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    if (!validSlug(reply, slug)) return;
    const updates = req.body as Partial<Omit<DesignSkill, 'slug' | 'createdAt'>>;
    try {
      const skill = await updateDesignSkill(workdir, slug, updates);
      return reply.send({ skill });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return reply.code(404).send({ error: msg });
      return reply.code(400).send({ error: msg });
    }
  });

  // ── Delete design skill ────────────────────────────────────────────────────
  app.delete('/design-skills/:slug', async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    if (!validSlug(reply, slug)) return;
    try {
      await deleteDesignSkill(workdir, slug);
      return reply.send({ deleted: slug });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return reply.code(404).send({ error: msg });
      throw err;
    }
  });
}
