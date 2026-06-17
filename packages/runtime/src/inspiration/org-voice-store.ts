/**
 * OrgVoiceStore — filesystem store for the org-level Author Voice.
 *
 * The fs/side-effect boundary (CLAUDE.md §4: runtime owns I/O). Mirrors the
 * ClientMemoryService shape (constructor(workdir), private path helpers, atomic
 * .tmp + rename writes). Shared by the API and the CLI. The pure merge/render
 * lives in @ai-engine/core; this adapter owns all I/O and the clock/version.
 *
 * Layout under {workdir}/org-context/author-voice/:
 *   uploads/            raw uploaded past proposals
 *   documents.json      upload index (VoiceDocEntry[]) incl. processing/failed
 *   profiles/<id>.json  one extracted VoiceStyleProfile per successful doc
 *   voice.json          the merged, rolling AuthorVoice
 */

import { mkdir, writeFile, readFile, rename, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { mergeVoiceProfiles, renderVoicePromptBlock } from '@ai-engine/core';
import type { AuthorVoice, VoiceStyleProfile } from '@ai-engine/core';

export interface VoiceDocEntry {
  id: string;
  sourceDocument: string;
  size: number;
  uploadedAt: string;
  status: 'processing' | 'extracted' | 'failed';
  error?: string;
}

export class OrgVoiceStore {
  constructor(private readonly workdir: string) {}

  // ── Storage paths ─────────────────────────────────────────────────────────
  private root(): string {
    return path.join(this.workdir, 'org-context', 'author-voice');
  }
  private uploadsDir(): string {
    return path.join(this.root(), 'uploads');
  }
  private documentsPath(): string {
    return path.join(this.root(), 'documents.json');
  }
  private profilesDir(): string {
    return path.join(this.root(), 'profiles');
  }
  private profilePath(id: string): string {
    return path.join(this.profilesDir(), `${id}.json`);
  }
  private voicePath(): string {
    return path.join(this.root(), 'voice.json');
  }

  private async writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
    const tmp = `${filePath}.tmp`;
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmp, filePath);
  }

  // ── Document index ────────────────────────────────────────────────────────
  async listDocuments(): Promise<VoiceDocEntry[]> {
    try {
      const raw = await readFile(this.documentsPath(), 'utf-8');
      return JSON.parse(raw) as VoiceDocEntry[];
    } catch {
      return [];
    }
  }

  /**
   * Persist an uploaded file and upsert its index entry (by source filename, so
   * re-uploading the same name replaces the prior version). Returns the entry.
   */
  async addUpload(sourceDocument: string, buffer: Buffer): Promise<VoiceDocEntry> {
    await mkdir(this.uploadsDir(), { recursive: true });
    const destPath = path.join(this.uploadsDir(), sourceDocument);
    const resolved = path.resolve(destPath);
    if (!resolved.startsWith(path.resolve(this.uploadsDir()))) {
      throw new Error(`Invalid file name: ${sourceDocument}`);
    }
    await writeFile(destPath, buffer);

    const docs = await this.listDocuments();
    const existing = docs.find((d) => d.sourceDocument === sourceDocument);
    const entry: VoiceDocEntry = {
      id: existing?.id ?? crypto.randomUUID(),
      sourceDocument,
      size: buffer.length,
      uploadedAt: new Date().toISOString(),
      status: 'processing',
    };
    const idx = docs.findIndex((d) => d.id === entry.id);
    if (idx !== -1) docs[idx] = entry;
    else docs.push(entry);
    await this.writeJsonAtomic(this.documentsPath(), docs);
    return entry;
  }

  async updateStatus(id: string, status: VoiceDocEntry['status'], error?: string): Promise<void> {
    const docs = await this.listDocuments();
    const idx = docs.findIndex((d) => d.id === id);
    if (idx === -1) return;
    docs[idx] = { ...docs[idx], status, ...(error ? { error } : { error: undefined }) };
    await this.writeJsonAtomic(this.documentsPath(), docs);
  }

  uploadFilePath(sourceDocument: string): string {
    return path.join(this.uploadsDir(), sourceDocument);
  }

  /** Remove a document: its upload file, profile, index entry, then recompute. */
  async removeDocument(id: string): Promise<AuthorVoice> {
    const docs = await this.listDocuments();
    const entry = docs.find((d) => d.id === id);
    if (entry) {
      await rm(path.join(this.uploadsDir(), entry.sourceDocument), { force: true });
    }
    await rm(this.profilePath(id), { force: true });
    await this.writeJsonAtomic(this.documentsPath(), docs.filter((d) => d.id !== id));
    return this.recompute();
  }

  // ── Profiles ──────────────────────────────────────────────────────────────
  async saveProfile(profile: VoiceStyleProfile): Promise<void> {
    await this.writeJsonAtomic(this.profilePath(profile.id), profile);
  }

  async listProfiles(): Promise<VoiceStyleProfile[]> {
    try {
      const files = await readdir(this.profilesDir());
      const profiles = await Promise.all(
        files
          .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
          .map(async (f) => {
            try {
              return JSON.parse(
                await readFile(path.join(this.profilesDir(), f), 'utf-8'),
              ) as VoiceStyleProfile;
            } catch {
              return null;
            }
          }),
      );
      return profiles.filter((p): p is VoiceStyleProfile => p !== null);
    } catch {
      return [];
    }
  }

  // ── Merged voice ──────────────────────────────────────────────────────────
  async getVoice(): Promise<AuthorVoice | null> {
    try {
      const raw = await readFile(this.voicePath(), 'utf-8');
      return JSON.parse(raw) as AuthorVoice;
    } catch {
      return null;
    }
  }

  /** Recompute the merged voice from cached profiles (no LLM calls). */
  async recompute(): Promise<AuthorVoice> {
    const profiles = await this.listProfiles();
    const computed = mergeVoiceProfiles(profiles);
    const prev = await this.getVoice();
    const voice: AuthorVoice = {
      ...computed,
      version: (prev?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.writeJsonAtomic(this.voicePath(), voice);
    return voice;
  }

  /** Render the merged voice as a prompt block, or null when empty. */
  async getRendered(): Promise<string | null> {
    const voice = await this.getVoice();
    if (!voice) return null;
    const block = renderVoicePromptBlock(voice);
    return block || null;
  }
}
