import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import type {
  NamespaceContext,
  KnowledgeEntry,
  RequirementField,
  RequirementKey,
  ContextSource,
  ExtractionResult,
  MeetingSummary,
  AgendaItem,
  ClientPriority,
  AgencyDeliverable,
  BusinessMetric,
  PendingExtraction,
} from './context.types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_KNOWLEDGE_ENTRIES = 200;

/** Normalizes text to a deduplicated word set for Jaccard similarity. */
function tokenizeWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(Boolean),
  );
}

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

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

export function mergeField<T>(
  existing: RequirementField<T> | undefined,
  incoming: RequirementField<T>,
): RequirementField<T> {
  if (!existing) {
    // Auto-confirm user-stated values at high confidence
    if (incoming.source === 'user' && incoming.confidence >= 0.85 && !incoming.confirmedByUser) {
      return { ...incoming, confirmedByUser: { at: incoming.updatedAt } };
    }
    return incoming;
  }
  // User-stated always wins over document-extracted — mark confirmed if high-confidence
  if (incoming.source === 'user' && existing.source === 'document') {
    if (incoming.confidence >= 0.85 && !incoming.confirmedByUser) {
      return { ...incoming, confirmedByUser: { at: incoming.updatedAt } };
    }
    if (existing.confirmedByUser && !incoming.confirmedByUser) {
      return { ...incoming, confirmedByUser: existing.confirmedByUser };
    }
    return incoming;
  }
  if (incoming.source === 'document' && existing.source === 'user') return existing;
  // Same source → higher confidence wins; clear confirmedByUser if the value changed
  if (incoming.confidence >= existing.confidence) {
    const valueChanged = !valuesEqual(incoming.value, existing.value);
    if (valueChanged) return incoming; // value changed — discard prior confirmation
    const confirmedByUser = existing.confirmedByUser ?? incoming.confirmedByUser;
    if (confirmedByUser) return { ...incoming, confirmedByUser }; // preserve blessing
    return incoming; // nothing to annotate — return same reference
  }
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
// Meeting summary merge helpers
// ---------------------------------------------------------------------------

function mergeAgenda(existing: AgendaItem[] = [], incoming: AgendaItem[] = []): AgendaItem[] {
  const byTitle = new Map<string, AgendaItem>();
  for (const item of existing) byTitle.set(item.title.trim().toLowerCase(), item);
  for (const item of incoming) {
    const key = item.title.trim().toLowerCase();
    const prev = byTitle.get(key);
    if (prev) {
      byTitle.set(key, {
        title: item.title,
        keyTakeaways: [...new Set([...prev.keyTakeaways, ...item.keyTakeaways])],
      });
    } else {
      byTitle.set(key, item);
    }
  }
  return [...byTitle.values()];
}

function mergeClientPriorities(
  existing: ClientPriority[] = [],
  incoming: ClientPriority[] = [],
): ClientPriority[] {
  const byTitle = new Map<string, ClientPriority>();
  for (const p of existing) byTitle.set(p.title.trim().toLowerCase(), p);
  for (const p of incoming) {
    const key = p.title.trim().toLowerCase();
    const prev = byTitle.get(key);
    if (prev) {
      byTitle.set(key, {
        rank: p.rank,
        title: p.title,
        bullets: [...new Set([...prev.bullets, ...p.bullets])],
      });
    } else {
      byTitle.set(key, p);
    }
  }
  return [...byTitle.values()].sort((a, b) => a.rank - b.rank);
}

function mergeDeliverables(
  existing: AgencyDeliverable[] = [],
  incoming: AgencyDeliverable[] = [],
): AgencyDeliverable[] {
  const byKey = new Map<string, AgencyDeliverable>();
  for (const d of existing) byKey.set(d.deliverable.trim().toLowerCase(), d);
  for (const d of incoming) byKey.set(d.deliverable.trim().toLowerCase(), d);
  return [...byKey.values()];
}

function mergeBusinessMetrics(
  existing: BusinessMetric[] = [],
  incoming: BusinessMetric[] = [],
): BusinessMetric[] {
  const byKey = new Map<string, BusinessMetric>();
  for (const m of existing) byKey.set(`${m.metric}::${m.value}`.toLowerCase(), m);
  for (const m of incoming) byKey.set(`${m.metric}::${m.value}`.toLowerCase(), m);
  return [...byKey.values()];
}

function mergeStringSet(existing: string[] = [], incoming: string[] = []): string[] {
  return [...new Set([...existing, ...incoming])];
}

export function mergeMeetingSummaries(
  existing: MeetingSummary | undefined,
  incoming: MeetingSummary,
): MeetingSummary {
  if (!existing) return incoming;

  const merged: MeetingSummary = {
    updatedAt: incoming.updatedAt,
    sourceFile: incoming.sourceFile ?? existing.sourceFile,
  };

  // Scalar blocks — incoming wins if present, otherwise keep existing
  merged.clientOrganization = incoming.clientOrganization ?? existing.clientOrganization;
  merged.agencyOrganization = incoming.agencyOrganization ?? existing.agencyOrganization;
  merged.engagementModel = incoming.engagementModel ?? existing.engagementModel;

  // Array blocks — union by key
  const agenda = mergeAgenda(existing.agenda, incoming.agenda);
  if (agenda.length) merged.agenda = agenda;

  const priorities = mergeClientPriorities(existing.clientPriorities, incoming.clientPriorities);
  if (priorities.length) merged.clientPriorities = priorities;

  const deliverables = mergeDeliverables(existing.agencyDeliverables, incoming.agencyDeliverables);
  if (deliverables.length) merged.agencyDeliverables = deliverables;

  const metrics = mergeBusinessMetrics(existing.businessMetrics, incoming.businessMetrics);
  if (metrics.length) merged.businessMetrics = metrics;

  // MoSCoW — union per bucket
  if (existing.requirementsByPriority || incoming.requirementsByPriority) {
    const must = mergeStringSet(
      existing.requirementsByPriority?.must,
      incoming.requirementsByPriority?.must,
    );
    const should = mergeStringSet(
      existing.requirementsByPriority?.should,
      incoming.requirementsByPriority?.should,
    );
    const could = mergeStringSet(
      existing.requirementsByPriority?.could,
      incoming.requirementsByPriority?.could,
    );
    if (must.length || should.length || could.length) {
      merged.requirementsByPriority = { must, should, could };
    }
  }

  return merged;
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

  async mergeMeetingSummary(
    namespace: string,
    incoming: MeetingSummary,
  ): Promise<NamespaceContext> {
    const current = (await this.get(namespace)) ?? this.createEmpty(namespace);
    current.meetingSummary = mergeMeetingSummaries(current.meetingSummary, incoming);
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

    // Build inverted word index over active existing entries so duplicate checks
    // scan only same-category candidates sharing at least one word (O(n) amortized)
    // rather than the full knowledge array (O(n×m)).
    const wordIndex = new Map<string, Set<number>>();
    const addToIndex = (idx: number, words: Set<string>) => {
      for (const w of words) {
        let bucket = wordIndex.get(w);
        if (!bucket) { bucket = new Set(); wordIndex.set(w, bucket); }
        bucket.add(idx);
      }
    };
    for (let i = 0; i < current.knowledge.length; i++) {
      if (current.knowledge[i].supersededBy) continue;
      addToIndex(i, tokenizeWords(current.knowledge[i].content));
    }

    for (const entry of incoming) {
      const entryWords = tokenizeWords(entry.content);

      // Collect candidate indices: active entries that share ≥1 word AND same category
      const candidates = new Set<number>();
      for (const w of entryWords) {
        for (const idx of (wordIndex.get(w) ?? [])) {
          if (current.knowledge[idx]?.category === entry.category) {
            candidates.add(idx);
          }
        }
      }

      // Run full Jaccard only on the small candidate set (typically 0–5 entries)
      const existingIdx = [...candidates].find((idx) =>
        this.isSemanticallyDuplicate(current.knowledge[idx].content, entry.content),
      ) ?? -1;

      if (existingIdx >= 0) {
        const existing = current.knowledge[existingIdx];
        if (entry.confidence >= existing.confidence) {
          existing.supersededBy = entry.id;
          const newIdx = current.knowledge.length;
          current.knowledge.push(entry);
          addToIndex(newIdx, entryWords);
        }
        // otherwise keep existing, discard incoming
      } else {
        const newIdx = current.knowledge.length;
        current.knowledge.push(entry);
        addToIndex(newIdx, entryWords);
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

  async confirmEntities(namespace: string): Promise<NamespaceContext> {
    const current = (await this.get(namespace)) ?? this.createEmpty(namespace);
    const now = new Date().toISOString();
    const entityFields: RequirementKey[] = ['clientName', 'clientIndustry'];
    for (const key of entityFields) {
      const field = current.requirements.fields[key];
      if (field && !field.confirmedByUser) {
        current.requirements.fields[key] = { ...field, confirmedByUser: { at: now } };
      }
    }
    current.version += 1;
    current.updatedAt = now;
    await this.save(namespace, current);
    return current;
  }

  async setSelectedTemplate(
    namespace: string,
    selected: import('./context.types.js').SelectedTemplate,
  ): Promise<NamespaceContext> {
    const current = (await this.get(namespace)) ?? this.createEmpty(namespace);
    current.selectedTemplate = selected;
    current.version += 1;
    current.updatedAt = new Date().toISOString();
    await this.save(namespace, current);
    return current;
  }

  async setPendingTemplateApproval(
    namespace: string,
    data: { kind: 'approve_generated_template'; templateSlug: string },
  ): Promise<void> {
    const current = (await this.get(namespace)) ?? this.createEmpty(namespace);
    current.pendingTemplateApproval = data;
    current.version += 1;
    current.updatedAt = new Date().toISOString();
    await this.save(namespace, current);
  }

  async clearPendingTemplateApproval(namespace: string): Promise<void> {
    const current = (await this.get(namespace)) ?? this.createEmpty(namespace);
    if (!current.pendingTemplateApproval) return;
    delete current.pendingTemplateApproval;
    current.version += 1;
    current.updatedAt = new Date().toISOString();
    await this.save(namespace, current);
  }

  async removeFileContributions(namespace: string, fileName: string): Promise<void> {
    const current = await this.get(namespace);
    if (!current) return;

    // Remove knowledge entries sourced from this file
    current.knowledge = current.knowledge.filter(
      (k) => k.source.fileName !== fileName,
    );

    // Remove sources record for this file
    current.sources = current.sources.filter((s) => s.fileName !== fileName);

    // Remove scalar/array requirement fields that came solely from this file
    for (const key of Object.keys(current.requirements.fields) as RequirementKey[]) {
      const field = current.requirements.fields[key];
      if (field?.source === 'document' && field.sourceFile === fileName) {
        delete current.requirements.fields[key];
      }
    }
    for (const key of Object.keys(current.requirements.customFields)) {
      const field = current.requirements.customFields[key];
      if (field?.source === 'document' && field.sourceFile === fileName) {
        delete current.requirements.customFields[key];
      }
    }

    current.version += 1;
    current.updatedAt = new Date().toISOString();
    await this.save(namespace, current);
  }

  async reset(namespace: string): Promise<void> {
    await this.save(namespace, this.createEmpty(namespace));
  }

  /**
   * Stores extraction results as pending (awaiting user confirmation).
   * Fields are written with pendingConfirmation: true so the Brief Panel shows them as ◐.
   */
  async storePendingExtraction(
    namespace: string,
    documentId: string,
    fields: ExtractionResult['fields'],
    source: ContextSource,
  ): Promise<NamespaceContext> {
    const current = (await this.get(namespace)) ?? this.createEmpty(namespace);

    // Write fields with pendingConfirmation: true — usable for generation but unconfirmed
    for (const [key, field] of Object.entries(fields)) {
      if (!field) continue;
      const rKey = key as RequirementKey;
      const pendingField = { ...field, pendingConfirmation: true } as RequirementField<unknown>;
      if (ARRAY_FIELDS.includes(rKey)) {
        current.requirements.fields[rKey] = mergeArrayField(
          current.requirements.fields[rKey] as RequirementField<unknown[]> | undefined,
          pendingField as RequirementField<unknown[]>,
        ) as RequirementField<unknown>;
        (current.requirements.fields[rKey] as RequirementField<unknown>).pendingConfirmation = true;
      } else {
        current.requirements.fields[rKey] = mergeField(
          current.requirements.fields[rKey],
          pendingField,
        );
      }
    }

    // Record pending extraction for the Brief Panel confirmation card
    const pending: PendingExtraction = {
      cardId: documentId,
      documentId,
      fileName: documentId,
      extractedAt: new Date().toISOString(),
      fields: { ...fields } as PendingExtraction['fields'],
    };
    if (!current.pendingExtractions) current.pendingExtractions = [];
    // Replace any existing entry for the same document
    current.pendingExtractions = current.pendingExtractions.filter(
      (p) => p.documentId !== documentId,
    );
    current.pendingExtractions.push(pending);

    if (source) current.sources.push(source);
    current.version += 1;
    current.updatedAt = new Date().toISOString();
    await this.save(namespace, current);
    return current;
  }

  /**
   * Confirms extracted fields — clears pendingConfirmation flags and optionally
   * removes the pending extraction entry for the given documentId.
   */
  async confirmFields(
    namespace: string,
    fields: Partial<Record<RequirementKey, { value: unknown; confidence: number; source: 'user' | 'document' | 'inferred' }>>,
    documentId?: string,
  ): Promise<NamespaceContext> {
    const current = (await this.get(namespace)) ?? this.createEmpty(namespace);
    const now = new Date().toISOString();

    for (const [key, incoming] of Object.entries(fields)) {
      if (!incoming) continue;
      const rKey = key as RequirementKey;
      const confirmed: RequirementField<unknown> = {
        value: incoming.value,
        confidence: incoming.confidence,
        source: incoming.source,
        updatedAt: now,
        confirmedByUser: { at: now },
      };
      current.requirements.fields[rKey] = confirmed;
    }

    // Clear this document's pending extraction entry
    if (documentId && current.pendingExtractions) {
      current.pendingExtractions = current.pendingExtractions.filter(
        (p) => p.documentId !== documentId,
      );
      if (current.pendingExtractions.length === 0) {
        delete current.pendingExtractions;
      }
    }

    current.version += 1;
    current.updatedAt = now;
    await this.save(namespace, current);
    return current;
  }

  /**
   * Updates a single field directly (user edit from Brief Panel).
   * Sets source to 'user', confidence to 1.0, clears pendingConfirmation.
   */
  async updateField(
    namespace: string,
    key: RequirementKey,
    value: unknown,
    source: 'user' | 'document' | 'inferred' = 'user',
  ): Promise<NamespaceContext> {
    const current = (await this.get(namespace)) ?? this.createEmpty(namespace);
    const now = new Date().toISOString();

    const updated: RequirementField<unknown> = {
      value,
      confidence: source === 'user' ? 1.0 : (current.requirements.fields[key]?.confidence ?? 0.8),
      source,
      updatedAt: now,
      ...(source === 'user' ? { confirmedByUser: { at: now } } : {}),
    };
    current.requirements.fields[key] = updated;

    current.version += 1;
    current.updatedAt = now;
    await this.save(namespace, current);
    return current;
  }

  async updateKnowledge(namespace: string, id: string, content: string): Promise<NamespaceContext | null> {
    const current = await this.get(namespace);
    if (!current) return null;
    const entry = current.knowledge.find((e) => e.id === id);
    if (!entry) return null;
    entry.content = content;
    current.version += 1;
    current.updatedAt = new Date().toISOString();
    await this.save(namespace, current);
    return current;
  }

  async deleteKnowledge(namespace: string, id: string): Promise<NamespaceContext | null> {
    const current = await this.get(namespace);
    if (!current) return null;
    const idx = current.knowledge.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    current.knowledge.splice(idx, 1);
    current.version += 1;
    current.updatedAt = new Date().toISOString();
    await this.save(namespace, current);
    return current;
  }

  private isSemanticallyDuplicate(a: string, b: string): boolean {
    const wordsA = tokenizeWords(a);
    const wordsB = tokenizeWords(b);
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
