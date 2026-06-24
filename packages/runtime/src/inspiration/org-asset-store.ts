/**
 * OrgAssetStore — filesystem store for the org-level Design Kit.
 *
 * Mirrors OrgVoiceStore exactly (constructor(workdir), atomic .tmp+rename, shared
 * by API and CLI). The pure projection lives in @ai-engine/core; this adapter owns
 * all I/O, the clock, and base64-loading for referenceFile injection.
 *
 * Layout under {workdir}/org-context/asset-library/:
 *   files/            raw uploaded assets
 *   assets.json       AssetMetadata[] index
 *   design-kit.json   projected DesignKit (includes pre-loaded base64)
 */

import { mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { projectDesignKit, projectDesignKitWithSelection } from '@ai-engine/core';
import type { AssetMetadata, ComputedDesignKit, DesignKit, AssetSelection } from '@ai-engine/core';

export class OrgAssetStore {
  constructor(private readonly workdir: string) {}

  // ── Storage paths ─────────────────────────────────────────────────────────
  private root(): string {
    return path.join(this.workdir, 'org-context', 'asset-library');
  }
  private filesDir(): string {
    return path.join(this.root(), 'files');
  }
  private assetsPath(): string {
    return path.join(this.root(), 'assets.json');
  }
  private designKitPath(): string {
    return path.join(this.root(), 'design-kit.json');
  }
  assetFilePath(fileName: string): string {
    return path.join(this.filesDir(), fileName);
  }

  private async writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
    const tmp = `${filePath}.tmp`;
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmp, filePath);
  }

  // ── Asset index ───────────────────────────────────────────────────────────
  async listAssets(): Promise<AssetMetadata[]> {
    try {
      return JSON.parse(await readFile(this.assetsPath(), 'utf-8')) as AssetMetadata[];
    } catch {
      return [];
    }
  }

  /**
   * Persist an uploaded file and upsert the asset index entry (by filename, so
   * re-uploading the same file replaces the prior version). Returns the entry.
   */
  async addUpload(fileName: string, mediaType: string, buffer: Buffer): Promise<AssetMetadata> {
    await mkdir(this.filesDir(), { recursive: true });
    const destPath = this.assetFilePath(fileName);
    const resolved = path.resolve(destPath);
    if (!resolved.startsWith(path.resolve(this.filesDir()))) {
      throw new Error(`Invalid file name: ${fileName}`);
    }
    await writeFile(destPath, buffer);

    const assets = await this.listAssets();
    const existing = assets.find((a) => a.fileName === fileName);
    const entry: AssetMetadata = {
      id: existing?.id ?? crypto.randomUUID(),
      fileName,
      mediaType,
      size: buffer.length,
      uploadedAt: new Date().toISOString(),
      assetType: existing?.assetType ?? 'other',
      isPrimary: existing?.isPrimary ?? false,
      palette: [],
      fontHints: [],
      tags: [],
      description: '',
      status: 'processing',
    };
    const idx = assets.findIndex((a) => a.id === entry.id);
    if (idx !== -1) assets[idx] = entry;
    else assets.push(entry);
    await this.writeJsonAtomic(this.assetsPath(), assets);
    return entry;
  }

  async updateStatus(id: string, status: AssetMetadata['status'], error?: string): Promise<void> {
    const assets = await this.listAssets();
    const idx = assets.findIndex((a) => a.id === id);
    if (idx === -1) return;
    assets[idx] = { ...assets[idx], status, ...(error ? { error } : { error: undefined }) };
    await this.writeJsonAtomic(this.assetsPath(), assets);
  }

  /** Merge vision tagging results into an asset entry. */
  async saveTagging(
    id: string,
    tagging: Pick<AssetMetadata, 'assetType' | 'palette' | 'fontHints' | 'tags' | 'description'>,
  ): Promise<void> {
    const assets = await this.listAssets();
    const idx = assets.findIndex((a) => a.id === id);
    if (idx === -1) return;
    assets[idx] = { ...assets[idx], ...tagging, status: 'tagged' };
    await this.writeJsonAtomic(this.assetsPath(), assets);
  }

  /** Toggle the isPrimary flag for an asset. */
  async setPrimary(id: string, isPrimary: boolean): Promise<void> {
    const assets = await this.listAssets();
    const idx = assets.findIndex((a) => a.id === id);
    if (idx === -1) return;
    assets[idx] = { ...assets[idx], isPrimary };
    await this.writeJsonAtomic(this.assetsPath(), assets);
  }

  /** Remove an asset: file + index entry, then recompute. */
  async removeAsset(id: string): Promise<DesignKit> {
    const assets = await this.listAssets();
    const entry = assets.find((a) => a.id === id);
    if (entry) await rm(this.assetFilePath(entry.fileName), { force: true });
    await this.writeJsonAtomic(this.assetsPath(), assets.filter((a) => a.id !== id));
    return this.recompute();
  }

  // ── Design kit ────────────────────────────────────────────────────────────
  async getDesignKit(): Promise<DesignKit | null> {
    try {
      return JSON.parse(await readFile(this.designKitPath(), 'utf-8')) as DesignKit;
    } catch {
      return null;
    }
  }

  /**
   * Recompute the design kit from all tagged assets. Pre-loads base64 for logo
   * and hero assets so the injection layer doesn't need extra fs reads.
   */
  async recompute(): Promise<DesignKit> {
    const assets = await this.listAssets();
    const computed: ComputedDesignKit = projectDesignKit(assets);

    let logoBase64: string | undefined;
    let logoMediaType: string | undefined;
    let heroBase64: string | undefined;
    let heroMediaType: string | undefined;

    if (computed.logoAssetId) {
      const logo = assets.find((a) => a.id === computed.logoAssetId);
      if (logo) {
        try {
          const buf = await readFile(this.assetFilePath(logo.fileName));
          logoBase64 = buf.toString('base64');
          logoMediaType = logo.mediaType;
        } catch { /* file missing — skip */ }
      }
    }

    if (computed.heroAssetId) {
      const hero = assets.find((a) => a.id === computed.heroAssetId);
      if (hero) {
        try {
          const buf = await readFile(this.assetFilePath(hero.fileName));
          heroBase64 = buf.toString('base64');
          heroMediaType = hero.mediaType;
        } catch { /* file missing — skip */ }
      }
    }

    // dominantColors: top 2+ HEX from palette for the referenceFile fast path
    const dominantColors = computed.palette.slice(0, 4);

    const kit: DesignKit = {
      ...computed,
      ...(logoBase64 ? { logoBase64, logoMediaType } : {}),
      ...(heroBase64 ? { heroBase64, heroMediaType } : {}),
      dominantColors,
      updatedAt: new Date().toISOString(),
    };
    await this.writeJsonAtomic(this.designKitPath(), kit);
    return kit;
  }

  /**
   * Compute a DesignKit for a specific request context without persisting it.
   * Used when LLM-ranked selection overrides the stored logo/hero choice.
   */
  async computeKitForContext(selection: AssetSelection): Promise<DesignKit> {
    const assets = await this.listAssets();
    const computed: ComputedDesignKit = projectDesignKitWithSelection(assets, selection);

    let logoBase64: string | undefined;
    let logoMediaType: string | undefined;
    let heroBase64: string | undefined;
    let heroMediaType: string | undefined;

    if (computed.logoAssetId) {
      const logo = assets.find((a) => a.id === computed.logoAssetId);
      if (logo) {
        try {
          const buf = await readFile(this.assetFilePath(logo.fileName));
          logoBase64 = buf.toString('base64');
          logoMediaType = logo.mediaType;
        } catch { /* file missing — skip */ }
      }
    }

    if (computed.heroAssetId) {
      const hero = assets.find((a) => a.id === computed.heroAssetId);
      if (hero) {
        try {
          const buf = await readFile(this.assetFilePath(hero.fileName));
          heroBase64 = buf.toString('base64');
          heroMediaType = hero.mediaType;
        } catch { /* file missing — skip */ }
      }
    }

    return {
      ...computed,
      ...(logoBase64 ? { logoBase64, logoMediaType } : {}),
      ...(heroBase64 ? { heroBase64, heroMediaType } : {}),
      dominantColors: computed.palette.slice(0, 4),
      updatedAt: new Date().toISOString(),
    };
  }
}
