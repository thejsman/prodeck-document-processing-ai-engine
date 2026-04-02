/**
 * Requirement Merger — combines RFP-extracted and chat-extracted proposal inputs.
 *
 * Priority order (highest → lowest):
 *   1. confirmed  — user explicitly chose a value (immutable until re-confirmed)
 *   2. chat       — user typed a value in the conversation (confidence 0.95)
 *   3. rfp high   — RFP extraction confidence ≥ 0.85 (auto-fill)
 *   4. rfp medium — RFP extraction confidence 0.60–0.84 (needs confirmation)
 *   5. missing    — ask the user manually
 *
 * Conflict: when both rfp and chat have a value AND those values differ.
 * Conflicts surface to the user as a choice prompt; the chosen value is stored
 * in confirmedRequirements and wins in all future merges.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RequirementKey =
  | 'industry'
  | 'timeline'
  | 'budget'
  | 'teamSize'
  | 'clientName'
  | 'projectType';

export const ALL_REQUIREMENT_KEYS: RequirementKey[] = [
  'industry',
  'timeline',
  'budget',
  'teamSize',
  'clientName',
  'projectType',
];

export interface RequirementEntry {
  value: string;
  confidence: number;
  source: 'rfp' | 'chat' | 'confirmed';
  evidence?: string;
}

/** Typed store — keyed by field name, undefined means not found. */
export type RequirementStore = Partial<Record<RequirementKey, RequirementEntry>>;

export interface RequirementConflict {
  field: RequirementKey;
  rfpValue: string;
  chatValue: string;
}

// ---------------------------------------------------------------------------
// Core merge logic
// ---------------------------------------------------------------------------

/**
 * Merge a single field according to priority rules.
 * Confirmed values are never overwritten.
 * Chat always wins over RFP.
 * Within the same source, higher confidence wins.
 */
export function mergeField(
  existing: RequirementEntry | undefined,
  incoming: RequirementEntry,
): RequirementEntry {
  if (!existing) return incoming;
  if (existing.source === 'confirmed') return existing;
  if (incoming.source === 'confirmed') return incoming;
  if (incoming.source === 'chat') return incoming;
  if (existing.source === 'chat') return existing;
  // both rfp — higher confidence wins
  return incoming.confidence > existing.confidence ? incoming : existing;
}

/**
 * Detect conflicts: fields where both rfp and chat have a value but they differ.
 * Only raises conflicts for unconfirmed fields.
 */
export function detectConflicts(
  rfp: RequirementStore,
  chat: RequirementStore,
  confirmed: Record<string, string>,
): RequirementConflict[] {
  const conflicts: RequirementConflict[] = [];

  for (const key of ALL_REQUIREMENT_KEYS) {
    if (confirmed[key]) continue; // already resolved

    const rfpEntry = rfp[key];
    const chatEntry = chat[key];

    if (!rfpEntry || !chatEntry) continue;

    const rfpVal = rfpEntry.value.trim().toLowerCase();
    const chatVal = chatEntry.value.trim().toLowerCase();

    if (rfpVal !== chatVal) {
      conflicts.push({
        field: key,
        rfpValue: rfpEntry.value,
        chatValue: chatEntry.value,
      });
    }
  }

  return conflicts;
}

/**
 * Build a unified RequirementStore from all three sources.
 * confirmed > chat > rfp (by confidence).
 * Does NOT resolve conflicts — caller must surface them first.
 */
export function buildMergedStore(
  rfp: RequirementStore,
  chat: RequirementStore,
  confirmed: Record<string, string>,
): RequirementStore {
  const merged: RequirementStore = {};

  for (const key of ALL_REQUIREMENT_KEYS) {
    // Confirmed always wins
    if (confirmed[key]) {
      merged[key] = { value: confirmed[key], confidence: 1, source: 'confirmed' };
      continue;
    }

    const rfpEntry = rfp[key];
    const chatEntry = chat[key];

    if (chatEntry && rfpEntry) {
      // Conflict: chat wins per priority rules — conflicts are surfaced separately
      merged[key] = chatEntry;
    } else if (chatEntry) {
      merged[key] = chatEntry;
    } else if (rfpEntry) {
      merged[key] = rfpEntry;
    }
  }

  return merged;
}

/**
 * Flatten the merged store to a simple string map for generation.
 * Only includes fields with confidence ≥ 0.60 or source === 'confirmed'/'chat'.
 */
export function flattenRequirements(store: RequirementStore): Record<string, string> {
  const flat: Record<string, string> = {};

  for (const key of ALL_REQUIREMENT_KEYS) {
    const entry = store[key];
    if (!entry) continue;
    if (entry.source === 'confirmed' || entry.source === 'chat' || entry.confidence >= 0.6) {
      flat[key] = entry.value;
    }
  }

  return flat;
}

/**
 * Build a typed chat RequirementStore from the flat string map returned
 * by extractRequirementsFromMessage.
 */
export function chatExtractionsToStore(flat: Record<string, string>): RequirementStore {
  const store: RequirementStore = {};

  for (const key of ALL_REQUIREMENT_KEYS) {
    if (flat[key]) {
      store[key] = { value: flat[key], confidence: 0.95, source: 'chat' };
    }
  }

  return store;
}

// ---------------------------------------------------------------------------
// Conflict UX builder
// ---------------------------------------------------------------------------

/**
 * Build a user-facing conflict resolution message for a single conflict.
 */
export function buildConflictPrompt(conflict: RequirementConflict): string {
  const { field, rfpValue, chatValue } = conflict;

  return [
    `I found two different **${field}** values:`,
    '',
    `• RFP suggests: **${rfpValue}**`,
    `• You mentioned: **${chatValue}**`,
    '',
    'Which one should I use? Reply with **1** for the RFP value, **2** for your value, or type a different value.',
  ].join('\n');
}

/**
 * Resolve a pending conflict from the user's response.
 * Returns the chosen value or null if the response is unrecognisable.
 */
export function resolveConflictResponse(
  response: string,
  conflict: RequirementConflict,
): string | null {
  const trimmed = response.trim();
  if (trimmed === '1') return conflict.rfpValue;
  if (trimmed === '2') return conflict.chatValue;
  if (trimmed.length > 0 && trimmed !== 'yes' && trimmed !== 'no') return trimmed;
  return null;
}
