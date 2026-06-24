import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { OrgAssetStore } from './org-asset-store.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), `org-asset-test-${Date.now()}-${Math.floor(performance.now())}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('OrgAssetStore', () => {
  it('returns empty list and null kit initially', async () => {
    const store = new OrgAssetStore(tmpDir);
    expect(await store.listAssets()).toEqual([]);
    expect(await store.getDesignKit()).toBeNull();
  });

  it('upserts an upload by filename (re-upload keeps same id)', async () => {
    const store = new OrgAssetStore(tmpDir);
    const a = await store.addUpload('logo.png', 'image/png', Buffer.from('v1'));
    const b = await store.addUpload('logo.png', 'image/png', Buffer.from('v2-longer'));
    expect(b.id).toBe(a.id);
    const assets = await store.listAssets();
    expect(assets).toHaveLength(1);
    expect(assets[0].status).toBe('processing');
    expect(assets[0].size).toBe('v2-longer'.length);
  });

  it('saveTagging sets status to tagged and persists tagging data', async () => {
    const store = new OrgAssetStore(tmpDir);
    const asset = await store.addUpload('brand.png', 'image/png', Buffer.from('img'));
    await store.saveTagging(asset.id, {
      assetType: 'logo',
      palette: ['#1A2B3C', '#FFFFFF'],
      fontHints: ['sans-serif'],
      tags: ['corporate'],
      description: 'Company logo',
    });
    const assets = await store.listAssets();
    expect(assets[0].status).toBe('tagged');
    expect(assets[0].assetType).toBe('logo');
    expect(assets[0].palette).toEqual(['#1A2B3C', '#FFFFFF']);
    expect(assets[0].fontHints).toEqual(['sans-serif']);
  });

  it('recompute produces a valid design kit from tagged assets', async () => {
    const store = new OrgAssetStore(tmpDir);
    const asset = await store.addUpload('logo.png', 'image/png', Buffer.from('fake-img'));
    await store.saveTagging(asset.id, {
      assetType: 'logo',
      palette: ['#112233'],
      fontHints: ['geometric'],
      tags: ['minimal'],
      description: 'Logo',
    });

    const kit = await store.recompute();
    expect(kit.primaryColor).toBe('#112233');
    expect(kit.palette).toContain('#112233');
    expect(kit.logoAssetId).toBe(asset.id);
    expect(kit.updatedAt).toBeTruthy();
    // base64 is pre-loaded for the logo
    expect(kit.logoBase64).toBeTruthy();
    expect(kit.logoMediaType).toBe('image/png');

    // persisted to disk
    const reread = await store.getDesignKit();
    expect(reread?.primaryColor).toBe('#112233');
  });

  it('removeAsset deletes the entry and recomputes', async () => {
    const store = new OrgAssetStore(tmpDir);
    const asset = await store.addUpload('hero.jpg', 'image/jpeg', Buffer.from('hero-data'));
    await store.saveTagging(asset.id, {
      assetType: 'hero',
      palette: ['#AABBCC'],
      fontHints: [],
      tags: [],
      description: '',
    });
    await store.recompute();

    const kitAfterRemove = await store.removeAsset(asset.id);
    expect(kitAfterRemove.heroAssetId).toBeNull();
    expect(kitAfterRemove.primaryColor).toBeNull();
    expect(await store.listAssets()).toHaveLength(0);
  });

  it('setPrimary toggles the primary flag', async () => {
    const store = new OrgAssetStore(tmpDir);
    const a = await store.addUpload('a.png', 'image/png', Buffer.from('a'));
    const b = await store.addUpload('b.png', 'image/png', Buffer.from('b'));
    await store.setPrimary(a.id, true);
    const assets = await store.listAssets();
    const aEntry = assets.find((x) => x.id === a.id)!;
    const bEntry = assets.find((x) => x.id === b.id)!;
    expect(aEntry.isPrimary).toBe(true);
    expect(bEntry.isPrimary).toBe(false);
  });

  it('rejects path-traversal filenames', async () => {
    const store = new OrgAssetStore(tmpDir);
    await expect(
      store.addUpload('../../../etc/passwd', 'image/png', Buffer.from('x')),
    ).rejects.toThrow('Invalid file name');
  });
});
