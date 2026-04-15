import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import type {
  NamespaceContext,
  KnowledgeEntry,
  RequirementField,
  RequirementKey,
  ContextSource,
  ExtractionResult,
} from './context.types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_KNOWLEDGE_ENTRIES = 200;

const ARRAY_FIELDS: RequirementKey[] = [
  'technicalStack',
  'keyObjectives',
  'constraints',
  'deliverables',
  'stakeholders',
];

// ---------------------------------------------------------------------------
// Pure merge helpers (module-level, exported for testing)
// ---------------------------------------------------------------------------

export function mergeField<T>(
  existing: RequirementField<T> | undefined,
  incoming: RequirementField<T>,
): RequirementField<T> {
  if (!existing) return incoming;
  // User-stated always wins over document-extracted (both directions)
  if (incoming.source === 'user' && existing.source === 'document') return incoming;
  if (incoming.source === 'document' && existing.source === 'user') return existing;
  // Same source → higher confidence wins
  if (incoming.confidence >= existing.confidence) return incoming;
  return existing;
}

export function mergeArrayField<T>(
  existing: RequirementField<T[]> | undefined,
  incoming: RequirementField<T[]>,
): RequirementField<T[]> {
  if (!existing) return incoming;
  const merged = [...new Set([...(existing.value ?? []), ...(incoming.value ?? [])])] as T[];
  return {
    value: merged,
    confidence: Math.max(existing.confidence, incoming.confidence),
    source: incoming.source === 'user' ? 'user' : existing.source,
    updatedAt: incoming.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Path helper
// ---------------------------------------------------------------------------

function contextPath(workdir: string, namespace: string): string {
  return path.join(workdir, 'namespaces', namespace, 'context.json');
}

// ---------------------------------------------------------------------------
// ContextService
// ---------------------------------------------------------------------------

export class ContextService {
  constructor(private workdir: string) {}

  async get(namespace: string): Promise<NamespaceContext | null> {
    try {
      const raw = await readFile(contextPath(this.workdir, namespace), 'utf-8');
      return JSON.parse(raw) as NamespaceContext;
    } catch {
      return null;
    }
  }

  async save(namespace: string, context: NamespaceContext): Promise<void> {
    const filePath = contextPath(this.workdir, namespace);
    const tmpPath = `${filePath}.tmp`;
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(tmpPath, JSON.stringify(context, null, 2), 'utf-8');
    await rename(tmpPath, filePath);
  }

  async mergeRequirements(
    namespace: string,
    incoming: ExtractionResult['fields'],
    source?: ContextSource,
  ): Promise<NamespaceContext> {
    const current = (await this.get(namespace)) ?? this.createEmpty(namespace);

    for (const [key, field] of Object.entries(incoming)) {
      if (!field) continue;
      const rKey = key as RequirementKey;
      if (ARRAY_FIELDS.includes(rKey)) {
        current.requirements.fields[rKey] = mergeArrayField(
          current.requirements.fields[rKey] as RequirementField<unknown[]> | undefined,
          field as RequirementField<unknown[]>,
        ) as RequirementField<unknown>;
      } else {
        current.requirements.fields[rKey] = mergeField(
          current.requirements.fields[rKey],
          field,
        );
      }
    }

    if (source) current.sources.push(source);
    current.version += 1;
    current.updatedAt = new Date().toISOString();

    await this.save(namespace, current);
    return current;
  }

  async mergeKnowledge(
    namespace: string,
    incoming: KnowledgeEntry[],
  ): Promise<NamespaceContext> {
    const current = (await this.get(namespace)) ?? this.createEmpty(namespace);

    for (const entry of incoming) {
      const existingIdx = current.knowledge.findIndex(
        (k) =>
          k.category === entry.category &&
          this.isSemanticallyDuplicate(k.content, entry.content),
      );

      if (existingIdx >= 0) {
        const existing = current.knowledge[existingIdx];
        if (entry.confidence >= existing.confidence) {
          existing.supersededBy = entry.id;
          current.knowledge.push(entry);
        }
        // otherwise keep existing, discard incoming
      } else {
        current.knowledge.push(entry);
      }
    }

    // Cap active entries at MAX_KNOWLEDGE_ENTRIES — evict lowest confidence
    const active = current.knowledge.filter((k) => !k.supersededBy);
    if (active.length > MAX_KNOWLEDGE_ENTRIES) {
      const sorted = [...active].sort((a, b) => a.confidence - b.confidence);
      const toEvict = sorted.slice(0, active.length - MAX_KNOWLEDGE_ENTRIES);
      for (const entry of toEvict) {
        entry.supersededBy = 'evicted';
      }
    }

    current.version += 1;
    current.updatedAt = new Date().toISOString();

    await this.save(namespace, current);
    return current;
  }

  async reset(namespace: string): Promise<void> {
    await this.save(namespace, this.createEmpty(namespace));
  }

  private isSemanticallyDuplicate(a: string, b: string): boolean {
    const normalize = (s: string) =>
      new Set(
        s
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(Boolean),
      );
    const wordsA = normalize(a);
    const wordsB = normalize(b);
    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    if (union.size === 0) return false;
    return intersection.size / union.size > 0.7;
  }

  private createEmpty(namespace: string): NamespaceContext {
    return {
      namespace,
      requirements: { fields: {}, customFields: {} },
      knowledge: [],
      sources: [],
      version: 0,
      updatedAt: new Date().toISOString(),
    };
  }
}
