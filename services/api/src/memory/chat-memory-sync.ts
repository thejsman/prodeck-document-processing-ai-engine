import type { FastifyBaseLogger } from 'fastify';
import { llmGenerateFn } from '../agent-routes.js';
import type { ClientMemory } from './client-memory.types.js';
import { DocumentMemoryService } from './document-memory.service.js';

function safeParseJSON<T>(raw: string): T | null {
  const stripped = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Re-renders memory.json's knowledge[] into a single, relevance-scannable
 * chat.md memory file. memory.json stays the structured source of truth
 * (read by the UI, namespace creation, and document generation) — this is a
 * derived rendering that exists only so the chat relevance scanner has a
 * description to scan alongside uploaded docs and site-crawl knowledge.
 * Never throws — callers already treat memory work as best-effort.
 */
export async function syncChatMemory(
  workdir: string,
  clientSlug: string,
  memory: ClientMemory,
  log: FastifyBaseLogger,
): Promise<void> {
  const knowledge = memory.knowledge.filter((k) => !k.supersededBy);
  if (knowledge.length === 0) return;

  const knowledgeBlock = knowledge.map((k) => `- [${k.category}] ${k.content}`).join('\n');

  const prompt = `You are organizing a client's accumulated chat knowledge into one clean reference document.
Given this list of extracted facts about "${memory.clientName}", produce:
1. "description": a 1-3 sentence summary of what this document covers.
2. "body": a well-organized markdown document grouping the facts by theme (e.g. Requirements, Preferences, Constraints, Decisions, Context) with clear headings. This is a reorganization only — do not invent anything beyond the facts listed below.

FACTS:
${knowledgeBlock}

Return ONLY valid JSON: { "description": "...", "body": "..." }`;

  let description = `Chat-derived knowledge about ${memory.clientName} (${knowledge.length} facts).`;
  let markdown = `# Chat Knowledge — ${memory.clientName}\n\n${knowledgeBlock}`;

  try {
    const raw = await llmGenerateFn(prompt);
    const parsed = safeParseJSON<{ description?: string; body?: string }>(raw);
    if (parsed?.body) {
      description = parsed.description || description;
      markdown = parsed.body;
    }
  } catch (err) {
    log.warn({ err, clientSlug }, '[SuperClient] chat memory rewrite failed — using deterministic fallback');
  }

  await new DocumentMemoryService(workdir).upsertFile(clientSlug, {
    id: 'chat',
    type: 'chat',
    fileName: 'chat.md',
    description,
    markdown,
  });
}
