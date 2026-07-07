// services/api/src/skills/skill.service.ts
// Skill CRUD, loading, matching, versioning — pure async functions, disk I/O only.

import {
  readFile,
  writeFile,
  mkdir,
  rm,
  readdir,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import type {
  Skill,
  SkillSummary,
  LoadedSkill,
  SectionDefinition,
  AssetInfo,
  SkillVersion,
  CreateSkillInput,
} from './skill.types.js';
import { SkillSchema, SkillSectionsSchema } from './skill.validator.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function skillsDir(workdir: string): string {
  return path.join(workdir, 'skills');
}

function skillDir(workdir: string, slug: string): string {
  return path.join(skillsDir(workdir), slug);
}

function skillJsonPath(workdir: string, slug: string): string {
  return path.join(skillDir(workdir, slug), 'skill.json');
}

function instructionsPath(workdir: string, slug: string): string {
  return path.join(skillDir(workdir, slug), 'instructions.md');
}

function sectionsPath(workdir: string, slug: string): string {
  return path.join(skillDir(workdir, slug), 'sections.json');
}

function assetsDir(workdir: string, slug: string): string {
  return path.join(skillDir(workdir, slug), 'assets');
}

function versionsDir(workdir: string, slug: string): string {
  return path.join(skillDir(workdir, slug), 'versions');
}

function guardSlug(slug: string): void {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Invalid skill slug: "${slug}"`);
  }
}

function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  return map[ext] ?? 'application/octet-stream';
}

function bumpMinorVersion(version: string): string {
  const [major, minor] = version.split('.').map(Number);
  return `${major ?? 1}.${(minor ?? 0) + 1}`;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listSkills(
  workdir: string,
  opts?: { type?: 'proposal' | 'document' },
): Promise<SkillSummary[]> {
  const dir = skillsDir(workdir);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const summaries: SkillSummary[] = [];
  for (const entry of entries) {
    try {
      const raw = await readFile(path.join(dir, entry, 'skill.json'), 'utf-8');
      const parsed = SkillSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) continue;
      const s = parsed.data;
      const effectiveType = s.type ?? 'proposal';
      if (opts?.type && effectiveType !== opts.type) continue;
      summaries.push({
        slug: s.slug,
        displayName: s.displayName,
        description: s.description,
        industries: s.industries,
        version: s.version,
        updatedAt: s.updatedAt,
        type: effectiveType,
        triggers: s.triggers,
        outputFormats: s.outputFormats,
      });
    } catch {
      // skip invalid/corrupt entries
    }
  }
  return summaries;
}

export async function getSkill(workdir: string, slug: string): Promise<Skill> {
  guardSlug(slug);
  let raw: string;
  try {
    raw = await readFile(skillJsonPath(workdir, slug), 'utf-8');
  } catch {
    throw new Error(`Skill not found: ${slug}`);
  }
  const parsed = SkillSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`Skill "${slug}" failed validation: ${parsed.error.message}`);
  }
  return parsed.data as Skill;
}

export async function loadSkill(workdir: string, slug: string): Promise<LoadedSkill> {
  guardSlug(slug);
  const skill = await getSkill(workdir, slug);

  const [instructionsMd, sectionsRaw] = await Promise.all([
    readFile(instructionsPath(workdir, slug), 'utf-8').catch(() => ''),
    readFile(sectionsPath(workdir, slug), 'utf-8').catch(() => '{"sections":[]}'),
  ]);

  let sections: SectionDefinition[] = [];
  try {
    const parsed = SkillSectionsSchema.safeParse(JSON.parse(sectionsRaw));
    if (parsed.success) sections = parsed.data.sections as SectionDefinition[];
  } catch {
    // default to empty
  }

  const loadedAssets: Record<string, string> = {};
  const aDir = assetsDir(workdir, slug);
  try {
    const assetFiles = await readdir(aDir);
    await Promise.all(
      assetFiles.map(async (f) => {
        const ext = path.extname(f).toLowerCase();
        if (['.md', '.txt', '.json'].includes(ext)) {
          try {
            loadedAssets[f] = await readFile(path.join(aDir, f), 'utf-8');
          } catch {
            // skip unreadable
          }
        }
      }),
    );
  } catch {
    // no assets dir yet
  }

  return { skill, instructionsMd, sections, loadedAssets };
}

export async function createSkill(workdir: string, input: CreateSkillInput): Promise<Skill> {
  guardSlug(input.slug);

  const now = new Date().toISOString();
  const skill: Skill = {
    slug: input.slug,
    displayName: input.displayName,
    description: input.description,
    industries: input.industries,
    projectTypes: input.projectTypes,
    tags: input.tags,
    toneDescription: input.toneDescription,
    micrositeDefaults: input.micrositeDefaults ?? {},
    pricingDefaults: input.pricingDefaults,
    defaultTemplate: input.defaultTemplate,
    author: input.author,
    version: input.version ?? '1.0',
    scope: input.scope ?? 'global',
    namespace: input.namespace,
    createdAt: now,
    updatedAt: now,
    type: input.type,
    structureMode: input.structureMode,
    triggers: input.triggers,
    outputFormats: input.outputFormats,
    clarifyingQuestions: input.clarifyingQuestions,
  };

  const validated = SkillSchema.safeParse(skill);
  if (!validated.success) {
    throw new Error(`Invalid skill data: ${validated.error.message}`);
  }

  const sDir = skillDir(workdir, input.slug);
  await mkdir(path.join(sDir, 'assets'), { recursive: true });
  await mkdir(path.join(sDir, 'versions'), { recursive: true });

  await Promise.all([
    writeFile(skillJsonPath(workdir, input.slug), JSON.stringify(validated.data, null, 2)),
    writeFile(instructionsPath(workdir, input.slug), input.instructionsMd ?? ''),
    writeFile(
      sectionsPath(workdir, input.slug),
      JSON.stringify({ sections: input.sections ?? [] }, null, 2),
    ),
  ]);

  return validated.data as Skill;
}

export async function updateSkill(
  workdir: string,
  slug: string,
  updates: Partial<Skill> & { instructionsMd?: string; sections?: SectionDefinition[] },
): Promise<Skill> {
  guardSlug(slug);
  const existing = await getSkill(workdir, slug);

  const { instructionsMd, sections, ...skillUpdates } = updates;
  const now = new Date().toISOString();
  const merged: Skill = {
    ...existing,
    ...skillUpdates,
    slug: existing.slug, // slug is immutable
    version: bumpMinorVersion(existing.version),
    updatedAt: now,
  };

  const validated = SkillSchema.safeParse(merged);
  if (!validated.success) {
    throw new Error(`Invalid skill update: ${validated.error.message}`);
  }

  const writes: Promise<void>[] = [
    writeFile(skillJsonPath(workdir, slug), JSON.stringify(validated.data, null, 2)),
  ];
  if (instructionsMd !== undefined) {
    writes.push(writeFile(instructionsPath(workdir, slug), instructionsMd));
  }
  if (sections !== undefined) {
    writes.push(
      writeFile(sectionsPath(workdir, slug), JSON.stringify({ sections }, null, 2)),
    );
  }

  await Promise.all(writes);

  // Auto-snapshot after save
  await createVersion(workdir, slug).catch(() => undefined);

  return validated.data as Skill;
}

export async function deleteSkill(workdir: string, slug: string): Promise<void> {
  guardSlug(slug);
  const sDir = skillDir(workdir, slug);
  try {
    await rm(sDir, { recursive: true, force: true });
  } catch {
    throw new Error(`Skill not found: ${slug}`);
  }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export async function findBestMatch(
  workdir: string,
  clientIndustry?: string,
  projectType?: string,
): Promise<Skill | null> {
  const skills = await listSkills(workdir);
  if (skills.length === 0) return null;

  const norm = (s: string) => s.toLowerCase().trim();
  const indNorm = clientIndustry ? norm(clientIndustry) : null;
  const ptNorm = projectType ? norm(projectType) : null;

  let bestSlug: string | null = null;
  let bestScore = 0;

  for (const summary of skills) {
    let score = 0;
    if (ptNorm) {
      // projectType is the primary match — load full skill for projectTypes check
      try {
        const full = await getSkill(workdir, summary.slug);
        const ptMatch = full.projectTypes.some(
          (p) => norm(p).includes(ptNorm) || ptNorm.includes(norm(p)),
        );
        if (ptMatch) score += 2;
      } catch {
        // skip
      }
    }
    if (indNorm) {
      const match = summary.industries.some((i) => norm(i).includes(indNorm) || indNorm.includes(norm(i)));
      if (match) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestSlug = summary.slug;
    }
  }

  if (bestSlug && bestScore > 0) {
    return getSkill(workdir, bestSlug);
  }
  return null;
}

export async function findBestDocumentSkill(
  workdir: string,
  userMessage: string,
): Promise<Skill | null> {
  const documentSkills = await listSkills(workdir, { type: 'document' });
  if (documentSkills.length === 0) return null;

  const msgLower = userMessage.toLowerCase();
  let bestSlug: string | null = null;
  let bestScore = 0;

  for (const summary of documentSkills) {
    if (!summary.triggers?.length) continue;
    let score = 0;
    for (const trigger of summary.triggers) {
      if (msgLower.includes(trigger.toLowerCase())) {
        // longer triggers are more specific — weight them higher
        score += trigger.split(' ').length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestSlug = summary.slug;
    }
  }

  if (bestSlug && bestScore > 0) {
    return getSkill(workdir, bestSlug);
  }
  return null;
}

/**
 * Compose a prompt block that lets the slide generator apply a matched document
 * skill's narrative expertise (instructions.md) and recommended slide arc
 * (sections.json). Pure — no I/O. Returns '' when there is nothing worth
 * injecting. The block is content/narrative only: the requested slide count and
 * the caller's hardcoded HTML/visual rules stay authoritative.
 */
export function formatSkillForSlides(
  skill: Skill,
  instructionsMd: string,
  sections: SectionDefinition[],
): string {
  const instructions = instructionsMd.trim();
  const orderedSections = [...sections].sort((a, b) => a.order - b.order);
  if (!instructions && orderedSections.length === 0) return '';

  const parts: string[] = [`\n## Slide Content Expertise: ${skill.displayName}`];
  if (instructions) parts.push(instructions);

  if (orderedSections.length > 0) {
    const arc = orderedSections
      .map((s, i) => {
        const hint = s.promptHint?.trim() ? ` — ${s.promptHint.trim().slice(0, 160)}` : '';
        return `${i + 1}. ${s.title}${s.required ? ' (required)' : ''}${hint}`;
      })
      .join('\n');
    const lead = skill.structureMode === 'strict'
      ? "Follow this slide structure. The user's requested slide count still governs — if fewer slides are requested, merge or drop the least critical, but keep the required ones."
      : "Recommended narrative arc — adapt to the requested slide count, which takes precedence. If fewer slides are requested, prioritise the most important sections and merge related points; do not pad to match this list.";
    parts.push(`\n### Slide narrative arc\n${lead}\n${arc}`);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

const ALLOWED_ASSET_EXTS = new Set(['.md', '.txt', '.json', '.png', '.svg', '.jpg', '.jpeg']);
const MAX_ASSET_SIZE = 10 * 1024 * 1024; // 10 MB

function sanitizeFileName(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function guardAssetName(fileName: string): void {
  if (fileName.includes('..') || path.isAbsolute(fileName)) {
    throw new Error(`Invalid asset filename: "${fileName}"`);
  }
}

export async function listAssets(workdir: string, slug: string): Promise<AssetInfo[]> {
  guardSlug(slug);
  const aDir = assetsDir(workdir, slug);
  let files: string[];
  try {
    files = await readdir(aDir);
  } catch {
    return [];
  }

  // Load sections to determine which assets are referenced
  let sections: SectionDefinition[] = [];
  try {
    const raw = await readFile(sectionsPath(workdir, slug), 'utf-8');
    const parsed = SkillSectionsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) sections = parsed.data.sections as SectionDefinition[];
  } catch {
    // ok
  }

  const assets: AssetInfo[] = [];
  for (const f of files) {
    try {
      const info = await stat(path.join(aDir, f));
      const ext = path.extname(f).toLowerCase();
      const referencedBySections = sections
        .filter((s) => s.assetRef === f)
        .map((s) => s.id);
      assets.push({
        fileName: f,
        sizeBytes: info.size,
        mimeType: mimeFromExt(ext),
        referencedBySections,
      });
    } catch {
      // skip
    }
  }
  return assets;
}

export async function uploadAsset(
  workdir: string,
  slug: string,
  fileName: string,
  content: Buffer,
): Promise<void> {
  guardSlug(slug);
  const safe = sanitizeFileName(fileName);
  const ext = path.extname(safe).toLowerCase();
  if (!ALLOWED_ASSET_EXTS.has(ext)) {
    throw new Error(`Asset type not allowed: ${ext}`);
  }
  if (content.length > MAX_ASSET_SIZE) {
    throw new Error(`Asset exceeds 10 MB limit`);
  }
  const aDir = assetsDir(workdir, slug);
  await mkdir(aDir, { recursive: true });
  await writeFile(path.join(aDir, safe), content);
}

export async function readAsset(workdir: string, slug: string, fileName: string): Promise<Buffer> {
  guardSlug(slug);
  guardAssetName(fileName);
  const assetPath = path.join(assetsDir(workdir, slug), fileName);
  return readFile(assetPath);
}

export async function deleteAsset(workdir: string, slug: string, fileName: string): Promise<void> {
  guardSlug(slug);
  guardAssetName(fileName);
  await unlink(path.join(assetsDir(workdir, slug), fileName));
}

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

export async function createVersion(workdir: string, slug: string): Promise<SkillVersion> {
  guardSlug(slug);
  const skill = await getSkill(workdir, slug);

  let sections: SectionDefinition[] = [];
  try {
    const raw = await readFile(sectionsPath(workdir, slug), 'utf-8');
    const parsed = SkillSectionsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) sections = parsed.data.sections as SectionDefinition[];
  } catch {
    // ok
  }

  const vDir = versionsDir(workdir, slug);
  await mkdir(vDir, { recursive: true });

  const now = new Date().toISOString();
  const snapshot = { skill, sections, snapshotAt: now };
  await writeFile(
    path.join(vDir, `${skill.version}.json`),
    JSON.stringify(snapshot, null, 2),
  );

  return { versionLabel: skill.version, slug, createdAt: now };
}

export async function listVersions(workdir: string, slug: string): Promise<SkillVersion[]> {
  guardSlug(slug);
  const vDir = versionsDir(workdir, slug);
  let files: string[];
  try {
    files = await readdir(vDir);
  } catch {
    return [];
  }

  const versions: SkillVersion[] = [];
  for (const f of files.filter((f) => f.endsWith('.json'))) {
    try {
      const raw = await readFile(path.join(vDir, f), 'utf-8');
      const data = JSON.parse(raw) as { skill: { version: string }; snapshotAt: string };
      versions.push({
        versionLabel: data.skill?.version ?? f.replace('.json', ''),
        slug,
        createdAt: data.snapshotAt ?? '',
      });
    } catch {
      // skip
    }
  }

  return versions.sort((a, b) => a.versionLabel.localeCompare(b.versionLabel));
}
