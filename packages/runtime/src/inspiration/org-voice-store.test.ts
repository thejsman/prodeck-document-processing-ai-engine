import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { OrgVoiceStore } from './org-voice-store.js';
import type { VoiceStyleProfile } from '@ai-engine/core';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), `org-voice-test-${Date.now()}-${Math.floor(performance.now())}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function styleProfile(
  id: string,
  uploadedAt: string,
  overrides: Partial<VoiceStyleProfile> = {},
): VoiceStyleProfile {
  return {
    id,
    sourceDocument: `${id}.md`,
    uploadedAt,
    extractedAt: uploadedAt,
    tone: ['confident'],
    formality: 'formal',
    sectionPatterns: ['Executive Summary', 'Pricing'],
    openingStyle: 'leads with a value statement',
    closingStyle: 'ends with a call to action',
    recurringPhrases: ['we partner with you'],
    vocabulary: ['scalable'],
    persuasionPatterns: ['roi-led'],
    formatting: ['short paragraphs'],
    ...overrides,
  };
}

describe('OrgVoiceStore', () => {
  it('returns no voice and empty docs initially', async () => {
    const svc = new OrgVoiceStore(tmpDir);
    expect(await svc.getVoice()).toBeNull();
    expect(await svc.listDocuments()).toEqual([]);
    expect(await svc.getRendered()).toBeNull();
  });

  it('upserts an upload by filename (re-upload replaces, keeps id)', async () => {
    const svc = new OrgVoiceStore(tmpDir);
    const a = await svc.addUpload('deck.md', Buffer.from('v1'));
    const b = await svc.addUpload('deck.md', Buffer.from('v2 longer'));
    expect(b.id).toBe(a.id);
    const docs = await svc.listDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0].status).toBe('processing');
    expect(docs[0].size).toBe('v2 longer'.length);
  });

  it('recomputes a merged voice from saved profiles and renders a block', async () => {
    const svc = new OrgVoiceStore(tmpDir);
    await svc.saveProfile(styleProfile('old', '2026-01-01T00:00:00.000Z', { recurringPhrases: ['legacy'] }));
    await svc.saveProfile(styleProfile('new', '2026-06-01T00:00:00.000Z', { recurringPhrases: ['fresh'] }));

    const voice = await svc.recompute();
    expect(voice.docCount).toBe(2);
    expect(voice.version).toBe(1);
    expect(voice.sourceProfileIds).toEqual(['new', 'old']);
    expect(voice.recurringPhrases[0].value).toBe('fresh');

    const reread = await svc.getVoice();
    expect(reread?.docCount).toBe(2);

    const rendered = await svc.getRendered();
    expect(rendered).toContain('## Organization Author Voice');
    expect(rendered).toContain('"fresh"');

    const voice2 = await svc.recompute();
    expect(voice2.version).toBe(2);
  });

  it('removeDocument deletes the profile and recomputes', async () => {
    const svc = new OrgVoiceStore(tmpDir);
    const a = await svc.addUpload('a.md', Buffer.from('x'));
    await svc.saveProfile(styleProfile(a.id, a.uploadedAt));
    await svc.recompute();
    expect((await svc.getVoice())?.docCount).toBe(1);

    const after = await svc.removeDocument(a.id);
    expect(after.docCount).toBe(0);
    expect(await svc.listDocuments()).toEqual([]);
    expect(await svc.getRendered()).toBeNull();
  });
});
