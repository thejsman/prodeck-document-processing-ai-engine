/**
 * Proposal QA — cross-section contradiction detection and auto-fix.
 *
 * Flow:
 *   1. Extract structured facts (timeline, pricing, teamSize, claims) from each section.
 *   2. Build a global fact map: field → [{ value, section }].
 *   3. Detect contradictions: same field, different values across sections.
 *   4. Surface conflicts to the user as a structured message.
 *   5. If user confirms fix: apply the canonical value (from confirmedRequirements
 *      or highest-frequency value) to every conflicting section via text substitution.
 *
 * Integration points:
 *   - After handleGeneratingSections completes (pre-DONE signal)
 *   - After major section edits (handleResolveAction edit path)
 *   - Before final export (future)
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { llmGenerateFn } from '../agent-routes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SectionFact {
  /** The normalised fact value (e.g. "6 weeks", "$12,000"). */
  value: string;
  /** The section this fact was extracted from. */
  section: string;
}

export interface FactMap {
  timeline: SectionFact[];
  pricing: SectionFact[];
  teamSize: SectionFact[];
}

export type FactField = keyof FactMap;

export interface Contradiction {
  field: FactField;
  /** All unique values found, with which sections they appear in. */
  occurrences: SectionFact[];
  /** The canonical value to use when auto-fixing. */
  canonical: string;
  severity: 'high';
}

export interface QAResult {
  contradictions: Contradiction[];
  /** True when no contradictions were found. */
  clean: boolean;
}

// ---------------------------------------------------------------------------
// STEP 1 — Extract facts from a single section via LLM
// ---------------------------------------------------------------------------

interface RawSectionFacts {
  timeline?: string | null;
  pricing?: string | null;
  teamSize?: string | null;
}

async function extractFactsFromSection(
  sectionName: string,
  content: string,
): Promise<RawSectionFacts> {
  const prompt = [
    `Extract structured facts from the "${sectionName}" section of a proposal.`,
    '',
    'Return JSON with:',
    '- timeline: the timeline/duration value if explicitly stated (e.g. "6 weeks"), or null',
    '- pricing: the price/budget/cost value if explicitly stated (e.g. "$12,000"), or null',
    '- teamSize: the team size if explicitly stated (e.g. "5 engineers"), or null',
    '',
    'Rules:',
    '- Only include values explicitly stated — do NOT infer or calculate',
    '- If a field is not mentioned, return null for it',
    '- Output ONLY raw JSON — no markdown fences, no commentary',
    '',
    `Section content:\n${content.slice(0, 2000)}`,
  ].join('\n');

  try {
    const raw = await llmGenerateFn(prompt);
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      timeline: typeof parsed.timeline === 'string' ? parsed.timeline.trim() : null,
      pricing:  typeof parsed.pricing  === 'string' ? parsed.pricing.trim()  : null,
      teamSize: typeof parsed.teamSize === 'string' ? parsed.teamSize.trim() : null,
    };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// STEP 2 — Build global fact map across all sections
// ---------------------------------------------------------------------------

export async function buildFactMap(
  sections: Array<{ name: string; content: string }>,
): Promise<FactMap> {
  const factMap: FactMap = { timeline: [], pricing: [], teamSize: [] };

  await Promise.all(
    sections.map(async ({ name, content }) => {
      const facts = await extractFactsFromSection(name, content);
      for (const field of ['timeline', 'pricing', 'teamSize'] as FactField[]) {
        const val = facts[field];
        if (val) {
          factMap[field].push({ value: val, section: name });
        }
      }
    }),
  );

  return factMap;
}

// ---------------------------------------------------------------------------
// STEP 3 — Detect contradictions
// ---------------------------------------------------------------------------

/**
 * Normalise a fact value for comparison.
 * Strips whitespace and lowercases; does not attempt unit conversion.
 */
function normalise(v: string): string {
  return v.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Pick the canonical value for a contradicting field.
 * Priority: confirmedRequirements → highest-frequency value.
 */
function pickCanonical(
  occurrences: SectionFact[],
  confirmedValue?: string,
): string {
  if (confirmedValue) return confirmedValue;

  // Frequency count (normalised)
  const freq = new Map<string, { count: number; original: string }>();
  for (const { value } of occurrences) {
    const key = normalise(value);
    const entry = freq.get(key);
    if (entry) {
      entry.count++;
    } else {
      freq.set(key, { count: 1, original: value });
    }
  }

  let best = occurrences[0].value;
  let bestCount = 0;
  for (const { count, original } of freq.values()) {
    if (count > bestCount) {
      bestCount = count;
      best = original;
    }
  }
  return best;
}

export function detectContradictions(
  factMap: FactMap,
  confirmedRequirements?: Record<string, string>,
): Contradiction[] {
  const contradictions: Contradiction[] = [];

  for (const field of ['timeline', 'pricing', 'teamSize'] as FactField[]) {
    const occurrences = factMap[field];
    if (occurrences.length < 2) continue;

    const uniqueNormalised = new Set(occurrences.map((o) => normalise(o.value)));
    if (uniqueNormalised.size <= 1) continue;

    const confirmedValue =
      field === 'timeline' ? confirmedRequirements?.timeline :
      field === 'pricing'  ? confirmedRequirements?.budget   :
      undefined;

    contradictions.push({
      field,
      occurrences,
      canonical: pickCanonical(occurrences, confirmedValue),
      severity: 'high',
    });
  }

  return contradictions;
}

// ---------------------------------------------------------------------------
// STEP 4 — Chat output builder
// ---------------------------------------------------------------------------

export function buildQAMessage(contradictions: Contradiction[]): string {
  if (contradictions.length === 0) return '';

  const FIELD_LABEL: Record<FactField, string> = {
    timeline: 'Timeline',
    pricing:  'Cost',
    teamSize: 'Team size',
  };

  const lines = [
    'I found a few inconsistencies:',
    '',
  ];

  for (const { field, occurrences } of contradictions) {
    lines.push(`• **${FIELD_LABEL[field]}** differs:`);
    for (const { section, value } of occurrences) {
      lines.push(`  - ${section}: ${value}`);
    }
    lines.push('');
  }

  lines.push('Should I fix these to keep everything aligned?');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// STEP 5 — Auto-fix: apply canonical value to proposal markdown on disk
// ---------------------------------------------------------------------------

/**
 * Apply canonical values to the proposal file.
 * For each contradiction, replaces every occurrence of conflicting values
 * with the canonical value in the raw markdown.
 */
export async function applyQAFixes(
  proposalPath: string,
  contradictions: Contradiction[],
): Promise<void> {
  let content = await readFile(proposalPath, 'utf-8');

  for (const { occurrences, canonical } of contradictions) {
    const valuesToReplace = [
      ...new Set(
        occurrences
          .map((o) => o.value)
          .filter((v) => normalise(v) !== normalise(canonical)),
      ),
    ];

    for (const old of valuesToReplace) {
      // Replace all case-insensitive occurrences
      content = content.split(old).join(canonical);
    }
  }

  await writeFile(proposalPath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Utility — parse sections from proposal markdown
// ---------------------------------------------------------------------------

/**
 * Split a proposal markdown string into sections by `## Heading` boundaries.
 */
export function parseSectionsFromMarkdown(
  markdown: string,
): Array<{ name: string; content: string }> {
  const sectionRegex = /^## (.+)$/gm;
  const sections: Array<{ name: string; content: string }> = [];
  let lastIndex = 0;
  let lastName = '';

  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(markdown)) !== null) {
    if (lastName) {
      sections.push({
        name: lastName,
        content: markdown.slice(lastIndex, match.index).trim(),
      });
    }
    lastName = match[1].trim();
    lastIndex = match.index + match[0].length;
  }

  if (lastName) {
    sections.push({ name: lastName, content: markdown.slice(lastIndex).trim() });
  }

  return sections;
}
