/**
 * Org-level "Inspiration & Global Context" routes.
 *
 * Phase 1 — Author Voice: upload past proposals, extract per-document style
 * profiles in the background, merge into a rolling Author Voice, and expose the
 * apply toggle. Multipart upload mirrors the super-client upload handler.
 */

import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { VoiceStyleProfile } from '@ai-engine/core';
import {
  OrgVoiceStore,
  readOrgContextSettings,
  writeOrgContextSettings,
  type OrgContextSettings,
} from '@ai-engine/runtime';
import { extractProposalStyle } from './style-extractor.js';

type GenerateFn = (prompt: string) => Promise<string>;

const ALLOWED_VOICE_EXT = ['.pdf', '.txt', '.md'];
const MAX_SIZE = 50 * 1024 * 1024;

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
      return reply.code(400).send({ error: 'No valid files provided. Allowed: .pdf, .txt, .md' });
    }

    // Extract sequentially in the background to avoid concurrent read-modify-write
    // races on documents.json / voice.json (same pattern as super-client upload).
    void (async () => {
      for (const f of added) {
        try {
          const style = await extractProposalStyle(svc.uploadFilePath(f.sourceDocument), f.sourceDocument, generate);
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
}
