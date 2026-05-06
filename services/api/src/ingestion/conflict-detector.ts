import type { RequirementKey, RequirementField, NamespaceContext, ConflictRecord } from '../chat/context.types.js';
import { valuesEqual } from '../chat/context.service.js';

const TIER_1_KEYS: ReadonlySet<RequirementKey> = new Set(['clientName', 'clientIndustry', 'projectType']);

/**
 * Compare incoming extracted fields against what's already confirmed in context.json.
 * Returns a ConflictRecord for every field where both a value exists and the values differ.
 * Fields that exist only in the incoming extraction (no prior value) are not conflicts.
 */
export function detectConflicts(
  incoming: Partial<Record<RequirementKey, RequirementField<unknown>>>,
  existing: NamespaceContext | null,
  incomingFileName: string,
): ConflictRecord[] {
  if (!existing) return [];
  const existingFields = existing.requirements?.fields ?? {};
  const conflicts: ConflictRecord[] = [];

  for (const [rawKey, incomingField] of Object.entries(incoming)) {
    const key = rawKey as RequirementKey;
    if (!incomingField) continue;

    const existingField = existingFields[key];
    if (!existingField) continue;

    // No conflict if existing field was pending confirmation (not yet user-confirmed)
    if (existingField.pendingConfirmation) continue;

    if (!valuesEqual(incomingField.value, existingField.value)) {
      conflicts.push({
        key,
        incomingValue: incomingField.value,
        incomingConfidence: incomingField.confidence,
        incomingSourceFile: incomingFileName,
        existingValue: existingField.value,
        existingConfidence: existingField.confidence,
        existingSourceFile: existingField.sourceFile,
      });
    }
  }

  // Tier 1 conflicts sorted first (clientName, clientIndustry, projectType)
  return conflicts.sort((a, b) => {
    const aT1 = TIER_1_KEYS.has(a.key) ? 0 : 1;
    const bT1 = TIER_1_KEYS.has(b.key) ? 0 : 1;
    return aT1 - bT1;
  });
}
