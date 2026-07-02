/**
 * Author Voice — pure types for the org-level "Inspiration & Global Context"
 * feature. These describe the *behavioral DNA* extracted from past proposals
 * (HOW the author writes) — never client facts.
 *
 * This module is part of `@ai-engine/core` and must stay pure: no fs, no net,
 * no env, no clock. Timestamps and recency weights are passed in as data.
 */

export type VoiceFormality = 'casual' | 'neutral' | 'formal' | 'highly-formal';

/**
 * A single past proposal's extracted style profile. Behavioral DNA ONLY —
 * client facts/names/numbers are explicitly excluded during extraction.
 */
export interface VoiceStyleProfile {
  /** Stable id assigned by the service (uuid). */
  id: string;
  /** Safe source filename, for provenance / re-run after delete. */
  sourceDocument: string;
  /** ISO timestamp — the SOLE input to recency weighting. */
  uploadedAt: string;
  /** ISO timestamp — when the extraction pass ran. */
  extractedAt: string;
  /** Tone descriptors, e.g. ['confident','consultative','warm']. */
  tone: string[];
  formality: VoiceFormality;
  /** Recurring section names in typical order. */
  sectionPatterns: string[];
  /** How proposals tend to open (style, not content). */
  openingStyle: string;
  /** How they tend to close / CTA style. */
  closingStyle: string;
  /** Signature reusable phrasings (no names/numbers). */
  recurringPhrases: string[];
  /** Characteristic word choices / power words. */
  vocabulary: string[];
  /** e.g. 'roi-led','social-proof-led','timeline-led'. */
  persuasionPatterns: string[];
  /** e.g. 'short paragraphs','bold key terms','bulleted deliverables'. */
  formatting: string[];
}

/** A ranked, recency-weighted item in the merged voice. */
export interface WeightedItem {
  value: string;
  /** Summed recency weight across contributing profiles. */
  weight: number;
}

/**
 * The merged org-wide Author Voice. The pure merge computes everything except
 * `version` and `updatedAt`, which the persistence adapter stamps (it owns the
 * clock + version counter). See {@link ComputedAuthorVoice}.
 */
export interface AuthorVoice {
  version: number;
  updatedAt: string;
  /** Number of profiles merged. */
  docCount: number;
  tone: string[];
  formality: VoiceFormality;
  sectionPatterns: string[];
  openingStyle: string;
  closingStyle: string;
  recurringPhrases: WeightedItem[];
  vocabulary: WeightedItem[];
  persuasionPatterns: WeightedItem[];
  formatting: string[];
  /** Provenance: contributing profile ids, newest first. */
  sourceProfileIds: string[];
}

/** What the pure merge returns — adapter adds `version` + `updatedAt`. */
export type ComputedAuthorVoice = Omit<AuthorVoice, 'version' | 'updatedAt'>;
