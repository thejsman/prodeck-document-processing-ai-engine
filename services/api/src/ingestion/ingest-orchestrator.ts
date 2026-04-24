import type { DocumentType, RequirementKey } from '../chat/context.types.js';
import type { ContextService } from '../chat/context.service.js';
import type { LLMGenerateFn } from './document-preprocessor.js';
import { detectDocumentType } from './document-type-detector.js';
import { preprocessDocument } from './document-preprocessor.js';
import { validatePreprocessedDocument } from './preprocessor-validator.js';
import { extractRequirementsFromPreprocessed } from './requirement-extractor.js';
import { extractKnowledge } from './knowledge-extractor.js';
import { validateExtractionResults } from './extraction-validator.js';

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
export async function processDocument(
  namespace: string,
  fileName: string,
  content: string,
  llmFn: LLMGenerateFn,
  contextService: ContextService,
  faissIndexFn?: FaissIndexFn,
): Promise<IngestionResult> {
  const startTime = Date.now();
  const warnings: string[] = [];

  // Step 1: Detect document type (deterministic)
  const detection = detectDocumentType(fileName, content);

  // Step 2: Preprocess (LLM — type-specific prompt, with internal fallback)
  const preprocessed = await preprocessDocument(fileName, content, detection.type, llmFn);

  // Step 3: Validate preprocessing output (deterministic — warn, never block)
  const ppValidation = validatePreprocessedDocument(preprocessed);
  if (!ppValidation.valid) {
    const msg = `Preprocessing validation failed: ${ppValidation.errors.join('; ')}`;
    console.warn(`[IngestOrchestrator] ${fileName}: ${msg}`);
    warnings.push(msg);
  }
  if (preprocessed.sections.length === 0) {
    warnings.push('Preprocessing produced 0 sections — fallback content used; LLM may have failed or returned invalid JSON');
  }
  // Use validated (defaults-filled) doc if available, otherwise keep what preprocessDocument returned
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

  // Steps 4 + 5: Run in parallel — both depend only on cleanDoc, not on each other
  const [extraction, knowledgeResult] = await Promise.all([
    extractRequirementsFromPreprocessed(cleanDoc, detection.type, llmFn),
    extractKnowledge(cleanDoc, detection.type, fileName, llmFn, content),
  ]);
  const { entries: knowledge, warnings: knowledgeWarnings } = knowledgeResult;
  warnings.push(...knowledgeWarnings);

  // Step 6: Validate extraction outputs (deterministic)
  const { validFields, validKnowledge, validMeetingSummary, errors } = validateExtractionResults(
    extraction.fields,
    knowledge,
    extraction.meetingSummary,
  );
  if (errors.length > 0) {
    warnings.push(...errors.map((e) => `Validation: ${e}`));
  }

  // Step 7: Merge into namespace context (deterministic)
  await contextService.mergeRequirements(namespace, validFields, {
    fileName,
    documentType: detection.type,
    extractedAt: new Date().toISOString(),
    fieldsExtracted: Object.keys(validFields) as RequirementKey[],
    knowledgeEntriesCreated: validKnowledge.length,
    preprocessConfidence: detection.confidence,
    warnings: warnings.length > 0 ? [...warnings] : undefined,
  });
  await contextService.mergeKnowledge(namespace, validKnowledge);
  if (validMeetingSummary) {
    await contextService.mergeMeetingSummary(namespace, {
      ...validMeetingSummary,
      sourceFile: fileName,
    });
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
      sectionsFound: cleanDoc.sections.length,
      participantsFound: cleanDoc.participants?.length ?? 0,
      actionItemsFound: cleanDoc.actionItems.length,
    },
    validationErrors: errors,
    warnings,
    durationMs: Date.now() - startTime,
  };
}
