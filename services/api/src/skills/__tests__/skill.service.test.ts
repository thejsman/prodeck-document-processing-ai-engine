import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
  deleteAsset,
  listVersions,
  createVersion,
} from '../skill.service.js';
import type { CreateSkillInput } from '../skill.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let workdir: string;

function makeInput(overrides: Partial<CreateSkillInput> = {}): CreateSkillInput {
  return {
    slug: 'test-skill',
    displayName: 'Test Skill',
    description: 'A test skill',
    industries: ['Technology'],
    projectTypes: ['SaaS'],
    tags: ['test'],
    toneDescription: 'Professional and clear',
    instructionsMd: '## Identity\nYou are writing a proposal.',
    sections: [],
    micrositeDefaults: {},
    author: 'test',
    version: '1.0',
    scope: 'global',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(async () => {
  workdir = await mkdtemp(path.join(os.tmpdir(), 'skill-test-'));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// createSkill
// ---------------------------------------------------------------------------

describe('createSkill', () => {
  it('writes skill.json, instructions.md, and sections.json', async () => {
    await createSkill(workdir, makeInput());

    const skillJson = path.join(workdir, 'skills', 'test-skill', 'skill.json');
    const instructionsMd = path.join(workdir, 'skills', 'test-skill', 'instructions.md');
    const sectionsJson = path.join(workdir, 'skills', 'test-skill', 'sections.json');

    const skill = JSON.parse(await readFile(skillJson, 'utf-8'));
    const instructions = await readFile(instructionsMd, 'utf-8');
    const sections = JSON.parse(await readFile(sectionsJson, 'utf-8'));

    expect(skill.slug).toBe('test-skill');
    expect(skill.displayName).toBe('Test Skill');
    expect(instructions).toBe('## Identity\nYou are writing a proposal.');
    expect(sections.sections).toEqual([]);
  });

  it('creates assets/ and versions/ subdirectories', async () => {
    await createSkill(workdir, makeInput());

    const assetsDir = path.join(workdir, 'skills', 'test-skill', 'assets');
    const versionsDir = path.join(workdir, 'skills', 'test-skill', 'versions');

    // If dirs exist, readdir should succeed without error
    const { readdir } = await import('node:fs/promises');
    await expect(readdir(assetsDir)).resolves.toBeDefined();
    await expect(readdir(versionsDir)).resolves.toBeDefined();
  });

  it('throws on invalid slug (uppercase)', async () => {
    await expect(createSkill(workdir, makeInput({ slug: 'InvalidSlug' }))).rejects.toThrow(
      'Invalid skill slug',
    );
  });

  it('returns the created Skill with timestamps set', async () => {
    const skill = await createSkill(workdir, makeInput());
    expect(skill.createdAt).toBeTruthy();
    expect(skill.updatedAt).toBeTruthy();
    expect(skill.version).toBe('1.0');
  });
});

// ---------------------------------------------------------------------------
// listSkills
// ---------------------------------------------------------------------------

describe('listSkills', () => {
  it('returns empty array when skills dir does not exist', async () => {
    const result = await listSkills(workdir);
    expect(result).toEqual([]);
  });

  it('returns summaries for created skills', async () => {
    await createSkill(workdir, makeInput({ slug: 'skill-a', displayName: 'Skill A' }));
    await createSkill(workdir, makeInput({ slug: 'skill-b', displayName: 'Skill B' }));

    const result = await listSkills(workdir);

    expect(result).toHaveLength(2);
    const slugs = result.map((s) => s.slug).sort();
    expect(slugs).toEqual(['skill-a', 'skill-b']);
  });

  it('skips corrupt skill directories without throwing', async () => {
    await createSkill(workdir, makeInput({ slug: 'good-skill' }));

    // Write a corrupt skill.json
    const { mkdir, writeFile } = await import('node:fs/promises');
    const badDir = path.join(workdir, 'skills', 'bad-skill');
    await mkdir(badDir, { recursive: true });
    await writeFile(path.join(badDir, 'skill.json'), 'not valid json');

    const result = await listSkills(workdir);
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe('good-skill');
  });
});

// ---------------------------------------------------------------------------
// getSkill
// ---------------------------------------------------------------------------

describe('getSkill', () => {
  it('reads back the created skill', async () => {
    await createSkill(workdir, makeInput({ slug: 'my-skill', displayName: 'My Skill' }));

    const skill = await getSkill(workdir, 'my-skill');
    expect(skill.slug).toBe('my-skill');
    expect(skill.displayName).toBe('My Skill');
    expect(skill.industries).toEqual(['Technology']);
  });

  it('throws on non-existent skill', async () => {
    await expect(getSkill(workdir, 'no-such-skill')).rejects.toThrow('Skill not found');
  });

  it('throws on invalid slug', async () => {
    await expect(getSkill(workdir, 'UPPER_CASE')).rejects.toThrow('Invalid skill slug');
  });
});

// ---------------------------------------------------------------------------
// loadSkill
// ---------------------------------------------------------------------------

describe('loadSkill', () => {
  it('returns skill, instructionsMd, sections, and loadedAssets', async () => {
    const sections = [
      {
        id: 'exec-summary',
        title: 'Executive Summary',
        order: 1,
        required: true,
        promptHint: 'Write a concise executive summary',
        useRagContext: false,
      },
    ];
    await createSkill(
      workdir,
      makeInput({
        slug: 'load-skill',
        instructionsMd: '## Rules\nBe concise.',
        sections,
      }),
    );

    const loaded = await loadSkill(workdir, 'load-skill');
    expect(loaded.skill.slug).toBe('load-skill');
    expect(loaded.instructionsMd).toBe('## Rules\nBe concise.');
    expect(loaded.sections).toHaveLength(1);
    expect(loaded.sections[0].id).toBe('exec-summary');
    expect(loaded.loadedAssets).toEqual({});
  });

  it('loads text assets into loadedAssets', async () => {
    await createSkill(workdir, makeInput({ slug: 'asset-skill' }));
    await uploadAsset(
      workdir,
      'asset-skill',
      'boilerplate.txt',
      Buffer.from('This is boilerplate text'),
    );

    const loaded = await loadSkill(workdir, 'asset-skill');
    expect(loaded.loadedAssets['boilerplate.txt']).toBe('This is boilerplate text');
  });
});

// ---------------------------------------------------------------------------
// updateSkill
// ---------------------------------------------------------------------------

describe('updateSkill', () => {
  it('bumps minor version on update', async () => {
    await createSkill(workdir, makeInput({ slug: 'update-skill', version: '1.0' }));
    const updated = await updateSkill(workdir, 'update-skill', { displayName: 'Updated Name' });

    expect(updated.version).toBe('1.1');
    expect(updated.displayName).toBe('Updated Name');
  });

  it('bumps version again on second update', async () => {
    await createSkill(workdir, makeInput({ slug: 'bump-skill', version: '1.0' }));
    await updateSkill(workdir, 'bump-skill', { displayName: 'Update 1' });
    const updated2 = await updateSkill(workdir, 'bump-skill', { displayName: 'Update 2' });

    expect(updated2.version).toBe('1.2');
  });

  it('preserves original slug even when slug is passed in updates', async () => {
    await createSkill(workdir, makeInput({ slug: 'immutable-slug' }));
    const updated = await updateSkill(workdir, 'immutable-slug', {
      slug: 'attempted-change',
      displayName: 'New Name',
    } as any);

    expect(updated.slug).toBe('immutable-slug');
  });

  it('updates instructionsMd when provided', async () => {
    await createSkill(workdir, makeInput({ slug: 'inst-skill', instructionsMd: 'old' }));
    await updateSkill(workdir, 'inst-skill', { instructionsMd: 'new instructions' });

    const loaded = await loadSkill(workdir, 'inst-skill');
    expect(loaded.instructionsMd).toBe('new instructions');
  });

  it('does not overwrite instructionsMd when not provided', async () => {
    await createSkill(workdir, makeInput({ slug: 'keep-inst', instructionsMd: 'keep me' }));
    await updateSkill(workdir, 'keep-inst', { displayName: 'Changed' });

    const loaded = await loadSkill(workdir, 'keep-inst');
    expect(loaded.instructionsMd).toBe('keep me');
  });

  it('writes a version snapshot after update', async () => {
    await createSkill(workdir, makeInput({ slug: 'version-snap', version: '1.0' }));
    await updateSkill(workdir, 'version-snap', { displayName: 'New Name' });

    const versions = await listVersions(workdir, 'version-snap');
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(versions[0].versionLabel).toBe('1.1');
  });
});

// ---------------------------------------------------------------------------
// deleteSkill
// ---------------------------------------------------------------------------

describe('deleteSkill', () => {
  it('removes the skill directory', async () => {
    await createSkill(workdir, makeInput({ slug: 'delete-me' }));
    await deleteSkill(workdir, 'delete-me');

    await expect(getSkill(workdir, 'delete-me')).rejects.toThrow('Skill not found');
  });

  it('throws on invalid slug', async () => {
    await expect(deleteSkill(workdir, 'INVALID!')).rejects.toThrow('Invalid skill slug');
  });
});

// ---------------------------------------------------------------------------
// findBestMatch
// ---------------------------------------------------------------------------

describe('findBestMatch', () => {
  beforeEach(async () => {
    await createSkill(
      workdir,
      makeInput({
        slug: 'fintech-skill',
        displayName: 'Fintech Skill',
        industries: ['Fintech', 'Banking'],
        projectTypes: ['Platform', 'Mobile App'],
      }),
    );
    await createSkill(
      workdir,
      makeInput({
        slug: 'healthcare-skill',
        displayName: 'Healthcare Skill',
        industries: ['Healthcare'],
        projectTypes: ['SaaS'],
      }),
    );
  });

  it('returns null when no skills exist in empty workdir', async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), 'empty-'));
    try {
      expect(await findBestMatch(empty, 'Fintech')).toBeNull();
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('matches by industry (+2 score)', async () => {
    const result = await findBestMatch(workdir, 'Fintech');
    expect(result?.slug).toBe('fintech-skill');
  });

  it('matches by projectType (+1 score)', async () => {
    const result = await findBestMatch(workdir, undefined, 'SaaS');
    expect(result?.slug).toBe('healthcare-skill');
  });

  it('returns null when no skill scores above 0', async () => {
    const result = await findBestMatch(workdir, 'NonexistentIndustry', 'UnknownProject');
    expect(result).toBeNull();
  });

  it('prefers industry match over projectType match (2 > 1)', async () => {
    // healthcare-skill has SaaS projectType (+1), but fintech-skill has Fintech industry (+2)
    const result = await findBestMatch(workdir, 'Fintech', 'SaaS');
    expect(result?.slug).toBe('fintech-skill');
  });
});

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

describe('listAssets', () => {
  it('returns empty array when no assets uploaded', async () => {
    await createSkill(workdir, makeInput({ slug: 'no-assets' }));
    const assets = await listAssets(workdir, 'no-assets');
    expect(assets).toEqual([]);
  });

  it('lists uploaded assets with size', async () => {
    await createSkill(workdir, makeInput({ slug: 'has-assets' }));
    const content = Buffer.from('Hello world');
    await uploadAsset(workdir, 'has-assets', 'note.txt', content);

    const assets = await listAssets(workdir, 'has-assets');
    expect(assets).toHaveLength(1);
    expect(assets[0].fileName).toBe('note.txt');
    expect(assets[0].sizeBytes).toBe(content.length);
    expect(assets[0].mimeType).toBe('text/plain');
  });

  it('shows referencedBySections when a section uses the asset', async () => {
    await createSkill(
      workdir,
      makeInput({
        slug: 'ref-skill',
        sections: [
          {
            id: 'intro',
            title: 'Intro',
            order: 1,
            required: true,
            promptHint: 'Write intro',
            useRagContext: false,
            assetRef: 'guide.md',
          },
        ],
      }),
    );
    await uploadAsset(workdir, 'ref-skill', 'guide.md', Buffer.from('# Guide'));

    const assets = await listAssets(workdir, 'ref-skill');
    const guide = assets.find((a) => a.fileName === 'guide.md');
    expect(guide?.referencedBySections).toContain('intro');
  });

  it('shows empty referencedBySections for unreferenced assets', async () => {
    await createSkill(workdir, makeInput({ slug: 'unref-skill' }));
    await uploadAsset(workdir, 'unref-skill', 'orphan.txt', Buffer.from('orphan'));

    const assets = await listAssets(workdir, 'unref-skill');
    expect(assets[0].referencedBySections).toEqual([]);
  });
});

describe('uploadAsset', () => {
  it('throws on disallowed extension', async () => {
    await createSkill(workdir, makeInput({ slug: 'ext-guard' }));
    await expect(
      uploadAsset(workdir, 'ext-guard', 'script.sh', Buffer.from('rm -rf /')),
    ).rejects.toThrow('Asset type not allowed');
  });

  it('throws when content exceeds 10 MB', async () => {
    await createSkill(workdir, makeInput({ slug: 'size-guard' }));
    const big = Buffer.alloc(11 * 1024 * 1024);
    await expect(uploadAsset(workdir, 'size-guard', 'big.txt', big)).rejects.toThrow(
      '10 MB',
    );
  });
});

describe('deleteAsset', () => {
  it('removes the asset file', async () => {
    await createSkill(workdir, makeInput({ slug: 'del-asset' }));
    await uploadAsset(workdir, 'del-asset', 'remove-me.txt', Buffer.from('bye'));
    await deleteAsset(workdir, 'del-asset', 'remove-me.txt');

    const assets = await listAssets(workdir, 'del-asset');
    expect(assets).toHaveLength(0);
  });

  it('blocks path traversal via ..', async () => {
    await createSkill(workdir, makeInput({ slug: 'traversal-guard' }));
    await expect(
      deleteAsset(workdir, 'traversal-guard', '../../../etc/passwd'),
    ).rejects.toThrow('Invalid asset filename');
  });
});

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

describe('createVersion + listVersions', () => {
  it('lists empty array when no versions exist', async () => {
    await createSkill(workdir, makeInput({ slug: 'no-versions' }));
    const versions = await listVersions(workdir, 'no-versions');
    expect(versions).toEqual([]);
  });

  it('creates a version snapshot file', async () => {
    await createSkill(workdir, makeInput({ slug: 'snap-skill', version: '1.0' }));
    const v = await createVersion(workdir, 'snap-skill');

    expect(v.versionLabel).toBe('1.0');
    expect(v.slug).toBe('snap-skill');
    expect(v.createdAt).toBeTruthy();
  });

  it('lists created versions sorted by label', async () => {
    await createSkill(workdir, makeInput({ slug: 'list-ver', version: '1.0' }));
    await createVersion(workdir, 'list-ver');
    await updateSkill(workdir, 'list-ver', { displayName: 'Updated' });

    const versions = await listVersions(workdir, 'list-ver');
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions[0].versionLabel).toBe('1.0');
  });
});

// ---------------------------------------------------------------------------
// Slug guard (traversal prevention)
// ---------------------------------------------------------------------------

describe('slug guard', () => {
  it('rejects slugs containing path separators', async () => {
    await expect(getSkill(workdir, 'foo/bar')).rejects.toThrow('Invalid skill slug');
    await expect(getSkill(workdir, '../etc')).rejects.toThrow('Invalid skill slug');
  });

  it('rejects slugs with uppercase letters', async () => {
    await expect(getSkill(workdir, 'MySkill')).rejects.toThrow('Invalid skill slug');
  });

  it('rejects slugs with spaces', async () => {
    await expect(getSkill(workdir, 'my skill')).rejects.toThrow('Invalid skill slug');
  });

  it('accepts valid lowercase kebab slugs', async () => {
    await createSkill(workdir, makeInput({ slug: 'valid-slug-123' }));
    const skill = await getSkill(workdir, 'valid-slug-123');
    expect(skill.slug).toBe('valid-slug-123');
  });
});
