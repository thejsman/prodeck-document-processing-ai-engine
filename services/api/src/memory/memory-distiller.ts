import type { NamespaceContext } from '../chat/context.types.js';
import type { ClientMemory, DistillationResult } from './client-memory.types.js';
import { llmGenerateFn } from '../agent-routes.js';

export async function distill(
  context: NamespaceContext,
  existingMemory: ClientMemory,
): Promise<DistillationResult> {
  const prompt = buildPrompt(context, existingMemory);
  const raw = await llmGenerateFn(prompt);
  return parseResult(raw);
}

function buildPrompt(context: NamespaceContext, memory: ClientMemory): string {
  const existingKnowledge = memory.knowledge
    .filter((k) => !k.supersededBy)
    .map((k) => `  [${k.id}] (${k.category}) ${k.content}`)
    .join('\n');

  return `You are distilling what was learned about a client from a completed engagement into a persistent memory record.

ENGAGEMENT CONTEXT:
${JSON.stringify(context, null, 2)}

EXISTING MEMORY KNOWLEDGE ENTRIES (empty = first engagement for this client):
${existingKnowledge || '(none)'}

YOUR TASK:
Extract facts that are stable and likely to apply to future engagements with this client.

RULES:
- Include: preferences, standing constraints, stakeholder relationships, company-level facts
- Exclude: budget, timeline, project type, deliverables, anything project-specific
- For each knowledge entry, mark if it CONFIRMS an existing entry (by existingId), CONTRADICTS one, or is NEW
- Deduplicate — if incoming says the same as an existing entry, mark as confirmed, do not duplicate
- Flag contradictions for user review — do not silently overwrite

Respond in JSON only (no markdown, no code fences):
{
  "stableFields": {
    "clientName": { "value": "string", "confidence": 0.0 },
    "clientIndustry": { "value": "string", "confidence": 0.0 },
    "contactName": { "value": "string", "confidence": 0.0 }
  },
  "newKnowledge": [
    { "content": "string", "category": "preference|constraint|relationship|context", "confidence": 0.0 }
  ],
  "confirmedKnowledge": [
    { "existingId": "string", "confidence": 0.0 }
  ],
  "contradictions": [
    { "existingId": "string", "incomingContent": "string", "reason": "string" }
  ],
  "stakeholders": [
    { "name": "string", "role": "string", "notes": "string", "email": "string" }
  ]
}

Only include stableFields entries when a value was actually found in the context. Omit fields you cannot confidently determine.`;
}

function parseResult(raw: string): DistillationResult {
  const cleaned = raw
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Memory distillation returned invalid JSON: ${cleaned.slice(0, 200)}`,
    );
  }

  const r = parsed as Record<string, unknown>;

  return {
    stableFields:
      (r.stableFields as DistillationResult['stableFields']) ?? {},
    newKnowledge: Array.isArray(r.newKnowledge)
      ? (r.newKnowledge as DistillationResult['newKnowledge'])
      : [],
    confirmedKnowledge: Array.isArray(r.confirmedKnowledge)
      ? (r.confirmedKnowledge as DistillationResult['confirmedKnowledge'])
      : [],
    contradictions: Array.isArray(r.contradictions)
      ? (r.contradictions as DistillationResult['contradictions'])
      : [],
    stakeholders: Array.isArray(r.stakeholders)
      ? (r.stakeholders as DistillationResult['stakeholders'])
      : [],
  };
}
