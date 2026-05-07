/**
 * unified-extractor.ts — single LLM call replacing 3 sequential calls.
 *
 * One prompt returns preprocessed summary, structured requirements, and
 * knowledge entries in a single JSON object. Fallback: if JSON parsing fails,
 * runs requirements + knowledge in parallel using the existing extractors.
 *
 * Gated by INGEST_UNIFIED_LLM (default: true). Set to 'false' to fall back
 * to the 3-call pipeline.
 */

import type {
  DocumentType,
  DocumentClassification,
  RequirementKey,
  KnowledgeEntry,
  KnowledgeCategory,
  RequirementField,
} from '../chat/context.types.js';
import type { LLMGenerateFn } from './document-preprocessor.js';
import type { PreprocessedDocument } from './document-preprocessor.js';
import { extractRequirementsFromPreprocessed } from './requirement-extractor.js';
import { extractKnowledge } from './knowledge-extractor.js';
import { VALID_REQUIREMENT_KEYS } from './requirement-extractor.js';
import { VALID_KNOWLEDGE_CATEGORIES } from './knowledge-extractor.js';
import { randomUUID } from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────

export interface UnifiedExtractionResult {
  preprocessed: {
    cleanedSections: string[];
    participants: string[];
    actionItems: string[];
    noiseRatio: number;
  };
  requirements: Partial<Record<RequirementKey, RequirementField<unknown>>>;
  knowledge: KnowledgeEntry[];
  warnings: string[];
}

// ── Confidence caps ───────────────────────────────────────────────

const CONFIDENCE_CAP: Record<DocumentType, number> = {
  rfp: 0.85,
  technical_spec: 0.85,
  meeting_transcript: 0.6,
  email: 0.7,
  proposal_draft: 0.75,
  generic: 0.65,
};

// ── Main export ───────────────────────────────────────────────────

export async function unifiedExtract(
  excerpt: string,
  docType: DocumentType,
  classification: DocumentClassification | undefined,
  llmFn: LLMGenerateFn,
): Promise<UnifiedExtractionResult> {
  const warnings: string[] = [];

  try {
    const raw = await llmFn(buildUnifiedPrompt(excerpt, docType, classification));
    return parseUnifiedResult(raw, docType, classification ?? 'client_source', warnings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`Unified LLM call failed (${msg}) — falling back to parallel extraction`);
    console.warn('[UnifiedExtractor] falling back to parallel extraction:', err);
    return fallbackExtraction(excerpt, docType, classification, llmFn, warnings);
  }
}

// ── Prompt builder ────────────────────────────────────────────────

function buildUnifiedPrompt(
  excerpt: string,
  docType: DocumentType,
  classification: DocumentClassification | undefined,
): string {
  const confidenceCap = CONFIDENCE_CAP[docType] ?? 0.65;
  const classNote = classification ? `classified as "${classification}"` : '';

  return `You are analyzing a ${docType} document${classNote ? ' ' + classNote : ''}.

DOCUMENT:
${excerpt}

Return a single JSON object with exactly these three top-level keys: "preprocessed", "requirements", "knowledge".

{
  "preprocessed": {
    "cleanedSections": ["<key section summary>"],
    "participants": ["<name - role>"],
    "actionItems": ["<action item text>"],
    "noiseRatio": 0.0
  },
  "requirements": {
    "clientName":     { "value": "...", "confidence": 0.0 } | null,
    "clientIndustry": { "value": "...", "confidence": 0.0 } | null,
    "projectType":    { "value": "...", "confidence": 0.0 } | null,
    "budget":         { "value": "...", "confidence": 0.0 } | null,
    "timeline":       { "value": "...", "confidence": 0.0 } | null,
    "teamSize":       { "value": 0,    "confidence": 0.0 } | null,
    "contactName":    { "value": "...", "confidence": 0.0 } | null,
    "keyObjectives":  { "value": [...], "confidence": 0.0 } | null,
    "technicalStack": { "value": [...], "confidence": 0.0 } | null,
    "constraints":    { "value": [...], "confidence": 0.0 } | null,
    "deliverables":   { "value": [...], "confidence": 0.0 } | null,
    "stakeholders":   { "value": [...], "confidence": 0.0 } | null
  },
  "knowledge": [
    {
      "content": "...",
      "category": "priority|requirement|problem|preference|constraint|context|decision|action_item|metric|opportunity",
      "importance": 1,
      "confidence": 0.0
    }
  ]
}

Rules:
- Return null for any requirements field not found in the document — never guess
- clientIndustry = the client's business domain (e.g. "Parks & Recreation"), NOT the project type
- projectType = the service being delivered (e.g. "Website Redesign"), NOT the client's industry
- Max 25 knowledge entries — prioritize by importance (1–5, 5 = most important)
- Confidence max for this document type: ${confidenceCap}
- Exclude from knowledge: small talk, audio issues, personal trivia, scheduling logistics
- participants and actionItems are only relevant for meeting transcripts — leave empty arrays for other types
- Return ONLY the JSON object — no preamble, no explanation, no markdown fences`;
}

// ── Result parser ─────────────────────────────────────────────────

function parseUnifiedResult(
  raw: string,
  docType: DocumentType,
  classification: DocumentClassification,
  warnings: string[],
): UnifiedExtractionResult {
  const confidenceCap = CONFIDENCE_CAP[docType] ?? 0.65;
  const now = new Date().toISOString();

  // Strip markdown code fences if present
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    cleaned = fenceMatch[1].trim();
  }
  // Find the first complete JSON object
  const objStart = cleaned.indexOf('{');
  if (objStart > 0) cleaned = cleaned.slice(objStart);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`JSON parse failed on unified LLM response`);
  }

  // Map requirements
  const requirements: Partial<Record<RequirementKey, RequirementField<unknown>>> = {};
  const rawReqs = parsed.requirements ?? {};
  for (const key of VALID_REQUIREMENT_KEYS) {
    const entry = rawReqs[key];
    if (!entry || entry.value === null || entry.value === undefined) continue;
    const conf = Math.min(typeof entry.confidence === 'number' ? entry.confidence : 0, confidenceCap);
    if (conf <= 0) continue;
    requirements[key] = {
      value: entry.value,
      confidence: conf,
      source: 'document',
      updatedAt: now,
    };
  }

  // Map knowledge
  const rawKnowledge: unknown[] = Array.isArray(parsed.knowledge) ? parsed.knowledge : [];
  const knowledge: KnowledgeEntry[] = rawKnowledge
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e: any) => typeof e.content === 'string' && e.content.trim().length > 10)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any): KnowledgeEntry => ({
      id: randomUUID(),
      content: e.content,
      category: VALID_KNOWLEDGE_CATEGORIES.includes(e.category as KnowledgeCategory)
        ? (e.category as KnowledgeCategory)
        : 'context',
      importance: typeof e.importance === 'number' ? Math.min(5, Math.max(1, Math.round(e.importance))) : 3,
      confidence: Math.min(typeof e.confidence === 'number' ? e.confidence : 0.5, confidenceCap),
      source: { type: 'document' as const, fileName: '' },
      extractedAt: now,
    }))
    .slice(0, 25);

  // Map preprocessed
  const pp = parsed.preprocessed ?? {};
  const preprocessed = {
    cleanedSections: Array.isArray(pp.cleanedSections) ? pp.cleanedSections.filter(Boolean) : [],
    participants: Array.isArray(pp.participants) ? pp.participants.filter(Boolean) : [],
    actionItems: Array.isArray(pp.actionItems) ? pp.actionItems.filter(Boolean) : [],
    noiseRatio: typeof pp.noiseRatio === 'number' ? pp.noiseRatio : 0,
  };

  return { preprocessed, requirements, knowledge, warnings };
}

// ── Fallback path ─────────────────────────────────────────────────

async function fallbackExtraction(
  excerpt: string,
  docType: DocumentType,
  classification: DocumentClassification | undefined,
  llmFn: LLMGenerateFn,
  warnings: string[],
): Promise<UnifiedExtractionResult> {
  // Build a minimal PreprocessedDocument from the excerpt for the legacy extractors
  const minimalPreprocessed: PreprocessedDocument = {
    originalType: docType,
    sections: [{
      topic: 'Document',
      summary: excerpt.slice(0, 3000),
      keyFacts: [],
      decisions: [],
      openQuestions: [],
      sentiment: 'neutral',
      relevantQuotes: [],
    }],
    participants: [],
    actionItems: [],
    rawLength: excerpt.split(/\s+/).length,
    cleanedLength: excerpt.split(/\s+/).length,
    noiseRatio: 0,
  };

  // Run requirements and knowledge in parallel (still faster than original 3-call chain)
  const [extractionResult, knowledgeResult] = await Promise.all([
    extractRequirementsFromPreprocessed(minimalPreprocessed, docType, llmFn),
    extractKnowledge(minimalPreprocessed, docType, '', llmFn, excerpt),
  ]);

  warnings.push(...knowledgeResult.warnings);

  return {
    preprocessed: {
      cleanedSections: [excerpt.slice(0, 1000)],
      participants: [],
      actionItems: [],
      noiseRatio: 0,
    },
    requirements: extractionResult.fields,
    knowledge: knowledgeResult.entries,
    warnings,
  };
}

// ── Mapper for orchestrator ───────────────────────────────────────

/** Convert UnifiedExtractionResult.preprocessed back to PreprocessedDocument shape. */
export function buildPreprocessedFromUnified(result: UnifiedExtractionResult): PreprocessedDocument {
  return {
    originalType: 'generic',
    sections: result.preprocessed.cleanedSections.map((s, i) => ({
      topic: `Section ${i + 1}`,
      summary: s,
      keyFacts: [],
      decisions: [],
      openQuestions: [],
      sentiment: 'neutral' as const,
      relevantQuotes: [],
    })),
    participants: result.preprocessed.participants.map((p) => ({
      name: p,
      role: '',
      organization: '',
      inferredFrom: 'unified-extraction',
    })),
    actionItems: result.preprocessed.actionItems.map((a) => ({
      owner: '',
      action: a,
      status: 'open' as const,
    })),
    rawLength: 0,
    cleanedLength: result.preprocessed.cleanedSections.join(' ').split(/\s+/).length,
    noiseRatio: result.preprocessed.noiseRatio,
  };
}
