import type { DocumentType, DocumentClassification, RequirementKey, KnowledgeEntry, MeetingSummary, RequirementField, ContextSource } from '../chat/context.types.js';
import type { ContextService } from '../chat/context.service.js';
import type { LLMGenerateFn } from './document-preprocessor.js';
import { detectDocumentType } from './document-type-detector.js';
import { preprocessDocument } from './document-preprocessor.js';
import { validatePreprocessedDocument } from './preprocessor-validator.js';
import { extractRequirementsFromPreprocessed } from './requirement-extractor.js';
import { extractKnowledge } from './knowledge-extractor.js';
import { validateExtractionResults } from './extraction-validator.js';
import { extractSmartExcerpt } from './smart-excerptors.js';
import { unifiedExtract, buildPreprocessedFromUnified } from './unified-extractor.js';
import { emitIngestionProgress } from '../execution-events.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestionStats {
  rawWordCount: number;
  cleanedWordCount: number;
  sectionsFound: number;
  participantsFound: number;
  actionItemsFound: number;
}

export interface IngestionResult {
  fileName: string;
  documentType: DocumentType;
  detectionConfidence: number;
  fieldsExtracted: string[];
  knowledgeEntriesCreated: number;
  preprocessingStats: IngestionStats;
  validationErrors: string[];
  warnings: string[];
  durationMs: number;
  /** Raw extracted fields — populated when deferConfirmation=true so the worker can store them. */
  extractedFields: Partial<Record<RequirementKey, RequirementField<unknown>>>;
  /** Raw knowledge entries — populated when deferConfirmation=true. */
  knowledgeEntries: KnowledgeEntry[];
  /** Raw meeting summary — populated when deferConfirmation=true and document is a transcript. */
  meetingSummaryResult?: MeetingSummary;
  /** The context source record that should be written on confirmation (when deferConfirmation=true). */
  pendingContextSource?: ContextSource;
}

/**
 * Injected FAISS indexing function. Caller wires the real implementation.
 * Signature matches faissIndexService.index() from the existing runtime.
 */
export type FaissIndexFn = (
  namespace: string,
  fileName: string,
  content: string,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Runs all 8 steps of the ingestion pipeline for a single document (spec section 3.10).
 *
 * Steps:
 *   1. detectDocumentType
 *   2. preprocessDocument (LLM)
 *   3. validatePreprocessedDocument
 *   4. extractRequirementsFromPreprocessed (LLM)
 *   5. extractKnowledge (LLM)
 *   6. validateExtractionResults
 *   7. contextService.mergeRequirements + contextService.mergeKnowledge
 *   8. faissIndexFn (existing FAISS indexing — injected, not reimplemented)
 *
 * If any LLM step fails, a warning is logged and ingestion continues with
 * whatever partial results are available. Ingestion is never blocked.
 */
/** Classifications that prevent facts from being written to the Brief. */
const BRIEF_EXCLUDED: Set<DocumentClassification> = new Set([
  'provider_asset',
  'reference_example',
]);

export async function processDocument(
  namespace: string,
  fileName: string,
  content: string,
  llmFn: LLMGenerateFn,
  contextService: ContextService,
  faissIndexFn?: FaissIndexFn,
  classification?: DocumentClassification,
  deferConfirmation?: boolean,
): Promise<IngestionResult> {
  const startTime = Date.now();
  const warnings: string[] = [];

  // Step 1: Detect document type (deterministic)
  const detection = detectDocumentType(fileName, content);

  let validFields: Partial<Record<RequirementKey, RequirementField<unknown>>>;
  let validKnowledge: KnowledgeEntry[];
  let validMeetingSummary: MeetingSummary | undefined;
  let preprocessed: import('./document-preprocessor.js').PreprocessedDocument;

  const useUnified = process.env.INGEST_UNIFIED_LLM !== 'false';

  if (useUnified) {
    // ── Unified path (Steps 2–5 collapsed into one LLM call) ────────
    emitIngestionProgress({ stage: 'excerpting', fileName, namespace: '' });
    const excerpt = extractSmartExcerpt(content, detection.type);

    emitIngestionProgress({ stage: 'extracting', fileName, namespace: '' });
    const unified = await unifiedExtract(excerpt, detection.type, classification, llmFn);
    warnings.push(...unified.warnings);

    preprocessed = buildPreprocessedFromUnified(unified);

    // Stamp fileName on knowledge entries (unified-extractor uses '' as placeholder)
    for (const entry of unified.knowledge) {
      (entry.source as { type: string; fileName: string }).fileName = fileName;
    }

    // Step 6 (validate) using unified outputs
    const validated = validateExtractionResults(unified.requirements, unified.knowledge);
    validFields = validated.validFields;
    validKnowledge = validated.validKnowledge;
    validMeetingSummary = validated.validMeetingSummary;
    if (validated.errors.length > 0) {
      warnings.push(...validated.errors.map((e) => `Validation: ${e}`));
    }
  } else {
    // ── Legacy 3-call path (preserved when INGEST_UNIFIED_LLM=false) ─
    // Step 2: Preprocess (LLM — type-specific prompt, with internal fallback)
    preprocessed = await preprocessDocument(fileName, content, detection.type, llmFn);

    // Step 3: Validate preprocessing output (deterministic — warn, never block)
    const ppValidation = validatePreprocessedDocument(preprocessed);
    if (!ppValidation.valid) {
      const msg = `Preprocessing validation failed: ${ppValidation.errors.join('; ')}`;
      console.warn(`[IngestOrchestrator] ${fileName}: ${msg}`);
      warnings.push(msg);
    }
    if (preprocessed.sections.length === 0) {
      warnings.push('Preprocessing produced 0 sections — fallback content used');
    }
    const cleanDoc = ppValidation.document
      ? {
          ...preprocessed,
          sections: ppValidation.document.sections,
          participants: ppValidation.document.participants.length > 0
            ? ppValidation.document.participants
            : preprocessed.participants,
          actionItems: ppValidation.document.actionItems,
        }
      : preprocessed;

    // Steps 4 + 5: Run in parallel
    const [extraction, knowledgeResult] = await Promise.all([
      extractRequirementsFromPreprocessed(cleanDoc, detection.type, llmFn),
      extractKnowledge(cleanDoc, detection.type, fileName, llmFn, content),
    ]);
    const { entries: knowledge, warnings: knowledgeWarnings } = knowledgeResult;
    warnings.push(...knowledgeWarnings);

    // Step 6: Validate extraction outputs (deterministic)
    const validated = validateExtractionResults(extraction.fields, knowledge, extraction.meetingSummary);
    validFields = validated.validFields;
    validKnowledge = validated.validKnowledge;
    validMeetingSummary = validated.validMeetingSummary;
    if (validated.errors.length > 0) {
      warnings.push(...validated.errors.map((e) => `Validation: ${e}`));
    }
  }

  // Step 7: Merge into namespace context (deterministic)
  // Provider assets and reference examples never write facts to the Brief.
  const briefExcluded = classification !== undefined && BRIEF_EXCLUDED.has(classification);
  const contextSource = {
    fileName,
    documentType: detection.type,
    extractedAt: new Date().toISOString(),
    fieldsExtracted: briefExcluded ? [] as RequirementKey[] : Object.keys(validFields) as RequirementKey[],
    knowledgeEntriesCreated: briefExcluded ? 0 : validKnowledge.length,
    preprocessConfidence: detection.confidence,
    warnings: warnings.length > 0 ? [...warnings] : undefined,
    classification,
  };

  if (deferConfirmation) {
    // When EXTRACTION_CONFIRMATION=true: skip all writes. The worker stores
    // the raw data in the pending cache and emits extraction_ready SSE.
    // Nothing touches context.json until the user confirms.
  } else if (!briefExcluded) {
    // Store as pending confirmation so the user sees an extraction card in chat
    await contextService.storePendingExtraction(namespace, fileName, validFields, contextSource);
    await contextService.mergeKnowledge(namespace, validKnowledge);
    if (validMeetingSummary) {
      await contextService.mergeMeetingSummary(namespace, {
        ...validMeetingSummary,
        sourceFile: fileName,
      });
    }
  } else {
    // Still record that this document was processed, but write no facts
    const current = await contextService.get(namespace);
    if (current) {
      current.sources.push(contextSource);
      current.version += 1;
      current.updatedAt = new Date().toISOString();
      await contextService.save(namespace, current);
    }
  }

  // --- Industry-aware custom field extraction (additive) ---
  // If the namespace has an industry detected, try to extract industry-specific
  // custom fields from the document content.
  try {
    const context = await contextService.get(namespace);
    const industryId = context?.industryContext?.industryId;
    if (industryId) {
      const { getActiveSchema } = await import('../chat/industry-schema.js');
      const schema = getActiveSchema(industryId, context?.engagementType ?? null);
      const missingFields = schema.allFields.filter(f => {
        const existing = context?.requirements?.customFields?.[f.key];
        return !existing?.value;
      });

      if (missingFields.length > 0) {
        const fieldDescriptions = missingFields
          .slice(0, 10)
          .map(f => `- ${f.key}: ${f.label} (${f.valueType})`)
          .join('\n');

        const customExtractionPrompt = `Extract these industry-specific fields from the document if present. Return null for any field not found.

Fields to extract:
${fieldDescriptions}

Document excerpt:
${content.slice(0, 4000)}

Return ONLY a JSON object with the field keys and their values (or null). No explanation.`;

        try {
          const raw = await llmFn(customExtractionPrompt);
          const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
          const parsed = JSON.parse(cleaned.match(/\{[\s\S]*\}/)?.[0] ?? '{}');

          const now = new Date().toISOString();
          const customFields: Record<string, RequirementField<string>> = {};

          for (const [key, value] of Object.entries(parsed)) {
            if (value === null || value === undefined) continue;
            const fieldDef = missingFields.find(f => f.key === key);
            if (!fieldDef) continue;
            const strValue = Array.isArray(value) ? value.join(', ') : String(value);
            if (!strValue || strValue === 'null') continue;

            const confidenceCap = detection.type === 'rfp' ? 0.8 : detection.type === 'meeting_transcript' ? 0.55 : 0.6;
            customFields[key] = {
              value: strValue,
              confidence: confidenceCap,
              source: 'document',
              updatedAt: now,
              sourceFile: fileName,
            };
          }

          if (Object.keys(customFields).length > 0) {
            await contextService.mergeCustomFields(namespace, customFields);
          }
        } catch (extractErr) {
          console.warn('[IngestOrchestrator] Custom field extraction failed (non-fatal):', extractErr);
        }
      }
    }
  } catch (err) {
    console.warn('[IngestOrchestrator] Industry-aware extraction skipped:', err);
  }

  // Step 8: FAISS indexing (existing — injected, not reimplemented)
  if (faissIndexFn) {
    try {
      await faissIndexFn(namespace, fileName, content);
    } catch (err) {
      console.warn(`[IngestOrchestrator] FAISS indexing failed for ${fileName}:`, err);
    }
  }

  return {
    fileName,
    documentType: detection.type,
    detectionConfidence: detection.confidence,
    fieldsExtracted: Object.keys(validFields),
    knowledgeEntriesCreated: validKnowledge.length,
    preprocessingStats: {
      rawWordCount: preprocessed.rawLength,
      cleanedWordCount: preprocessed.cleanedLength,
      sectionsFound: preprocessed.sections.length,
      participantsFound: preprocessed.participants?.length ?? 0,
      actionItemsFound: preprocessed.actionItems.length,
    },
    validationErrors: [],
    warnings,
    durationMs: Date.now() - startTime,
    extractedFields: validFields,
    knowledgeEntries: validKnowledge,
    meetingSummaryResult: validMeetingSummary,
    pendingContextSource: deferConfirmation ? contextSource : undefined,
  };
}
