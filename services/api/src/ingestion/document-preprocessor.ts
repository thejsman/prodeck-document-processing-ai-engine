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

export async function preprocessDocument(
  _fileName: string,
  content: string,
  docType: DocumentType,
  llmFn: LLMGenerateFn,
): Promise<PreprocessedDocument> {
  const rawLength = content.split(/\s+/).length;
  const promptFn = PREPROCESS_PROMPTS[docType];

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
    // Never fail ingestion: return a single section with the first 500 chars of raw content
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

  const cleanedLength = validatedDoc.sections.reduce(
    (sum, s) =>
      sum + s.summary.split(/\s+/).length + (s.keyFacts.join(' ') || '').split(/\s+/).length,
    0,
  );
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
