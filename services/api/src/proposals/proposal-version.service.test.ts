import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createInitialVersion,
  createVersionFromEdit,
  listVersions,
  rollbackToVersion,
  readVersionContent,
  findLatestArtifact,
} from './proposal-version.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let workdir: string;
const NS = 'test-ns';
const ARTIFACT = 'chat-draft-1000.md';

async function setupArtifact(content: string): Promise<void> {
  const proposalsDir = path.join(workdir, 'namespaces', NS, 'proposals');
  await mkdir(proposalsDir, { recursive: true });
  await writeFile(path.join(proposalsDir, ARTIFACT), content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(async () => {
  workdir = await mkdtemp(path.join(os.tmpdir(), 'version-test-'));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createInitialVersion', () => {
  it('creates v1.0 from existing artifact', async () => {
    await setupArtifact('# Hello World');

    const version = await createInitialVersion(workdir, NS, ARTIFACT);

    expect(version.versionLabel).toBe('v1.0');
    expect(version.parentVersionId).toBeNull();
    expect(version.artifactId).toBe(ARTIFACT);
    expect(version.createdBy).toBe('system');
    expect(version.summary).toBe('Initial version');
  });

  it('is idempotent — returns existing version on second call', async () => {
    await setupArtifact('# Original');

    const v1 = await createInitialVersion(workdir, NS, ARTIFACT);
    const v2 = await createInitialVersion(workdir, NS, ARTIFACT);

    expect(v1.id).toBe(v2.id);
    expect(v1.versionLabel).toBe('v1.0');
  });

  it('persists snapshot content that matches the artifact', async () => {
    const content = '# My Proposal\n\nSome content here.';
    await setupArtifact(content);

    const version = await createInitialVersion(workdir, NS, ARTIFACT);
    const snapshot = await readVersionContent(workdir, NS, ARTIFACT, version.id);

    expect(snapshot).toBe(content);
  });
});

describe('createVersionFromEdit', () => {
  it('creates v1.1 after initial version', async () => {
    await setupArtifact('# v1 content');
    await createInitialVersion(workdir, NS, ARTIFACT);

    const v2 = await createVersionFromEdit(
      workdir, NS, ARTIFACT,
      '# v2 content',
      null,
      'user',
      'Updated intro',
    );

    expect(v2.versionLabel).toBe('v1.1');
    expect(v2.parentVersionId).not.toBeNull();
    expect(v2.createdBy).toBe('user');
    expect(v2.summary).toBe('Updated intro');
  });

  it('auto-bootstraps initial version if none exists', async () => {
    await setupArtifact('# Original');

    const v = await createVersionFromEdit(
      workdir, NS, ARTIFACT,
      '# Edited',
      null,
      'user',
    );

    // Should be v1.1 (v1.0 was auto-created, then v1.1 for the edit)
    expect(v.versionLabel).toBe('v1.1');

    const { versions } = await listVersions(workdir, NS, ARTIFACT);
    expect(versions).toHaveLength(2);
    expect(versions[0].versionLabel).toBe('v1.0');
    expect(versions[1].versionLabel).toBe('v1.1');
  });

  it('increments version labels correctly through multiple edits', async () => {
    await setupArtifact('# v1');
    await createInitialVersion(workdir, NS, ARTIFACT);

    await createVersionFromEdit(workdir, NS, ARTIFACT, '# v1.1', null);
    await createVersionFromEdit(workdir, NS, ARTIFACT, '# v1.2', null);
    const v4 = await createVersionFromEdit(workdir, NS, ARTIFACT, '# v1.3', null);

    expect(v4.versionLabel).toBe('v1.3');

    const { versions } = await listVersions(workdir, NS, ARTIFACT);
    expect(versions).toHaveLength(4);
  });

  it('stores snapshot content independently from the artifact', async () => {
    await setupArtifact('# Original');
    await createInitialVersion(workdir, NS, ARTIFACT);

    const editContent = '# Completely different content';
    const v = await createVersionFromEdit(workdir, NS, ARTIFACT, editContent, null);

    const snapshot = await readVersionContent(workdir, NS, ARTIFACT, v.id);
    expect(snapshot).toBe(editContent);

    // Original v1.0 snapshot should still be intact
    const { versions } = await listVersions(workdir, NS, ARTIFACT);
    const v1Content = await readVersionContent(workdir, NS, ARTIFACT, versions[0].id);
    expect(v1Content).toBe('# Original');
  });
});

describe('listVersions', () => {
  it('returns empty array for artifact with no versions', async () => {
    const { versions, currentVersionId } = await listVersions(workdir, NS, 'nonexistent.md');
    expect(versions).toEqual([]);
    expect(currentVersionId).toBeNull();
  });

  it('returns versions in creation order with correct current pointer', async () => {
    await setupArtifact('# First');
    await createInitialVersion(workdir, NS, ARTIFACT);
    const v2 = await createVersionFromEdit(workdir, NS, ARTIFACT, '# Second', null);

    const { versions, currentVersionId } = await listVersions(workdir, NS, ARTIFACT);

    expect(versions).toHaveLength(2);
    expect(versions[0].versionLabel).toBe('v1.0');
    expect(versions[1].versionLabel).toBe('v1.1');
    expect(currentVersionId).toBe(v2.id);
  });
});

describe('rollbackToVersion', () => {
  it('creates a new version with content from the target version', async () => {
    const originalContent = '# Original proposal content';
    await setupArtifact(originalContent);
    const v1 = await createInitialVersion(workdir, NS, ARTIFACT);

    await createVersionFromEdit(workdir, NS, ARTIFACT, '# Edited content', null);

    const rollback = await rollbackToVersion(workdir, NS, ARTIFACT, v1.id);

    expect(rollback.versionLabel).toBe('v1.2');
    expect(rollback.parentVersionId).toBe(v1.id);
    expect(rollback.summary).toBe('Rollback to v1.0');
  });

  it('overwrites the artifact file with rolled-back content', async () => {
    const originalContent = '# Original';
    await setupArtifact(originalContent);
    const v1 = await createInitialVersion(workdir, NS, ARTIFACT);
    await createVersionFromEdit(workdir, NS, ARTIFACT, '# Changed', null);

    await rollbackToVersion(workdir, NS, ARTIFACT, v1.id);

    const artifactContent = await readFile(
      path.join(workdir, 'namespaces', NS, 'proposals', ARTIFACT),
      'utf-8',
    );
    expect(artifactContent).toBe(originalContent);
  });

  it('preserves full history after rollback (non-destructive)', async () => {
    await setupArtifact('# v1');
    const v1 = await createInitialVersion(workdir, NS, ARTIFACT);
    await createVersionFromEdit(workdir, NS, ARTIFACT, '# v1.1', null);

    await rollbackToVersion(workdir, NS, ARTIFACT, v1.id);

    const { versions } = await listVersions(workdir, NS, ARTIFACT);
    expect(versions).toHaveLength(3); // v1.0, v1.1, v1.2 (rollback)
  });

  it('throws on unknown version ID', async () => {
    await setupArtifact('# Content');
    await createInitialVersion(workdir, NS, ARTIFACT);

    await expect(
      rollbackToVersion(workdir, NS, ARTIFACT, 'nonexistent-id'),
    ).rejects.toThrow('not found');
  });

  it('throws when no version history exists', async () => {
    await expect(
      rollbackToVersion(workdir, NS, 'no-versions.md', 'some-id'),
    ).rejects.toThrow('No version history');
  });
});

describe('findLatestArtifact', () => {
  it('returns null when no proposals exist', async () => {
    const result = await findLatestArtifact(workdir, NS);
    expect(result).toBeNull();
  });

  it('returns the most recent artifact by filename', async () => {
    const proposalsDir = path.join(workdir, 'namespaces', NS, 'proposals');
    await mkdir(proposalsDir, { recursive: true });
    await writeFile(path.join(proposalsDir, 'chat-draft-1000.md'), '', 'utf-8');
    await writeFile(path.join(proposalsDir, 'chat-draft-2000.md'), '', 'utf-8');
    await writeFile(path.join(proposalsDir, 'chat-draft-1500.md'), '', 'utf-8');

    const result = await findLatestArtifact(workdir, NS);
    expect(result).toBe('chat-draft-2000.md');
  });

  it('ignores hidden files', async () => {
    const proposalsDir = path.join(workdir, 'namespaces', NS, 'proposals');
    await mkdir(proposalsDir, { recursive: true });
    await writeFile(path.join(proposalsDir, 'chat-draft-1000.md'), '', 'utf-8');
    await mkdir(path.join(proposalsDir, '.versions'), { recursive: true });

    const result = await findLatestArtifact(workdir, NS);
    expect(result).toBe('chat-draft-1000.md');
  });
});
