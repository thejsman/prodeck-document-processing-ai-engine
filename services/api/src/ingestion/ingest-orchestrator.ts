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

  // Step 1: Detect document type (deterministic)
  const detection = detectDocumentType(fileName, content);

  // Step 2: Preprocess (LLM — type-specific prompt, with internal fallback)
  const preprocessed = await preprocessDocument(fileName, content, detection.type, llmFn);

  // Step 3: Validate preprocessing output (deterministic — warn, never block)
  const ppValidation = validatePreprocessedDocument(preprocessed);
  if (!ppValidation.valid) {
    console.warn(`[IngestOrchestrator] Preprocessing validation failed for ${fileName}:`, ppValidation.errors);
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

  // Step 4: Extract structured requirements from cleaned content (LLM)
  const extraction = await extractRequirementsFromPreprocessed(cleanDoc, detection.type, llmFn);

  // Step 5: Extract knowledge entries from cleaned content (LLM)
  const knowledge = await extractKnowledge(cleanDoc, detection.type, fileName, llmFn);

  // Step 6: Validate extraction outputs (deterministic)
  const { validFields, validKnowledge, errors } = validateExtractionResults(
    extraction.fields,
    knowledge,
  );

  // Step 7: Merge into namespace context (deterministic)
  await contextService.mergeRequirements(namespace, validFields, {
    fileName,
    documentType: detection.type,
    extractedAt: new Date().toISOString(),
    fieldsExtracted: Object.keys(validFields) as RequirementKey[],
    knowledgeEntriesCreated: validKnowledge.length,
    preprocessConfidence: detection.confidence,
  });
  await contextService.mergeKnowledge(namespace, validKnowledge);

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
    durationMs: Date.now() - startTime,
  };
}
