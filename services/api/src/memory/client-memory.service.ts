import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { NamespaceContext } from '../chat/context.types.js';
import type {
  ClientMemory,
  ClientKnowledgeEntry,
  StakeholderRecord,
  MemoryConflict,
  MemoryField,
  StableRequirementKey,
  DistillationResult,
  DistillResult,
  PrepopulateResult,
} from './client-memory.types.js';
import { distill } from './memory-distiller.js';
import { detectMemoryConflicts } from './conflict-detector.js';

export class ClientMemoryService {
  constructor(private readonly workdir: string) {}

  // ---------------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------------

  private memoryPath(clientSlug: string): string {
    return path.join(this.workdir, 'clients', clientSlug, 'chatmemory.json');
  }

  async get(clientSlug: string): Promise<ClientMemory | null> {
    try {
      const raw = await readFile(this.memoryPath(clientSlug), 'utf-8');
      return JSON.parse(raw) as ClientMemory;
    } catch {
      return null;
    }
  }

  async save(clientSlug: string, memory: ClientMemory): Promise<void> {
    const filePath = this.memoryPath(clientSlug);
    const tmpPath = `${filePath}.tmp`;
    await mkdir(path.dirname(filePath), { recursive: true });
    memory.updatedAt = new Date().toISOString();
    await writeFile(tmpPath, JSON.stringify(memory, null, 2), 'utf-8');
    await rename(tmpPath, filePath);
  }

  async list(): Promise<ClientMemory[]> {
    const clientsDir = path.join(this.workdir, 'clients');
    try {
      const entries = await readdir(clientsDir, { withFileTypes: true });
      const records = await Promise.all(
        entries
          .filter((e) => e.isDirectory())
          .map((e) => this.get(e.name)),
      );
      return records.filter((r): r is ClientMemory => r !== null);
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Creation
  // ---------------------------------------------------------------------------

  async createEmpty(clientName: string): Promise<ClientMemory> {
    const clientSlug = this.slugify(clientName);
    const now = new Date().toISOString();
    const memory: ClientMemory = {
      clientSlug,
      clientName,
      clientIndustry: '',
      stableFields: {},
      knowledge: [],
      stakeholders: [],
      engagements: [],
      conflicts: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.save(clientSlug, memory);
    return memory;
  }

  slugify(clientName: string): string {
    return clientName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // ---------------------------------------------------------------------------
  // Pre-population
  // ---------------------------------------------------------------------------

  async prepopulate(clientSlug: string): Promise<PrepopulateResult> {
    const memory = await this.get(clientSlug);
    if (!memory) {
      return {
        found: false,
        stableFields: {},
        knowledge: [],
        stakeholders: [],
        engagementCount: 0,
        lastEngagementDate: '',
      };
    }

    const lastEngagement = memory.engagements[memory.engagements.length - 1];

    return {
      found: true,
      stableFields: memory.stableFields,
      knowledge: memory.knowledge.filter((k) => !k.supersededBy),
      stakeholders: memory.stakeholders,
      engagementCount: memory.engagements.length,
      lastEngagementDate: lastEngagement?.closedAt ?? memory.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Distillation
  // ---------------------------------------------------------------------------

  async distill(
    namespace: string,
    context: NamespaceContext,
  ): Promise<DistillResult> {
    const clientNameField = context.requirements.fields['clientName'];
    if (!clientNameField) {
      throw new Error('Cannot distill: clientName not found in context');
    }

    const clientName = String(clientNameField.value);
    const clientSlug = this.slugify(clientName);

    let memory = await this.get(clientSlug);
    if (!memory) {
      memory = await this.createEmpty(clientName);
    }

    const distillation = await distill(context, memory);
    await this.mergeDistillation(clientSlug, namespace, context, distillation);

    return {
      clientSlug,
      fieldsUpdated: Object.keys(distillation.stableFields).length,
      knowledgeAdded: distillation.newKnowledge.length,
      knowledgeConfirmed: distillation.confirmedKnowledge.length,
      contradictionsFound: distillation.contradictions.length,
      stakeholdersUpdated: distillation.stakeholders.length,
    };
  }

  async mergeDistillation(
    clientSlug: string,
    namespace: string,
    context: NamespaceContext,
    result: DistillationResult,
  ): Promise<void> {
    const memory = await this.get(clientSlug);
    if (!memory) return;

    const now = new Date().toISOString();

    // Stable fields
    for (const [key, incoming] of Object.entries(result.stableFields)) {
      const k = key as StableRequirementKey;
      const existing = memory.stableFields[k];
      memory.stableFields[k] = existing
        ? {
            value: incoming.value,
            confidence: compoundConfidence(existing.confidence, incoming.confidence),
            sourceEngagements: [...new Set([...existing.sourceEngagements, namespace])],
            firstSeenAt: existing.firstSeenAt,
            lastConfirmedAt: now,
          }
        : {
            value: incoming.value,
            confidence: incoming.confidence,
            sourceEngagements: [namespace],
            firstSeenAt: now,
            lastConfirmedAt: now,
          };

      if (k === 'clientIndustry' && typeof incoming.value === 'string') {
        memory.clientIndustry = incoming.value;
      }
    }

    // Confirm existing knowledge
    for (const confirmed of result.confirmedKnowledge) {
      const entry = memory.knowledge.find((k) => k.id === confirmed.existingId);
      if (entry) {
        entry.confidence = compoundConfidence(entry.confidence, confirmed.confidence);
        entry.sourceEngagements = [
          ...new Set([...entry.sourceEngagements, namespace]),
        ];
        entry.lastConfirmedAt = now;
      }
    }

    // New knowledge entries
    for (const incoming of result.newKnowledge) {
      memory.knowledge.push({
        id: crypto.randomUUID(),
        content: incoming.content,
        category: incoming.category as ClientKnowledgeEntry['category'],
        confidence: incoming.confidence,
        sourceEngagements: [namespace],
        firstSeenAt: now,
        lastConfirmedAt: now,
      });
    }

    // Contradictions → conflict records
    const newConflicts = detectMemoryConflicts(
      result.contradictions,
      memory.knowledge,
      now,
    );
    memory.conflicts.push(...newConflicts);

    // Stakeholders — merge by name (case-insensitive)
    for (const incoming of result.stakeholders) {
      const existing = memory.stakeholders.find(
        (s) => s.name.toLowerCase() === incoming.name.toLowerCase(),
      );
      if (existing) {
        existing.role = incoming.role;
        if (incoming.notes) existing.notes = incoming.notes;
        if (incoming.email) existing.email = incoming.email;
        existing.sourceEngagements = [
          ...new Set([...existing.sourceEngagements, namespace]),
        ];
        existing.lastSeenAt = now;
      } else {
        memory.stakeholders.push({
          id: crypto.randomUUID(),
          name: incoming.name,
          role: incoming.role,
          email: incoming.email,
          notes: incoming.notes,
          sourceEngagements: [namespace],
          lastSeenAt: now,
        });
      }
    }

    // Engagement summary (append once per namespace)
    if (!memory.engagements.find((e) => e.namespace === namespace)) {
      const projectType = String(
        context.requirements.fields['projectType']?.value ?? 'unknown',
      );
      memory.engagements.push({
        namespace,
        projectType,
        closedAt: now,
        fieldsContributed: Object.keys(result.stableFields) as StableRequirementKey[],
        knowledgeContributed:
          result.newKnowledge.length + result.confirmedKnowledge.length,
      });
    }

    memory.version += 1;
    await this.save(clientSlug, memory);
  }

  // ---------------------------------------------------------------------------
  // Conflict management
  // ---------------------------------------------------------------------------

  async getConflicts(clientSlug: string): Promise<MemoryConflict[]> {
    const memory = await this.get(clientSlug);
    return (memory?.conflicts ?? []).filter((c) => c.status === 'needs_review');
  }

  async resolveConflict(
    clientSlug: string,
    conflictId: string,
    resolution: 'keep_old' | 'use_new' | 'keep_both' | 'defer',
  ): Promise<void> {
    if (resolution === 'defer') return;

    const memory = await this.get(clientSlug);
    if (!memory) return;

    const conflict = memory.conflicts.find((c) => c.id === conflictId);
    if (!conflict) return;

    const now = new Date().toISOString();
    conflict.status = 'resolved';
    conflict.resolvedAt = now;

    if (resolution === 'use_new') {
      const entry = memory.knowledge.find((k) => k.id === conflict.existingId);
      if (entry) {
        entry.content = conflict.incomingContent;
        entry.lastConfirmedAt = now;
      }
    } else if (resolution === 'keep_both') {
      memory.knowledge.push({
        id: crypto.randomUUID(),
        content: conflict.incomingContent,
        category: 'context',
        confidence: 0.8,
        sourceEngagements: [],
        firstSeenAt: now,
        lastConfirmedAt: now,
      });
    } else {
      conflict.resolution = 'keep_old';
    }

    if (resolution !== 'keep_both') {
      conflict.resolution = resolution;
    }

    memory.version += 1;
    await this.save(clientSlug, memory);
  }

  // ---------------------------------------------------------------------------
  // Direct CRUD (manual editing)
  // ---------------------------------------------------------------------------

  async updateField(
    clientSlug: string,
    key: StableRequirementKey,
    value: string | string[],
  ): Promise<void> {
    const memory = await this.get(clientSlug);
    if (!memory) return;

    const now = new Date().toISOString();
    const existing = memory.stableFields[key];
    memory.stableFields[key] = {
      value,
      confidence: 1.0,
      sourceEngagements: existing?.sourceEngagements ?? [],
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastConfirmedAt: now,
    };

    if (key === 'clientIndustry' && typeof value === 'string') {
      memory.clientIndustry = value;
    }

    memory.version += 1;
    await this.save(clientSlug, memory);
  }

  async addKnowledge(
    clientSlug: string,
    content: string,
    category: ClientKnowledgeEntry['category'],
    confidence = 1.0,
    sourceDocument?: string,
  ): Promise<ClientKnowledgeEntry> {
    const memory = await this.get(clientSlug);
    if (!memory) throw new Error(`Client "${clientSlug}" not found`);

    const now = new Date().toISOString();
    const entry: ClientKnowledgeEntry = {
      id: crypto.randomUUID(),
      content,
      category,
      confidence,
      sourceEngagements: [],
      ...(sourceDocument ? { sourceDocument } : {}),
      firstSeenAt: now,
      lastConfirmedAt: now,
    };
    memory.knowledge.push(entry);
    memory.version += 1;
    await this.save(clientSlug, memory);
    return entry;
  }

  async removeKnowledgeByDocument(
    clientSlug: string,
    fileName: string,
  ): Promise<number> {
    const memory = await this.get(clientSlug);
    if (!memory) return 0;
    const before = memory.knowledge.length;
    memory.knowledge = memory.knowledge.filter(
      (k) => k.sourceDocument !== fileName,
    );
    const removed = before - memory.knowledge.length;
    if (removed > 0) {
      memory.version += 1;
      await this.save(clientSlug, memory);
    }
    return removed;
  }

  async updateKnowledge(
    clientSlug: string,
    entryId: string,
    content: string,
  ): Promise<void> {
    const memory = await this.get(clientSlug);
    if (!memory) return;

    const entry = memory.knowledge.find((k) => k.id === entryId);
    if (!entry) return;

    entry.content = content;
    entry.lastConfirmedAt = new Date().toISOString();
    memory.version += 1;
    await this.save(clientSlug, memory);
  }

  async removeKnowledge(clientSlug: string, entryId: string): Promise<void> {
    const memory = await this.get(clientSlug);
    if (!memory) return;

    memory.knowledge = memory.knowledge.filter((k) => k.id !== entryId);
    memory.version += 1;
    await this.save(clientSlug, memory);
  }

  async addStakeholder(
    clientSlug: string,
    stakeholder: Omit<StakeholderRecord, 'id' | 'sourceEngagements' | 'lastSeenAt'>,
  ): Promise<StakeholderRecord> {
    const memory = await this.get(clientSlug);
    if (!memory) throw new Error(`Client "${clientSlug}" not found`);

    const now = new Date().toISOString();
    const record: StakeholderRecord = {
      id: crypto.randomUUID(),
      ...stakeholder,
      sourceEngagements: [],
      lastSeenAt: now,
    };
    memory.stakeholders.push(record);
    memory.version += 1;
    await this.save(clientSlug, memory);
    return record;
  }

  async updateStakeholder(
    clientSlug: string,
    stakeholderId: string,
    updates: Partial<Pick<StakeholderRecord, 'name' | 'role' | 'email' | 'notes'>>,
  ): Promise<void> {
    const memory = await this.get(clientSlug);
    if (!memory) return;

    const record = memory.stakeholders.find((s) => s.id === stakeholderId);
    if (!record) return;

    Object.assign(record, updates);
    record.lastSeenAt = new Date().toISOString();
    memory.version += 1;
    await this.save(clientSlug, memory);
  }

  async removeStakeholder(clientSlug: string, stakeholderId: string): Promise<void> {
    const memory = await this.get(clientSlug);
    if (!memory) return;

    memory.stakeholders = memory.stakeholders.filter((s) => s.id !== stakeholderId);
    memory.version += 1;
    await this.save(clientSlug, memory);
  }

  async upsertStakeholder(
    clientSlug: string,
    stakeholder: Omit<StakeholderRecord, 'id' | 'sourceEngagements' | 'lastSeenAt'>,
  ): Promise<StakeholderRecord> {
    const memory = await this.get(clientSlug);
    if (!memory) throw new Error(`Client "${clientSlug}" not found`);

    const now = new Date().toISOString();
    const existing = memory.stakeholders.find(
      (s) => s.name.toLowerCase() === stakeholder.name.toLowerCase(),
    );

    if (existing) {
      existing.role = stakeholder.role;
      if (stakeholder.email) existing.email = stakeholder.email;
      if (stakeholder.notes) existing.notes = stakeholder.notes;
      existing.lastSeenAt = now;
      memory.version += 1;
      await this.save(clientSlug, memory);
      return existing;
    }

    const record: StakeholderRecord = {
      id: crypto.randomUUID(),
      ...stakeholder,
      sourceEngagements: [],
      lastSeenAt: now,
    };
    memory.stakeholders.push(record);
    memory.version += 1;
    await this.save(clientSlug, memory);
    return record;
  }
}

function compoundConfidence(existing: number, incoming: number): number {
  return Math.min(0.99, existing + (1 - existing) * incoming * 0.5);
}
