import type { DocumentType } from '../chat/context.types.js';
import { meetingTranscriptPrompt } from './prompts/meeting-transcript.js';
import { rfpPrompt } from './prompts/rfp.js';
import { technicalSpecPrompt } from './prompts/technical-spec.js';
import { emailPrompt } from './prompts/email.js';
import { genericPrompt } from './prompts/generic.js';
import { validatePreprocessedDocument } from './preprocessor-validator.js';

export type LLMGenerateFn = (prompt: string) => Promise<string>;

export interface Participant {
  name: string;
  role: string;
  organization: string;
  inferredFrom: string;
}

export interface DocumentSection {
  topic: string;
  summary: string;
  keyFacts: string[];
  decisions: string[];
  openQuestions: string[];
  sentiment: 'positive' | 'neutral' | 'concern';
  relevantQuotes: string[];
}

export interface ActionItem {
  owner: string;
  action: string;
  deadline?: string;
  status: 'open' | 'in_progress' | 'done';
}

export interface PreprocessedDocument {
  originalType: DocumentType;
  participants?: Participant[];
  sections: DocumentSection[];
  actionItems: ActionItem[];
  rawLength: number;
  cleanedLength: number;
  noiseRatio: number;
}

const PREPROCESS_PROMPTS: Record<DocumentType, (content: string) => string> = {
  meeting_transcript: meetingTranscriptPrompt,
  rfp: rfpPrompt,
  technical_spec: technicalSpecPrompt,
  email: emailPrompt,
  proposal_draft: genericPrompt,
  generic: genericPrompt,
};

// ---------------------------------------------------------------------------
// Sliding-window constants
// ---------------------------------------------------------------------------

const WINDOW_SIZE_WORDS = 5000;
const OVERLAP_WORDS = 500;
const MAX_WINDOWS = 5; // caps LLM calls — covers up to ~22 500 unique words

// Schema limits from preprocessor-validator.ts
const MAX_SECTIONS = 30;
const MAX_PARTICIPANTS = 20;
const MAX_ACTION_ITEMS = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParseJSON<T>(raw: string): T | null {
  // Strip markdown code fences if the LLM wraps the JSON in them
  const stripped = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    // Try to extract the first JSON object found in the string
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
 * Splits content into overlapping word windows for large-document preprocessing.
 * Returns at most MAX_WINDOWS windows; logs a warning if the document is large
 * enough that some tail content is not covered.
 */
export function splitIntoWindows(
  content: string,
  windowSizeWords = WINDOW_SIZE_WORDS,
  overlapWords = OVERLAP_WORDS,
): string[] {
  const words = content.split(/\s+/).filter(Boolean);

  if (words.length <= windowSizeWords) return [content];

  const stride = windowSizeWords - overlapWords;
  const windows: string[] = [];
  let i = 0;

  while (i < words.length) {
    windows.push(words.slice(i, i + windowSizeWords).join(' '));
    i += stride;
  }

  if (windows.length > MAX_WINDOWS) {
    const uncoveredWords = (windows.length - MAX_WINDOWS) * stride;
    console.warn(
      `[Preprocessor] document has ${windows.length} natural windows but cap is ${MAX_WINDOWS} — ~${uncoveredWords} words in tail not preprocessed`,
    );
    return windows.slice(0, MAX_WINDOWS);
  }

  return windows;
}

function normalizeActionText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function actionIsDuplicate(candidate: ActionItem, seen: ActionItem[]): boolean {
  const cn = normalizeActionText(candidate.action);
  return seen.some((s) => {
    const sn = normalizeActionText(s.action);
    const minLen = Math.min(cn.length, sn.length);
    if (minLen === 0) return cn === sn;
    const prefixLen = Math.floor(minLen * 0.8);
    return cn === sn || cn.startsWith(sn.slice(0, prefixLen)) || sn.startsWith(cn.slice(0, prefixLen));
  });
}

/**
 * Merges PreprocessedDocument results from multiple windows into one document.
 * trueRawLength must be the word count of the original full document.
 */
export function mergePreprocessedWindows(
  windows: PreprocessedDocument[],
  trueRawLength: number,
): PreprocessedDocument {
  // Sections: first-come-first-served up to MAX_SECTIONS
  const sections: DocumentSection[] = [];
  for (const w of windows) {
    for (const s of w.sections) {
      if (sections.length >= MAX_SECTIONS) break;
      sections.push(s);
    }
    if (sections.length >= MAX_SECTIONS) break;
  }

  // Participants: deduplicate by lowercased name, keep first occurrence
  const seenNames = new Set<string>();
  const participants: Participant[] = [];
  for (const w of windows) {
    for (const p of (w.participants ?? [])) {
      const key = p.name.trim().toLowerCase();
      if (!seenNames.has(key)) {
        seenNames.add(key);
        participants.push(p);
      }
      if (participants.length >= MAX_PARTICIPANTS) break;
    }
    if (participants.length >= MAX_PARTICIPANTS) break;
  }

  // Action items: deduplicate by normalized text prefix match
  const actionItems: ActionItem[] = [];
  for (const w of windows) {
    for (const a of w.actionItems) {
      if (actionItems.length >= MAX_ACTION_ITEMS) break;
      if (!actionIsDuplicate(a, actionItems)) {
        actionItems.push(a);
      }
    }
    if (actionItems.length >= MAX_ACTION_ITEMS) break;
  }

  // Stats: sum cleanedLength; weighted-average noiseRatio; true rawLength
  const cleanedLength = windows.reduce((sum, w) => sum + w.cleanedLength, 0);
  const totalWeight = cleanedLength;
  const noiseRatio =
    totalWeight > 0
      ? Math.max(0, Math.min(1, windows.reduce((sum, w) => sum + w.noiseRatio * w.cleanedLength, 0) / totalWeight))
      : 0;

  return {
    originalType: windows[0].originalType,
    participants: participants.length > 0 ? participants : undefined,
    sections,
    actionItems,
    rawLength: trueRawLength,
    cleanedLength,
    noiseRatio,
  };
}

// ---------------------------------------------------------------------------
// computeCleanedLength helper (shared between single and multi-window paths)
// ---------------------------------------------------------------------------

function computeCleanedLength(sections: PreprocessedDocument['sections']): number {
  return sections.reduce(
    (sum, s) =>
      sum + s.summary.split(/\s+/).length + (s.keyFacts.join(' ') || '').split(/\s+/).length,
    0,
  );
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function preprocessDocument(
  _fileName: string,
  content: string,
  docType: DocumentType,
  llmFn: LLMGenerateFn,
): Promise<PreprocessedDocument> {
  const rawLength = content.split(/\s+/).length;
  const promptFn = PREPROCESS_PROMPTS[docType];

  // ---------------------------------------------------------------------------
  // Single-window path (document fits within one LLM call)
  // ---------------------------------------------------------------------------

  if (rawLength <= WINDOW_SIZE_WORDS) {
    let validatedDoc: ReturnType<typeof validatePreprocessedDocument>['document'] | undefined;

    try {
      const raw = await llmFn(promptFn(content));
      const candidate = safeParseJSON<unknown>(raw);
      const validation = validatePreprocessedDocument(candidate);
      if (validation.valid) {
        validatedDoc = validation.document;
      }
    } catch {
      // LLM call failed — fall through to fallback
    }

    if (!validatedDoc) {
      return makeFallback(content, docType, rawLength);
    }

    const cleanedLength = computeCleanedLength(validatedDoc.sections);
    const noiseRatio = rawLength > 0 ? Math.max(0, Math.min(1, 1 - cleanedLength / rawLength)) : 0;

    return {
      originalType: docType,
      participants: validatedDoc.participants.length > 0 ? validatedDoc.participants : undefined,
      sections: validatedDoc.sections,
      actionItems: validatedDoc.actionItems,
      rawLength,
      cleanedLength,
      noiseRatio,
    };
  }

  // ---------------------------------------------------------------------------
  // Multi-window path (large document — sliding window)
  // ---------------------------------------------------------------------------

  const windowStrings = splitIntoWindows(content, WINDOW_SIZE_WORDS, OVERLAP_WORDS);

  console.warn(
    `[Preprocessor] ${_fileName}: splitting ${rawLength}-word document into ${windowStrings.length} windows` +
    ` (${WINDOW_SIZE_WORDS}-word windows, ${OVERLAP_WORDS}-word overlap)`,
  );

  const successfulWindows: PreprocessedDocument[] = [];

  for (let i = 0; i < windowStrings.length; i++) {
    try {
      const raw = await llmFn(promptFn(windowStrings[i]));
      const candidate = safeParseJSON<unknown>(raw);
      const validation = validatePreprocessedDocument(candidate);

      if (validation.valid && validation.document) {
        const windowRawLength = windowStrings[i].split(/\s+/).length;
        const windowCleanedLength = computeCleanedLength(validation.document.sections);
        const windowNoiseRatio =
          windowRawLength > 0
            ? Math.max(0, Math.min(1, 1 - windowCleanedLength / windowRawLength))
            : 0;

        successfulWindows.push({
          originalType: docType,
          participants:
            validation.document.participants.length > 0
              ? validation.document.participants
              : undefined,
          sections: validation.document.sections,
          actionItems: validation.document.actionItems,
          rawLength: windowRawLength,
          cleanedLength: windowCleanedLength,
          noiseRatio: windowNoiseRatio,
        });
      } else {
        console.warn(
          `[Preprocessor] ${_fileName}: window ${i + 1}/${windowStrings.length} failed — invalid JSON / schema validation failed`,
        );
      }
    } catch {
      console.warn(
        `[Preprocessor] ${_fileName}: window ${i + 1}/${windowStrings.length} failed — LLM call failed`,
      );
    }
  }

  if (successfulWindows.length > 0) {
    return mergePreprocessedWindows(successfulWindows, rawLength);
  }

  // All windows failed — fall through to fallback
  return makeFallback(content, docType, rawLength);
}

function makeFallback(content: string, docType: DocumentType, rawLength: number): PreprocessedDocument {
  return {
    originalType: docType,
    sections: [
      {
        topic: 'Full Document',
        summary: content.slice(0, 500),
        keyFacts: [],
        decisions: [],
        openQuestions: [],
        sentiment: 'neutral',
        relevantQuotes: [],
      },
    ],
    actionItems: [],
    rawLength,
    cleanedLength: content.slice(0, 500).split(/\s+/).length,
    noiseRatio: 0,
  };
}
