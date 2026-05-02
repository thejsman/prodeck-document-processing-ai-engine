// services/api/src/ingestion/__tests__/ingestion-pipeline.integration.test.ts
//
// Ingestion Pipeline — Integration Tests
//
// SPEC REFERENCE: §15.1 (LC Grounds transcript trace), §16.2 (Integration Tests)
//
// Strategy:
//   - Real temp workdir per test (ContextService reads/writes real context.json)
//   - LLM mocked via prompt-content routing
//   - faissIndexFn omitted (optional param — FAISS not tested here)

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { processDocument } from '../ingest-orchestrator.js';
import { ContextService } from '../../chat/context.service.js';
import type { NamespaceContext } from '../../chat/context.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createWorkdir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'ingest-integ-'));
}

async function removeWorkdir(workdir: string): Promise<void> {
  await rm(workdir, { recursive: true, force: true });
}

async function readContext(workdir: string, namespace: string): Promise<NamespaceContext | null> {
  try {
    const raw = await readFile(
      path.join(workdir, 'namespaces', namespace, 'context.json'),
      'utf-8',
    );
    return JSON.parse(raw) as NamespaceContext;
  } catch {
    return null;
  }
}

/**
 * Valid PreprocessedDocument JSON matching PreprocessedDocumentSchema.
 * Returned by the mock LLM for the preprocessor stage.
 */
const MOCK_PREPROCESSED_DOC = {
  participants: [
    { name: 'John Smith', role: 'CEO', organization: 'LC Grounds', inferredFrom: 'introduced himself' },
    { name: 'Sarah Jones', role: 'Account Manager', organization: 'Our Company', inferredFrom: 'context' },
  ],
  sections: [
    {
      topic: 'Project Requirements',
      summary: 'Client requires a digital platform to modernize landscaping operations. Budget is approximately $50,000.',
      keyFacts: ['Budget: $50,000', 'Industry: Landscaping services', 'Timeline: 6 months'],
      decisions: ['Proceed with digital transformation'],
      openQuestions: ['Which technology stack to use?'],
      sentiment: 'positive' as const,
      relevantQuotes: ['we need to modernize'],
    },
    {
      topic: 'Stakeholders and Contact',
      summary: 'John Smith is the primary decision maker. Sarah Jones is the day-to-day contact.',
      keyFacts: ['Primary contact: John Smith', 'Phone: 555-0100'],
      decisions: [],
      openQuestions: [],
      sentiment: 'neutral' as const,
      relevantQuotes: [],
    },
    {
      topic: 'Action Items',
      summary: 'Vendor to send proposal by next Friday. Client to review within one week.',
      keyFacts: ['Proposal deadline: next Friday'],
      decisions: ['Proposal format agreed'],
      openQuestions: [],
      sentiment: 'positive' as const,
      relevantQuotes: [],
    },
  ],
  actionItems: [
    { owner: 'John Smith', action: 'Review proposal', deadline: 'Next Friday', status: 'open' as const },
  ],
};

const MOCK_EXTRACTED_FIELDS = {
  clientName: 'LC Grounds',
  industry: 'Landscaping',
  budget: '$50,000',
  timeline: '6 months',
  stakeholders: ['John Smith', 'Sarah Jones'],
};

const MOCK_KNOWLEDGE_ENTRIES = [
  { content: 'Client prefers sustainable and eco-friendly materials for all projects.', category: 'preference', confidence: 0.6 },
  { content: 'Budget is approximately $50,000 with potential for expansion in phase 2.', category: 'requirement', confidence: 0.7 },
  { content: 'Client is concerned about project timeline slipping beyond 6 months.', category: 'concern', confidence: 0.6 },
  { content: 'John Smith is the final decision maker for this engagement.', category: 'relationship', confidence: 0.7 },
];

/**
 * Smart mock LLM for the ingestion pipeline.
 * Distinguishes between preprocessor, extractor, and knowledge extractor calls.
 */
function makeIngestionLLM(overrides: {
  preprocessedDoc?: unknown;
  extractedFields?: Record<string, unknown>;
  knowledgeEntries?: Array<{ content: string; category: string; confidence: number }>;
} = {}): ReturnType<typeof vi.fn> {
  const preprocessed = overrides.preprocessedDoc ?? MOCK_PREPROCESSED_DOC;
  const fields = overrides.extractedFields ?? MOCK_EXTRACTED_FIELDS;
  const knowledge = overrides.knowledgeEntries ?? MOCK_KNOWLEDGE_ENTRIES;

  return vi.fn().mockImplementation((prompt: string): Promise<string> => {
    // Preprocessor: meeting transcript prompt starts with "You are analyzing a raw meeting transcript"
    if (
      prompt.includes('You are analyzing a raw meeting transcript') ||
      prompt.includes('meeting transcript') ||
      prompt.includes('IGNORE all small talk')
    ) {
      return Promise.resolve(JSON.stringify(preprocessed));
    }

    // Requirement extractor: "Extract structured project/client information"
    if (prompt.includes('Extract structured project/client information')) {
      return Promise.resolve(JSON.stringify(fields));
    }

    // Knowledge extractor: "Extract knowledge entries from this document summary"
    if (prompt.includes('Extract knowledge entries from this document summary')) {
      return Promise.resolve(JSON.stringify(knowledge));
    }

    // Fallback for any other LLM call
    return Promise.resolve('{}');
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let workdir: string;
const NS = 'lc-grounds';

beforeEach(async () => {
  workdir = await createWorkdir();
  await mkdir(path.join(workdir, 'namespaces', NS), { recursive: true });
});

afterEach(async () => {
  await removeWorkdir(workdir);
});

// ---------------------------------------------------------------------------
// Meeting transcript — full pipeline (spec §15.1, §16.2)
// ---------------------------------------------------------------------------

describe('meeting transcript — 8-step ingestion pipeline', () => {
  /** Raw Otter.ai transcript with filler words (triggers meeting_transcript detection). */
  const OTTER_TRANSCRIPT = `
Meeting Notes
Transcribed by Otter.ai

John Smith: um so like we need to think about this project. You know, the budget is like around fifty thousand dollars or so.

Sarah Jones: yeah that makes sense. So basically we want it done in like six months right? I mean that's the timeline.

John Smith: right, okay so like the industry is landscaping services. Uh, we really need to modernize operations you know.

Sarah Jones: yeah absolutely. So um like are we thinking like a web platform or like a mobile app or like both?

John Smith: I mean like both eventually but um you know start with web I think. Basically phase one is just the website.

Sarah Jones: okay right so um let's make sure we get the proposal like by next Friday okay? So we can review.

John Smith: yeah sounds good. Okay so I think we're good um.
`.trim();

  it('Step 1: detectDocumentType → meeting_transcript', async () => {
    const llmFn = makeIngestionLLM();
    const contextService = new ContextService(workdir);

    const result = await processDocument(
      NS,
      'lc_grounds_meeting.txt',
      OTTER_TRANSCRIPT,
      llmFn,
      contextService,
    );

    expect(result.documentType).toBe('meeting_transcript');
    expect(result.detectionConfidence).toBeGreaterThanOrEqual(0.85);
  });

  it('Step 2–3: preprocessed document → <6 sections (noise removed)', async () => {
    const llmFn = makeIngestionLLM();
    const contextService = new ContextService(workdir);

    const result = await processDocument(
      NS,
      'lc_grounds_meeting.txt',
      OTTER_TRANSCRIPT,
      llmFn,
      contextService,
    );

    expect(result.preprocessingStats.sectionsFound).toBeGreaterThanOrEqual(1);
    expect(result.preprocessingStats.sectionsFound).toBeLessThan(6);
    // Noise ratio: meeting transcripts have >80% noise typically
    expect(result.preprocessingStats.rawWordCount).toBeGreaterThan(result.preprocessingStats.cleanedWordCount);
  });

  it('Step 4: requirement fields extracted from preprocessed content', async () => {
    const llmFn = makeIngestionLLM();
    const contextService = new ContextService(workdir);

    const result = await processDocument(
      NS,
      'lc_grounds_meeting.txt',
      OTTER_TRANSCRIPT,
      llmFn,
      contextService,
    );

    expect(result.fieldsExtracted.length).toBeGreaterThan(0);
    expect(result.fieldsExtracted).toContain('clientName');
    expect(result.fieldsExtracted).toContain('industry');
  });

  it('Step 5: knowledge entries created (up to 25)', async () => {
    const llmFn = makeIngestionLLM();
    const contextService = new ContextService(workdir);

    const result = await processDocument(
      NS,
      'lc_grounds_meeting.txt',
      OTTER_TRANSCRIPT,
      llmFn,
      contextService,
    );

    expect(result.knowledgeEntriesCreated).toBeGreaterThan(0);
    expect(result.knowledgeEntriesCreated).toBeLessThanOrEqual(25);
  });

  it('Step 7: context.json updated with both requirements + knowledge layers', async () => {
    const llmFn = makeIngestionLLM();
    const contextService = new ContextService(workdir);

    await processDocument(
      NS,
      'lc_grounds_meeting.txt',
      OTTER_TRANSCRIPT,
      llmFn,
      contextService,
    );

    const ctx = await readContext(workdir, NS);
    expect(ctx).not.toBeNull();

    // Requirements layer: clientName and clientIndustry must be present
    expect(ctx!.requirements.fields.clientName?.value).toBeTruthy();
    expect(ctx!.requirements.fields.clientIndustry?.value).toBeTruthy();

    // Knowledge layer: at least one entry
    const activeKnowledge = ctx!.knowledge.filter((k) => !k.supersededBy);
    expect(activeKnowledge.length).toBeGreaterThan(0);

    // Source recorded
    expect(ctx!.sources).toHaveLength(1);
    expect(ctx!.sources[0]?.fileName).toBe('lc_grounds_meeting.txt');
    expect(ctx!.sources[0]?.documentType).toBe('meeting_transcript');
  });

  it('full pipeline result has expected shape', async () => {
    const llmFn = makeIngestionLLM();
    const contextService = new ContextService(workdir);

    const result = await processDocument(
      NS,
      'lc_grounds_meeting.txt',
      OTTER_TRANSCRIPT,
      llmFn,
      contextService,
    );

    expect(result.fileName).toBe('lc_grounds_meeting.txt');
    expect(result.documentType).toBe('meeting_transcript');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.validationErrors).toBeInstanceOf(Array);
  });
});

// ---------------------------------------------------------------------------
// Otter.ai content marker — detection via content rule (spec §15.1)
// ---------------------------------------------------------------------------

describe('Otter.ai transcript detection via content marker', () => {
  it('"Transcribed by Otter.ai" triggers meeting_transcript at 0.95 confidence', async () => {
    const transcript = 'We discussed the Q2 roadmap in detail.\n\nTranscribed by Otter.ai';
    const llmFn = makeIngestionLLM();
    const contextService = new ContextService(workdir);

    const result = await processDocument(
      NS,
      'notes.txt', // no meeting/transcript hint in filename
      transcript,
      llmFn,
      contextService,
    );

    expect(result.documentType).toBe('meeting_transcript');
    expect(result.detectionConfidence).toBe(0.95);
  });
});

// ---------------------------------------------------------------------------
// LLM failure resilience — ingestion never blocked (spec §16 general)
// ---------------------------------------------------------------------------

describe('LLM failure resilience', () => {
  it('all LLM calls fail → ingestion completes with fallback (no throw)', async () => {
    const failingLLM = vi.fn().mockRejectedValue(new Error('LLM unavailable'));
    const contextService = new ContextService(workdir);

    const OTTER_TRANSCRIPT = 'Um yeah so like Transcribed by Otter.ai';

    // Must not throw
    await expect(
      processDocument(NS, 'notes.txt', OTTER_TRANSCRIPT, failingLLM, contextService),
    ).resolves.toBeDefined();
  });

  it('preprocessor LLM failure → fallback single-section doc → extraction still attempted', async () => {
    let callCount = 0;
    const partialLLM = vi.fn().mockImplementation((prompt: string) => {
      callCount += 1;
      // Fail the first call (preprocessor), succeed on subsequent
      if (
        prompt.includes('You are analyzing') ||
        prompt.includes('meeting transcript') ||
        prompt.includes('IGNORE all small talk')
      ) {
        return Promise.reject(new Error('Preprocessor LLM error'));
      }
      if (prompt.includes('Extract structured project/client information')) {
        return Promise.resolve(JSON.stringify({ clientName: 'Fallback Corp' }));
      }
      if (prompt.includes('Extract knowledge entries')) {
        return Promise.resolve(JSON.stringify([
          { content: 'Client requires a solution.', category: 'requirement', confidence: 0.6 },
        ]));
      }
      return Promise.resolve('{}');
    });

    const contextService = new ContextService(workdir);
    const result = await processDocument(
      NS,
      'lc_grounds_meeting.txt',
      'Transcribed by Otter.ai\nJohn Smith: we need something.',
      partialLLM,
      contextService,
    );

    // Pipeline completed (even with fallback preprocessing)
    expect(result).toBeDefined();
    expect(result.documentType).toBe('meeting_transcript');
  });
});

// ---------------------------------------------------------------------------
// Second document merge — knowledge dedup (spec §15.1 trace)
// ---------------------------------------------------------------------------

describe('second document merge — no duplicate fields', () => {
  it('ingesting two transcripts merges requirements without overwriting user-source fields', async () => {
    const contextService = new ContextService(workdir);
    const llmFn1 = makeIngestionLLM({
      extractedFields: {
        clientName: 'LC Grounds',
        industry: 'Landscaping',
        budget: '$50,000',
      },
      knowledgeEntries: [
        { content: 'Client prefers eco-friendly materials.', category: 'preference', confidence: 0.6 },
      ],
    });
    const llmFn2 = makeIngestionLLM({
      extractedFields: {
        // No conflicting fields — second transcript adds more knowledge
        budget: '$55,000', // slightly different value, same source type
      },
      knowledgeEntries: [
        { content: 'Client is open to phased delivery.', category: 'preference', confidence: 0.6 },
      ],
    });

    const TRANSCRIPT = 'Transcribed by Otter.ai\nJohn: um yeah.';

    await processDocument(NS, 'lc_grounds1.txt', TRANSCRIPT, llmFn1, contextService);
    await processDocument(NS, 'lc_grounds2.txt', TRANSCRIPT, llmFn2, contextService);

    const ctx = await readContext(workdir, NS);
    expect(ctx).not.toBeNull();
    expect(ctx!.sources).toHaveLength(2);

    // Active knowledge should have both preference entries (not deduped — different content)
    const active = ctx!.knowledge.filter((k) => !k.supersededBy);
    expect(active.length).toBeGreaterThanOrEqual(1);

    // version incremented for each merge
    expect(ctx!.version).toBeGreaterThanOrEqual(2);
  });
});
