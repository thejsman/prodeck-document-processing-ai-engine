/**
 * Proposal metadata sidecar (.meta.json) logic.
 *
 * Each proposal markdown file can have an accompanying .meta.json that tracks:
 *   - workflow status (draft → under_review → approved → finalized)
 *   - locked sections (protected from regeneration)
 *
 * Pure functions (diffSections, mergeLockedSections, validateTransition) are
 * separated from I/O (readMeta, writeMeta, ensureMeta) for testability.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProposalStatus =
  | 'draft'
  | 'under_review'
  | 'approved'
  | 'finalized';

export interface ProposalMeta {
  status: ProposalStatus;
  lockedSections: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SectionDiff {
  title: string;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
  oldContent?: string;
  newContent?: string;
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  draft: ['under_review', 'approved'],
  under_review: ['approved', 'draft'],
  approved: ['finalized', 'under_review'],
  finalized: [],
};

export function validateTransition(
  from: ProposalStatus,
  to: ProposalStatus,
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function metaPathFor(mdPath: string): string {
  return mdPath.replace(/\.md$/, '.meta.json');
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

export async function readMeta(mdPath: string): Promise<ProposalMeta | null> {
  try {
    const raw = await readFile(metaPathFor(mdPath), 'utf-8');
    return JSON.parse(raw) as ProposalMeta;
  } catch {
    return null;
  }
}

export async function writeMeta(
  mdPath: string,
  meta: ProposalMeta,
): Promise<void> {
  meta.updatedAt = new Date().toISOString();
  const metaPath = metaPathFor(mdPath);
  await mkdir(path.dirname(metaPath), { recursive: true });
  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

export async function ensureMeta(mdPath: string): Promise<ProposalMeta> {
  const existing = await readMeta(mdPath);
  if (existing) return existing;

  const meta: ProposalMeta = {
    status: 'draft',
    lockedSections: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeMeta(mdPath, meta);
  return meta;
}

// ---------------------------------------------------------------------------
// Section parsing (shared with UI via same algorithm)
// ---------------------------------------------------------------------------

interface ParsedSection {
  title: string;
  content: string;
}

function parseSections(content: string): {
  header: string;
  sections: ParsedSection[];
} {
  const lines = content.split('\n');
  let header = '';
  const sections: ParsedSection[] = [];
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentTitle !== null) {
        sections.push({
          title: currentTitle,
          content: currentLines.join('\n').trim(),
        });
      } else {
        header = currentLines.join('\n').trim();
      }
      currentTitle = line.slice(3).trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentTitle !== null) {
    sections.push({
      title: currentTitle,
      content: currentLines.join('\n').trim(),
    });
  } else {
    header = currentLines.join('\n').trim();
  }

  return { header, sections };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export function diffSections(
  oldContent: string,
  newContent: string,
): SectionDiff[] {
  const oldParsed = parseSections(oldContent);
  const newParsed = parseSections(newContent);

  const oldMap = new Map(oldParsed.sections.map((s) => [s.title, s.content]));
  const newMap = new Map(newParsed.sections.map((s) => [s.title, s.content]));

  const allTitles = new Set([...oldMap.keys(), ...newMap.keys()]);
  const diffs: SectionDiff[] = [];

  for (const title of allTitles) {
    const oldText = oldMap.get(title);
    const newText = newMap.get(title);

    if (oldText === undefined && newText !== undefined) {
      diffs.push({ title, status: 'added', newContent: newText });
    } else if (oldText !== undefined && newText === undefined) {
      diffs.push({ title, status: 'removed', oldContent: oldText });
    } else if (oldText !== newText) {
      diffs.push({
        title,
        status: 'changed',
        oldContent: oldText,
        newContent: newText,
      });
    } else {
      diffs.push({ title, status: 'unchanged' });
    }
  }

  return diffs;
}

// ---------------------------------------------------------------------------
// Merge locked sections
// ---------------------------------------------------------------------------

export function mergeLockedSections(
  oldContent: string,
  newContent: string,
  locked: string[],
): string {
  if (locked.length === 0) return newContent;

  const lockedSet = new Set(locked);
  const oldParsed = parseSections(oldContent);
  const newParsed = parseSections(newContent);

  const oldMap = new Map(oldParsed.sections.map((s) => [s.title, s.content]));

  const mergedSections = newParsed.sections.map((section) => {
    if (lockedSet.has(section.title) && oldMap.has(section.title)) {
      return { ...section, content: oldMap.get(section.title)! };
    }
    return section;
  });

  // Reassemble
  let result = newParsed.header ? newParsed.header + '\n\n' : '';
  for (const section of mergedSections) {
    result += `## ${section.title}\n\n${section.content}\n\n`;
  }
  return result.trimEnd() + '\n';
}
