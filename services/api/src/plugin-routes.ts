/**
 * Presenter plugin discovery routes.
 *
 * GET /plugins              — list all registered presenter plugins (id, name, description)
 * GET /plugins/:id          — full plugin detail (manifest, tokens, fonts)
 * GET /plugins/:id/tokens   — resolved tokens, optionally overriding accent with ?brandColor=#hex
 */

import type { FastifyInstance } from 'fastify';
import type { PresenterPluginRegistry } from '@ai-engine/runtime';

export function registerPluginRoutes(
  app: FastifyInstance,
  registry: PresenterPluginRegistry,
): void {
  // ── GET /plugins ─────────────────────────────────────────────────────────
  app.get('/plugins', async (_req, reply) => {
    const plugins = registry.getAll().map((p) => ({
      id: p.manifest.name,
      manifest: p.manifest,
      tokens: p.tokens,
      fonts: p.fonts,
    }));
    return reply.send({ plugins });
  });

  // ── GET /plugins/:id ──────────────────────────────────────────────────────
  app.get('/plugins/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const plugin = registry.get(id);
    if (!plugin) {
      return reply.status(404).send({ error: `Plugin "${id}" not found` });
    }
    return reply.send({
      id: plugin.manifest.name,
      manifest: plugin.manifest,
      tokens: plugin.tokens,
      fonts: plugin.fonts,
    });
  });

  // ── GET /plugins/:id/tokens ───────────────────────────────────────────────
  app.get('/plugins/:id/tokens', async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { brandColor?: string };

    const plugin = registry.get(id);
    if (!plugin) {
      return reply.status(404).send({ error: `Plugin "${id}" not found` });
    }

    let tokens = { ...plugin.tokens };

    // Apply brand color override if provided
    if (query.brandColor && /^#[0-9A-Fa-f]{3,6}$/.test(query.brandColor)) {
      tokens = { ...tokens, accent: query.brandColor };
    }

    return reply.send({ tokens });
  });
}
