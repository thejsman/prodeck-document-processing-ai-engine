/**
 * Org-level "Inspiration & Global Context" routes.
 *
 * Phase 1 — Author Voice: upload past proposals, extract per-document style
 * profiles in the background, merge into a rolling Author Voice, and expose the
 * apply toggle. Multipart upload mirrors the super-client upload handler.
 */

import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceStyleProfile } from '@ai-engine/core';
import {
  OrgVoiceStore,
  OrgAssetStore,
  readOrgContextSettings,
  writeOrgContextSettings,
  type OrgContextSettings,
} from '@ai-engine/runtime';
import { extractProposalStyle, extractProposalStyleFromImage } from './style-extractor.js';
import { tagDesignAsset } from './asset-tagger.js';

type GenerateFn = (prompt: string) => Promise<string>;

const ALLOWED_VOICE_EXT = ['.pdf', '.txt', '.md', '.docx', '.png', '.jpg', '.jpeg', '.webp'];
const VOICE_IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
const MAX_SIZE = 50 * 1024 * 1024;

const ALLOWED_ASSET_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};
const MAX_ASSET_SIZE = 20 * 1024 * 1024;

export function registerOrgContextRoutes(
  app: FastifyInstance,
  workdir: string,
  generate: GenerateFn,
): void {
  const voice = (): OrgVoiceStore => new OrgVoiceStore(workdir);

  // POST /org-context/voice/documents/upload — multipart .pdf/.txt/.md
  app.post('/org-context/voice/documents/upload', async (req: FastifyRequest, reply: FastifyReply) => {
    const svc = voice();
    const parts = req.parts();
    const added: Array<{ id: string; sourceDocument: string; uploadedAt: string }> = [];

    for await (const part of parts) {
      if (part.type !== 'file') continue;
      const rawName = part.filename ?? 'unnamed';
      const ext = path.extname(rawName).toLowerCase();
      if (!ALLOWED_VOICE_EXT.includes(ext)) {
        await part.toBuffer();
        continue;
      }
      const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const buffer = await part.toBuffer();
      if (buffer.length > MAX_SIZE) {
        return reply.code(400).send({ error: `File "${rawName}" exceeds the 50 MB limit` });
      }
      const entry = await svc.addUpload(safeName, buffer);
      added.push({ id: entry.id, sourceDocument: entry.sourceDocument, uploadedAt: entry.uploadedAt });
    }

    if (added.length === 0) {
      return reply.code(400).send({ error: 'No valid files provided. Allowed: .pdf, .txt, .md, .docx, .png, .jpg, .webp' });
    }

    // Extract sequentially in the background to avoid concurrent read-modify-write
    // races on documents.json / voice.json (same pattern as super-client upload).
    void (async () => {
      for (const f of added) {
        try {
          const ext = path.extname(f.sourceDocument).toLowerCase();
          const imageMime = VOICE_IMAGE_MIME[ext];
          const style = imageMime
            ? await extractProposalStyleFromImage(svc.uploadFilePath(f.sourceDocument), imageMime)
            : await extractProposalStyle(svc.uploadFilePath(f.sourceDocument), f.sourceDocument, generate);
          const profile: VoiceStyleProfile = {
            id: f.id,
            sourceDocument: f.sourceDocument,
            uploadedAt: f.uploadedAt,
            extractedAt: new Date().toISOString(),
            ...style,
          };
          await svc.saveProfile(profile);
          await svc.updateStatus(f.id, 'extracted');
          await svc.recompute();
        } catch (err) {
          app.log.warn({ err }, `[OrgVoice] Style extraction failed for ${f.sourceDocument}`);
          await svc.updateStatus(f.id, 'failed', (err as Error).message);
        }
      }
    })();

    return reply.code(201).send({ documents: added });
  });

  // GET /org-context/voice/documents — upload index (incl. processing/failed)
  app.get('/org-context/voice/documents', async () => ({
    documents: await voice().listDocuments(),
  }));

  // GET /org-context/voice — the merged Author Voice (or null)
  app.get('/org-context/voice', async () => ({
    voice: await voice().getVoice(),
  }));

  // POST /org-context/voice/regenerate — recompute from cached profiles
  app.post('/org-context/voice/regenerate', async () => ({
    voice: await voice().recompute(),
  }));

  // DELETE /org-context/voice/documents/:id — remove a doc + profile, recompute
  app.delete('/org-context/voice/documents/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const updated = await voice().removeDocument(id);
    return reply.send({ voice: updated });
  });

  // GET /org-context/settings — apply toggles
  app.get('/org-context/settings', async () => ({
    settings: await readOrgContextSettings(workdir),
  }));

  // PUT /org-context/settings — update apply toggles
  app.put('/org-context/settings', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as Partial<OrgContextSettings>;
    const patch: Partial<OrgContextSettings> = {};
    if (typeof body.applyAuthorVoice === 'boolean') patch.applyAuthorVoice = body.applyAuthorVoice;
    if (typeof body.applyDesignKit === 'boolean') patch.applyDesignKit = body.applyDesignKit;
    const settings = await writeOrgContextSettings(workdir, patch);
    return reply.send({ settings });
  });

  // ── Phase 2: Design Kit ─────────────────────────────────────────────────

  const assets = (): OrgAssetStore => new OrgAssetStore(workdir);

  // POST /org-context/assets/upload — multipart image upload (.png/.jpg/.webp/.gif/.svg)
  app.post('/org-context/assets/upload', async (req: FastifyRequest, reply: FastifyReply) => {
    const svc = assets();
    const parts = req.parts();
    const added: Array<{ id: string; fileName: string; uploadedAt: string }> = [];

    for await (const part of parts) {
      if (part.type !== 'file') continue;
      const rawName = part.filename ?? 'unnamed';
      const ext = path.extname(rawName).toLowerCase();
      const mediaType = ALLOWED_ASSET_MIME[ext];
      if (!mediaType) {
        await part.toBuffer();
        continue;
      }
      const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const buffer = await part.toBuffer();
      if (buffer.length > MAX_ASSET_SIZE) {
        return reply.code(400).send({ error: `File "${rawName}" exceeds the 20 MB limit` });
      }
      const entry = await svc.addUpload(safeName, mediaType, buffer);
      added.push({ id: entry.id, fileName: entry.fileName, uploadedAt: entry.uploadedAt });
    }

    if (added.length === 0) {
      return reply.code(400).send({ error: 'No valid image files provided. Allowed: .png, .jpg, .webp, .gif, .svg' });
    }

    // Background sequential vision tagging — avoids concurrent read-modify-write on assets.json
    void (async () => {
      for (const f of added) {
        const assetList = await svc.listAssets();
        const entry = assetList.find((a) => a.id === f.id);
        if (!entry) continue;
        try {
          const tagging = await tagDesignAsset(svc.assetFilePath(f.fileName), entry.mediaType);
          await svc.saveTagging(f.id, tagging);
          await svc.recompute();
        } catch (err) {
          app.log.warn({ err }, `[OrgAssets] Vision tagging failed for ${f.fileName}`);
          await svc.updateStatus(f.id, 'failed', (err as Error).message);
        }
      }
    })();

    return reply.code(201).send({ assets: added });
  });

  // GET /org-context/assets — list all assets (incl. processing/failed)
  app.get('/org-context/assets', async () => ({
    assets: await assets().listAssets(),
  }));

  // PATCH /org-context/assets/:id — update isPrimary flag
  app.patch('/org-context/assets/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { isPrimary?: boolean };
    if (typeof body.isPrimary === 'boolean') {
      await assets().setPrimary(id, body.isPrimary);
      await assets().recompute();
    }
    return reply.send({ assets: await assets().listAssets() });
  });

  // DELETE /org-context/assets/:id — remove asset + recompute
  app.delete('/org-context/assets/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const kit = await assets().removeAsset(id);
    return reply.send({ designKit: kit });
  });

  // GET /org-context/design-kit — current projected design kit
  app.get('/org-context/design-kit', async () => ({
    designKit: await assets().getDesignKit(),
  }));

  // POST /org-context/design-kit/regenerate — recompute from tagged assets
  app.post('/org-context/design-kit/regenerate', async () => ({
    designKit: await assets().recompute(),
  }));

  // GET /org-context/assets/files/:fileName — serve raw asset file
  app.get('/org-context/assets/files/:fileName', async (req: FastifyRequest, reply: FastifyReply) => {
    const { fileName } = req.params as { fileName: string };
    const safeName = path.basename(fileName);
    const filePath = new OrgAssetStore(workdir).assetFilePath(safeName);
    try {
      const s = await stat(filePath);
      if (!s.isFile()) return reply.code(404).send({ error: 'Not found' });
      const ext = path.extname(safeName).toLowerCase();
      const mime = ALLOWED_ASSET_MIME[ext] ?? 'application/octet-stream';
      return reply.header('Content-Type', mime).send(createReadStream(filePath));
    } catch {
      return reply.code(404).send({ error: 'Not found' });
    }
  });
}
