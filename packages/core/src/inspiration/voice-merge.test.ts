import { describe, it, expect } from 'vitest';
import {
  mergeVoiceProfiles,
  renderVoicePromptBlock,
  recencyWeight,
  AUTHOR_VOICE_HEADING,
} from './voice-merge.js';
import type { VoiceStyleProfile } from './voice-types.js';

function profile(overrides: Partial<VoiceStyleProfile> = {}): VoiceStyleProfile {
  return {
    id: 'p1',
    sourceDocument: 'proposal.md',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    extractedAt: '2026-01-01T00:00:00.000Z',
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

describe('recencyWeight', () => {
  it('returns 2.0 for a single profile', () => {
    expect(recencyWeight(0, 1)).toBe(2.0);
  });

  it('weights newest 2x the oldest', () => {
    const total = 4;
    expect(recencyWeight(0, total)).toBeCloseTo(2.0, 10); // newest
    expect(recencyWeight(total - 1, total)).toBeCloseTo(1.0, 10); // oldest
    // monotonically decreasing newest -> oldest
    expect(recencyWeight(1, total)).toBeGreaterThan(recencyWeight(2, total));
  });
});

describe('mergeVoiceProfiles', () => {
  it('returns an empty voice for no profiles', () => {
    const v = mergeVoiceProfiles([]);
    expect(v.docCount).toBe(0);
    expect(v.tone).toEqual([]);
    expect(v.recurringPhrases).toEqual([]);
    expect(v.formality).toBe('neutral');
    expect(v.openingStyle).toBe('');
    expect(v.sourceProfileIds).toEqual([]);
  });

  it('handles a single profile (weight 2.0)', () => {
    const v = mergeVoiceProfiles([profile()]);
    expect(v.docCount).toBe(1);
    expect(v.tone).toEqual(['confident']);
    expect(v.recurringPhrases).toEqual([{ value: 'we partner with you', weight: 2 }]);
    expect(v.formality).toBe('formal');
  });

  it('weights recent uploads ~2x older ones in tallies', () => {
    const older = profile({
      id: 'old',
      uploadedAt: '2026-01-01T00:00:00.000Z',
      recurringPhrases: ['legacy phrase'],
      formality: 'casual',
    });
    const newer = profile({
      id: 'new',
      uploadedAt: '2026-06-01T00:00:00.000Z',
      recurringPhrases: ['fresh phrase'],
      formality: 'highly-formal',
    });
    const v = mergeVoiceProfiles([older, newer]);
    expect(v.docCount).toBe(2);
    // newest first in provenance
    expect(v.sourceProfileIds).toEqual(['new', 'old']);
    // fresh (newest, weight 2.0) ranks above legacy (oldest, weight 1.0)
    const fresh = v.recurringPhrases.find((p) => p.value === 'fresh phrase');
    const legacy = v.recurringPhrases.find((p) => p.value === 'legacy phrase');
    expect(fresh?.weight).toBeCloseTo(2.0, 10);
    expect(legacy?.weight).toBeCloseTo(1.0, 10);
    expect(v.recurringPhrases[0].value).toBe('fresh phrase');
    // scalar weighted vote follows the newest on a tie of frequency
    expect(v.formality).toBe('highly-formal');
  });

  it('sums weights for a phrase shared across docs and counts once per doc', () => {
    const a = profile({ id: 'a', uploadedAt: '2026-06-01T00:00:00.000Z', recurringPhrases: ['shared', 'shared'] });
    const b = profile({ id: 'b', uploadedAt: '2026-01-01T00:00:00.000Z', recurringPhrases: ['shared'] });
    const v = mergeVoiceProfiles([a, b]);
    const shared = v.recurringPhrases.find((p) => p.value === 'shared');
    // counted once in doc a (weight 2.0) + once in doc b (weight 1.0) = 3.0
    expect(shared?.weight).toBeCloseTo(3.0, 10);
  });

  it('is deterministic regardless of input order', () => {
    const a = profile({ id: 'a', uploadedAt: '2026-03-01T00:00:00.000Z' });
    const b = profile({ id: 'b', uploadedAt: '2026-05-01T00:00:00.000Z' });
    const c = profile({ id: 'c', uploadedAt: '2026-01-01T00:00:00.000Z' });
    const v1 = mergeVoiceProfiles([a, b, c]);
    const v2 = mergeVoiceProfiles([c, a, b]);
    expect(v1).toEqual(v2);
  });
});

describe('renderVoicePromptBlock', () => {
  it('returns empty string for an empty voice', () => {
    const v = mergeVoiceProfiles([]);
    expect(renderVoicePromptBlock(v)).toBe('');
  });

  it('renders a compact style-only block with the heading and a no-facts instruction', () => {
    const v = mergeVoiceProfiles([profile()]);
    const block = renderVoicePromptBlock(v);
    expect(block.startsWith(AUTHOR_VOICE_HEADING)).toBe(true);
    expect(block.toLowerCase()).toContain('not client facts');
    expect(block).toContain('confident');
    expect(block).toContain('Executive Summary → Pricing');
    expect(block).toContain('"we partner with you"');
  });
});
