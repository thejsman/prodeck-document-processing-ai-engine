import type {
  NamespaceContext,
  BriefReadiness,
  BriefFieldStatus,
  Tier1Key,
  Tier2Key,
} from './context.types.js';

const TIER1_KEYS: Tier1Key[] = ['clientName', 'clientIndustry', 'projectType'];
const TIER2_KEYS: Tier2Key[] = ['budget', 'timeline', 'keyObjectives', 'contactName'];

function fieldStatus(
  context: NamespaceContext | null,
  key: string,
): BriefFieldStatus {
  const field = context?.requirements?.fields[key as Tier1Key];
  if (!field?.value) return { filled: false };
  return {
    filled: true,
    confidence: field.confidence,
    pendingConfirmation: field.pendingConfirmation,
    sourceFile: field.sourceFile,
  };
}

export function computeBriefReadiness(context: NamespaceContext | null): BriefReadiness {
  const tier1Fields = {} as Record<Tier1Key, BriefFieldStatus>;
  const tier1Missing: string[] = [];

  for (const key of TIER1_KEYS) {
    const status = fieldStatus(context, key);
    tier1Fields[key] = status;
    if (!status.filled) tier1Missing.push(key);
  }

  const tier1Complete = tier1Missing.length === 0;

  const tier2Missing: string[] = [];
  for (const key of TIER2_KEYS) {
    const status = fieldStatus(context, key);
    if (!status.filled) tier2Missing.push(key);
  }

  return {
    tier1: {
      complete: tier1Complete,
      fields: tier1Fields,
      missingFields: tier1Missing,
    },
    tier2: {
      complete: tier2Missing.length === 0,
      missingFields: tier2Missing,
    },
    canGenerate: tier1Complete,
    blockingField: tier1Missing[0],
  };
}
