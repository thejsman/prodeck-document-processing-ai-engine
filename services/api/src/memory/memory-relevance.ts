import { DocumentMemoryService } from './document-memory.service.js';
import type { MemoryFileEntry } from './document-memory.types.js';

export interface RelevantMemoryDoc {
  entry: MemoryFileEntry;
  markdown: string;
}

// One entry per item in the client's memory index. `include` is always true
// here — there is no automatic relevance judgment anymore (see
// selectRelevantMemory below); every entry starts pre-checked and the user
// decides what actually goes in via the confirmation checklist. `reason`
// holds the entry's own stored description, not a computed verdict.
export interface RelevanceDecision {
  id: string;
  fileName: string;
  type: string;
  include: boolean;
  reason: string;
}

export interface RelevantMemorySelection {
  included: RelevantMemoryDoc[];
  decisions: RelevanceDecision[];
}

const DESCRIPTION_PREVIEW_CHARS = 140;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

/**
 * Lists every entry in the client's memory folder as a selectable candidate
 * — no LLM call, no automatic relevant/not-relevant judgment. That layer
 * used to rank entries against the message, but a single bad distilled fact
 * (e.g. a chat-derived note wrongly linking this client to an unrelated
 * one) could poison the verdict and silently pull irrelevant content into a
 * generation, or exclude something that mattered, with no way to catch it
 * before the fact. Instead every entry starts pre-checked with its own
 * description shown so the user — not a model guessing from a one-line
 * summary — decides what actually goes into the prompt.
 */
export async function selectRelevantMemory(
  workdir: string,
  clientSlug: string,
): Promise<RelevantMemorySelection> {
  const service = new DocumentMemoryService(workdir);
  const index = await service.readIndex(clientSlug);
  if (index.length === 0) return { included: [], decisions: [] };

  const decisions: RelevanceDecision[] = index.map((e) => ({
    id: e.id,
    fileName: e.fileName,
    type: e.type,
    include: true,
    reason: truncate(e.description, DESCRIPTION_PREVIEW_CHARS),
  }));

  const docs = await Promise.all(
    index.map(async (entry) => ({
      entry,
      markdown: (await service.getFileContent(clientSlug, entry.id)) ?? '',
    })),
  );

  return { included: docs.filter((d) => d.markdown.trim().length > 0), decisions };
}

/**
 * Re-fetches specific memory entries by id, in index order, skipping any
 * that no longer exist. Used to resume a generation once the user has
 * confirmed (or edited) their selection from the checklist.
 */
export async function getMemoryDocsByIds(
  workdir: string,
  clientSlug: string,
  ids: string[],
): Promise<RelevantMemoryDoc[]> {
  if (ids.length === 0) return [];
  const service = new DocumentMemoryService(workdir);
  const index = await service.readIndex(clientSlug);
  const idSet = new Set(ids);
  const entries = index.filter((e) => idSet.has(e.id));
  const docs = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      markdown: (await service.getFileContent(clientSlug, entry.id)) ?? '',
    })),
  );
  return docs.filter((d) => d.markdown.trim().length > 0);
}
