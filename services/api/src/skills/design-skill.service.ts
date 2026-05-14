// services/api/src/skills/design-skill.service.ts
// Design Skill CRUD — disk-based, mirrors skill.service.ts pattern.

import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  DesignSkill,
  DesignSkillSummary,
  CreateDesignSkillInput,
} from './design-skill.types.js';
import { AESTHETIC_TONES } from './design-skill.types.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function designSkillsDir(workdir: string): string {
  return path.join(workdir, 'design-skills');
}

function designSkillDir(workdir: string, slug: string): string {
  return path.join(designSkillsDir(workdir), slug);
}

function designSkillJsonPath(workdir: string, slug: string): string {
  return path.join(designSkillDir(workdir, slug), 'design-skill.json');
}

function guardSlug(slug: string): void {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Invalid design skill slug: "${slug}"`);
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'new-design-skill';
}

function defaultSkill(input: CreateDesignSkillInput): DesignSkill {
  const now = new Date().toISOString();
  const slug = input.slug ?? slugify(input.displayName);
  return {
    slug,
    displayName: input.displayName,
    description: input.description ?? '',
    aestheticTone: input.aestheticTone ?? 'editorial/magazine',
    colorPalette: {
      primary: input.colorPalette?.primary ?? '#3b82f6',
      secondary: input.colorPalette?.secondary,
      background: input.colorPalette?.background,
    },
    typography: {
      headingFont: input.typography?.headingFont ?? 'Syne',
      bodyFont: input.typography?.bodyFont ?? 'DM Sans',
      headingStyle: input.typography?.headingStyle ?? 'bold',
    },
    animations: input.animations ?? 'minimal',
    customInstructions: input.customInstructions ?? '',
    themeClass: input.themeClass ?? 'light',
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listDesignSkills(workdir: string): Promise<DesignSkillSummary[]> {
  const dir = designSkillsDir(workdir);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const summaries: DesignSkillSummary[] = [];
  for (const entry of entries) {
    try {
      const raw = await readFile(path.join(dir, entry, 'design-skill.json'), 'utf-8');
      const s = JSON.parse(raw) as DesignSkill;
      if (!s.slug || !s.displayName) continue;
      summaries.push({
        slug: s.slug,
        displayName: s.displayName,
        description: s.description ?? '',
        aestheticTone: s.aestheticTone,
        themeClass: s.themeClass,
        colorPalette: s.colorPalette,
        updatedAt: s.updatedAt,
      });
    } catch {
      // skip invalid/corrupt entries
    }
  }
  return summaries;
}

export async function getDesignSkill(workdir: string, slug: string): Promise<DesignSkill> {
  guardSlug(slug);
  let raw: string;
  try {
    raw = await readFile(designSkillJsonPath(workdir, slug), 'utf-8');
  } catch {
    throw new Error(`Design skill not found: ${slug}`);
  }
  return JSON.parse(raw) as DesignSkill;
}

export async function createDesignSkill(workdir: string, input: CreateDesignSkillInput): Promise<DesignSkill> {
  const skill = defaultSkill(input);
  guardSlug(skill.slug);

  const dir = designSkillDir(workdir, skill.slug);
  await mkdir(dir, { recursive: true });
  await writeFile(designSkillJsonPath(workdir, skill.slug), JSON.stringify(skill, null, 2), 'utf-8');
  return skill;
}

export async function updateDesignSkill(
  workdir: string,
  slug: string,
  updates: Partial<Omit<DesignSkill, 'slug' | 'createdAt'>>,
): Promise<DesignSkill> {
  guardSlug(slug);
  const existing = await getDesignSkill(workdir, slug);

  if (updates.aestheticTone && !(AESTHETIC_TONES as readonly string[]).includes(updates.aestheticTone)) {
    throw new Error(`Invalid aesthetic tone: ${updates.aestheticTone}`);
  }

  const updated: DesignSkill = {
    ...existing,
    ...updates,
    colorPalette: { ...existing.colorPalette, ...updates.colorPalette },
    typography: { ...existing.typography, ...updates.typography },
    slug,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(designSkillJsonPath(workdir, slug), JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

export async function deleteDesignSkill(workdir: string, slug: string): Promise<void> {
  guardSlug(slug);
  try {
    await rm(designSkillDir(workdir, slug), { recursive: true, force: true });
  } catch {
    throw new Error(`Design skill not found: ${slug}`);
  }
}
