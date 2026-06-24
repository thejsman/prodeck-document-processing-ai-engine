/**
 * Pure, deterministic merge of per-document style profiles into a single
 * rolling Author Voice, plus a compact prompt-injection renderer.
 *
 * PURE: no fs/net/env/clock/randomness. Given the same input array, the output
 * is byte-for-byte identical. Recency is derived solely from each profile's
 * `uploadedAt`, so the merge can be recomputed at any time from cached profiles.
 */

import type {
  AuthorVoice,
  ComputedAuthorVoice,
  VoiceFormality,
  VoiceStyleProfile,
  WeightedItem,
} from './voice-types.js';

const DEFAULT_FORMALITY: VoiceFormality = 'neutral';

/** Round to 3 decimals so serialized weights are stable across runs. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Recency weight by rank in a newest→oldest ordering.
 * Newest (rank 0) = multiplier, oldest (rank N-1) = 1.0, smooth in between.
 * Single profile → multiplier. Default multiplier = 2.0.
 */
export function recencyWeight(rank: number, total: number, multiplier = 2.0): number {
  const base = Math.max(1.0, multiplier);
  if (total <= 1) return base;
  return base ** (1 - rank / (total - 1));
}

/** Sort profiles newest→oldest; ties broken by id for determinism. */
function sortNewestFirst(profiles: VoiceStyleProfile[]): VoiceStyleProfile[] {
  return [...profiles].sort((a, b) => {
    if (a.uploadedAt !== b.uploadedAt) {
      return a.uploadedAt < b.uploadedAt ? 1 : -1; // larger ISO (newer) first
    }
    return a.id.localeCompare(b.id);
  });
}

interface WeightedProfileList {
  items: string[];
  weight: number;
}

/**
 * Weighted-frequency tally over a list field. Each item is counted at most once
 * per document (so repetition within one proposal can't dominate). Returns
 * items ranked by summed weight, then alphabetically for determinism.
 */
function tallyList(lists: WeightedProfileList[]): WeightedItem[] {
  const map = new Map<string, WeightedItem>();
  for (const { items, weight } of lists) {
    const seen = new Set<string>();
    for (const raw of items ?? []) {
      const value = raw.trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = map.get(key);
      if (existing) existing.weight += weight;
      else map.set(key, { value, weight });
    }
  }
  return [...map.values()]
    .map((it) => ({ value: it.value, weight: round3(it.weight) }))
    .sort((a, b) => b.weight - a.weight || a.value.localeCompare(b.value));
}

/** Weighted vote for a scalar field; recency-biased (newest weighs most). */
function weightedMode(
  votes: Array<{ value: string; weight: number }>,
): string {
  const map = new Map<string, WeightedItem>();
  for (const { value, weight } of votes) {
    const v = (value ?? '').trim();
    if (!v) continue;
    const key = v.toLowerCase();
    const existing = map.get(key);
    if (existing) existing.weight += weight;
    else map.set(key, { value: v, weight });
  }
  const ranked = [...map.values()].sort(
    (a, b) => b.weight - a.weight || a.value.localeCompare(b.value),
  );
  return ranked[0]?.value ?? '';
}

function emptyVoice(): ComputedAuthorVoice {
  return {
    docCount: 0,
    tone: [],
    formality: DEFAULT_FORMALITY,
    sectionPatterns: [],
    openingStyle: '',
    closingStyle: '',
    recurringPhrases: [],
    vocabulary: [],
    persuasionPatterns: [],
    formatting: [],
    sourceProfileIds: [],
  };
}

/**
 * Merge per-document profiles into the org-wide Author Voice.
 * Returns everything except `version`/`updatedAt` (the adapter stamps those).
 * @param recencyMultiplier  Weight of the newest upload relative to oldest (default 2.0).
 *                           1.0 = flat (all equal), 4.0 = aggressive recency bias.
 */
export function mergeVoiceProfiles(
  profiles: VoiceStyleProfile[],
  recencyMultiplier = 2.0,
): ComputedAuthorVoice {
  if (!profiles || profiles.length === 0) return emptyVoice();

  const ordered = sortNewestFirst(profiles);
  const total = ordered.length;
  const weighted = ordered.map((p, i) => ({
    profile: p,
    weight: recencyWeight(i, total, recencyMultiplier),
  }));

  const list = (pick: (p: VoiceStyleProfile) => string[]): WeightedProfileList[] =>
    weighted.map(({ profile, weight }) => ({ items: pick(profile), weight }));

  const scalar = (
    pick: (p: VoiceStyleProfile) => string,
  ): Array<{ value: string; weight: number }> =>
    weighted.map(({ profile, weight }) => ({ value: pick(profile), weight }));

  const formality = weightedMode(
    scalar((p) => p.formality),
  ) as VoiceFormality || DEFAULT_FORMALITY;

  return {
    docCount: total,
    tone: tallyList(list((p) => p.tone)).map((it) => it.value),
    formality,
    sectionPatterns: tallyList(list((p) => p.sectionPatterns)).map((it) => it.value),
    openingStyle: weightedMode(scalar((p) => p.openingStyle)),
    closingStyle: weightedMode(scalar((p) => p.closingStyle)),
    recurringPhrases: tallyList(list((p) => p.recurringPhrases)),
    vocabulary: tallyList(list((p) => p.vocabulary)),
    persuasionPatterns: tallyList(list((p) => p.persuasionPatterns)),
    formatting: tallyList(list((p) => p.formatting)).map((it) => it.value),
    sourceProfileIds: ordered.map((p) => p.id),
  };
}

/** Heading used both in the rendered block and the proposal-prompt injection. */
export const AUTHOR_VOICE_HEADING = '## Organization Author Voice & Proposal Style';

interface RenderOptions {
  maxPhrases?: number;
  maxVocabulary?: number;
  maxSectionPatterns?: number;
  maxTone?: number;
  maxPersuasion?: number;
  maxFormatting?: number;
}

const DEFAULT_RENDER: Required<RenderOptions> = {
  maxPhrases: 12,
  maxVocabulary: 20,
  maxSectionPatterns: 12,
  maxTone: 6,
  maxPersuasion: 6,
  maxFormatting: 8,
};

/**
 * Render the merged voice into a compact, STYLE-ONLY prompt block. Returns ''
 * when there is no voice yet (docCount 0) so callers can skip injection.
 */
export function renderVoicePromptBlock(
  voice: Pick<
    AuthorVoice,
    | 'docCount' | 'tone' | 'formality' | 'sectionPatterns' | 'openingStyle'
    | 'closingStyle' | 'recurringPhrases' | 'vocabulary' | 'persuasionPatterns'
    | 'formatting'
  >,
  options: RenderOptions = {},
): string {
  if (!voice || voice.docCount <= 0) return '';
  const opt = { ...DEFAULT_RENDER, ...options };

  const lines: string[] = [
    AUTHOR_VOICE_HEADING,
    'Write so the proposal reads as if the same author wrote it. This describes HOW to write — tone, structure, and phrasing — NOT client facts. Never copy any specific names, numbers, prices, dates, or facts from this block.',
    '',
  ];

  const tone = voice.tone.slice(0, opt.maxTone);
  if (tone.length) lines.push(`- Tone: ${tone.join(', ')} | Formality: ${voice.formality}`);

  const sections = voice.sectionPatterns.slice(0, opt.maxSectionPatterns);
  if (sections.length) lines.push(`- Typical structure: ${sections.join(' → ')}`);

  if (voice.openingStyle) lines.push(`- Opening style: ${voice.openingStyle}`);
  if (voice.closingStyle) lines.push(`- Closing style: ${voice.closingStyle}`);

  const persuasion = voice.persuasionPatterns.slice(0, opt.maxPersuasion).map((p) => p.value);
  if (persuasion.length) lines.push(`- Persuasion emphasis: ${persuasion.join(', ')}`);

  const phrases = voice.recurringPhrases.slice(0, opt.maxPhrases).map((p) => `"${p.value}"`);
  if (phrases.length) lines.push(`- Recurring phrasing to favor: ${phrases.join(', ')}`);

  const vocab = voice.vocabulary.slice(0, opt.maxVocabulary).map((v) => v.value);
  if (vocab.length) lines.push(`- Characteristic vocabulary: ${vocab.join(', ')}`);

  const formatting = voice.formatting.slice(0, opt.maxFormatting);
  if (formatting.length) lines.push(`- Formatting: ${formatting.join(', ')}`);

  return lines.join('\n');
}
