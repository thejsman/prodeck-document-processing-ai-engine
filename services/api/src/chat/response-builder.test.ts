import { describe, it, expect } from 'vitest';
import {
  buildResponse,
  buildNotReadyResponse,
  buildPlanFailureResponse,
  buildConfirmationResponse,
} from './response-builder.js';
import { buildGenerationConfirmation } from './confirmation-gate.js';
import type { ChatContext } from './intents.js';
import type { ExtractionResult } from './context.types.js';
import type { ReadinessResult } from './readiness-engine.js';
import type { ToolExecutionResult, ActionCard } from './tool-handlers.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeChatCtx(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    namespace: 'default',
    proposals: [],
    templates: [],
    ingestedDocuments: [],
    ...overrides,
  };
}

function makeExtraction(
  fields: Partial<ExtractionResult['fields']> = {},
): ExtractionResult {
  return { fields, knowledge: [], raw: '' };
}

function makeReadiness(overrides: Partial<ReadinessResult> = {}): ReadinessResult {
  return { ready: true, missingFields: [], blockers: [], ...overrides };
}

function makeToolResult(
  overrides: Partial<ToolExecutionResult> & Pick<ToolExecutionResult, 'tool'>,
): ToolExecutionResult {
  return {
    success: true,
    message: 'Operation completed.',
    durationMs: 100,
    ...overrides,
  };
}

const EMPTY_EXTRACTION = makeExtraction();
const READY = makeReadiness();

// ---------------------------------------------------------------------------
// GREETING
// ---------------------------------------------------------------------------

describe('buildResponse — GREETING', () => {
  it('returns a generic greeting when namespace is default and no client name', async () => {
    const res = await buildResponse('GREETING', [], READY, EMPTY_EXTRACTION, makeChatCtx());
    expect(res.text).toMatch(/Hello!/i);
    expect(res.text).toMatch(/proposals|templates|microsites/i);
    expect(res.actionCards).toEqual([]);
    expect(res.toolsCalled).toEqual([]);
  });

  it('includes client name from extraction when present', async () => {
    const extraction = makeExtraction({
      clientName: { value: 'Acme Corp', confidence: 1, source: 'user', updatedAt: '' },
    });
    const res = await buildResponse('GREETING', [], READY, extraction, makeChatCtx());
    expect(res.text).toContain('Acme Corp');
  });

  it('includes namespace as project name when namespace is not "default"', async () => {
    const res = await buildResponse(
      'GREETING',
      [],
      READY,
      EMPTY_EXTRACTION,
      makeChatCtx({ namespace: 'globex-rfp' }),
    );
    expect(res.text).toContain('globex-rfp');
  });

  it('prefers extracted client name over namespace', async () => {
    const extraction = makeExtraction({
      clientName: { value: 'Contoso', confidence: 1, source: 'user', updatedAt: '' },
    });
    const res = await buildResponse(
      'GREETING',
      [],
      READY,
      extraction,
      makeChatCtx({ namespace: 'contoso-ns' }),
    );
    expect(res.text).toContain('Contoso');
  });

  it('sets requirementsUpdated true when extraction has fields', async () => {
    const extraction = makeExtraction({
      clientName: { value: 'Acme', confidence: 1, source: 'user', updatedAt: '' },
    });
    const res = await buildResponse('GREETING', [], READY, extraction, makeChatCtx());
    expect(res.requirementsUpdated).toBe(true);
  });

  it('sets requirementsUpdated false when extraction has no fields', async () => {
    const res = await buildResponse('GREETING', [], READY, EMPTY_EXTRACTION, makeChatCtx());
    expect(res.requirementsUpdated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UPDATE_REQUIREMENTS
// ---------------------------------------------------------------------------

describe('buildResponse — UPDATE_REQUIREMENTS', () => {
  it('lists updated fields when extraction has data', async () => {
    const extraction = makeExtraction({
      clientName: { value: 'Wayne Enterprises', confidence: 1, source: 'user', updatedAt: '' },
      budget: { value: '$200k', confidence: 0.9, source: 'user', updatedAt: '' },
    });
    const res = await buildResponse('UPDATE_REQUIREMENTS', [], READY, extraction, makeChatCtx());
    expect(res.text).toMatch(/Requirements updated/i);
    expect(res.text).toContain('clientName');
    expect(res.text).toContain('Wayne Enterprises');
    expect(res.text).toContain('budget');
    expect(res.text).toContain('$200k');
    expect(res.requirementsUpdated).toBe(true);
  });

  it('returns a soft acknowledgement when extraction has no fields', async () => {
    const res = await buildResponse(
      'UPDATE_REQUIREMENTS',
      [],
      READY,
      EMPTY_EXTRACTION,
      makeChatCtx(),
    );
    expect(res.text).toMatch(/noted|got it/i);
  });
});

// ---------------------------------------------------------------------------
// INGEST_GUIDANCE
// ---------------------------------------------------------------------------

describe('buildResponse — INGEST_GUIDANCE', () => {
  it('returns upload instructions', async () => {
    const res = await buildResponse(
      'INGEST_GUIDANCE',
      [],
      READY,
      EMPTY_EXTRACTION,
      makeChatCtx(),
    );
    expect(res.text).toMatch(/upload|attach/i);
    expect(res.text).toMatch(/RFP|documents/i);
  });

  it('includes an upload action card', async () => {
    const res = await buildResponse(
      'INGEST_GUIDANCE',
      [],
      READY,
      EMPTY_EXTRACTION,
      makeChatCtx(),
    );
    expect(res.actionCards).toHaveLength(1);
    expect(res.actionCards[0]!.type).toBe('upload');
    expect(res.actionCards[0]!.label).toMatch(/upload/i);
  });
});

// ---------------------------------------------------------------------------
// Single tool — success
// ---------------------------------------------------------------------------

describe('buildResponse — single tool success', () => {
  it('uses the tool result message as the response text', async () => {
    const tool = makeToolResult({
      tool: 'generate_proposal',
      success: true,
      message: 'Proposal generated successfully.',
    });
    const res = await buildResponse(
      'GENERATE_PROPOSAL',
      [tool],
      READY,
      EMPTY_EXTRACTION,
      makeChatCtx(),
    );
    expect(res.text).toBe('Proposal generated successfully.');
  });

  it('passes through actionCards from the tool result', async () => {
    const cards: ActionCard[] = [
      { type: 'view', label: 'View Proposal', href: '/proposals/acme.md' },
    ];
    const tool = makeToolResult({
      tool: 'generate_proposal',
      success: true,
      message: 'Done.',
      actionCards: cards,
    });
    const res = await buildResponse(
      'GENERATE_PROPOSAL',
      [tool],
      READY,
      EMPTY_EXTRACTION,
      makeChatCtx(),
    );
    expect(res.actionCards).toEqual(cards);
  });

  it('includes the tool name in toolsCalled', async () => {
    const tool = makeToolResult({ tool: 'list_proposals', success: true, message: 'Listed.' });
    const res = await buildResponse(
      'STATUS_CHECK',
      [tool],
      READY,
      EMPTY_EXTRACTION,
      makeChatCtx(),
    );
    expect(res.toolsCalled).toContain('list_proposals');
  });
});

// ---------------------------------------------------------------------------
// Single tool — failure
// ---------------------------------------------------------------------------

describe('buildResponse — single tool failure', () => {
  it('includes the error message in the response text', async () => {
    const tool = makeToolResult({
      tool: 'generate_proposal',
      success: false,
      message: 'LLM timeout.',
    });
    const res = await buildResponse(
      'GENERATE_PROPOSAL',
      [tool],
      READY,
      EMPTY_EXTRACTION,
      makeChatCtx(),
    );
    expect(res.text).toContain('LLM timeout.');
  });

  it('appends a tool-specific suggestion for generate_proposal failures', async () => {
    const tool = makeToolResult({
      tool: 'generate_proposal',
      success: false,
      message: 'Something went wrong.',
    });
    const res = await buildResponse(
      'GENERATE_PROPOSAL',
      [tool],
      READY,
      EMPTY_EXTRACTION,
      makeChatCtx(),
    );
    expect(res.text).toMatch(/context|requirements/i);
  });

  it('appends a tool-specific suggestion for generate_microsite failures', async () => {
    const tool = makeToolResult({
      tool: 'generate_microsite',
      success: false,
      message: 'No approved proposals found.',
    });
    const res = await buildResponse(
      'GENERATE_MICROSITE',
      [tool],
      READY,
      EMPTY_EXTRACTION,
      makeChatCtx(),
    );
    expect(res.text).toMatch(/approved|finalized/i);
  });

  it('returns empty actionCards on failure', async () => {
    const tool = makeToolResult({
      tool: 'generate_template',
      success: false,
      message: 'Failed.',
    });
    const res = await buildResponse(
      'GENERATE_TEMPLATE',
      [tool],
      READY,
      EMPTY_EXTRACTION,
      makeChatCtx(),
    );
    expect(res.actionCards).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Multi-tool — deterministic fallback (no generateFn)
// ---------------------------------------------------------------------------

describe('buildResponse — multi-tool (no generateFn)', () => {
  it('concatenates tool messages when no generateFn is provided', async () => {
    const tools = [
      makeToolResult({ tool: 'list_proposals', success: true, message: 'Found 2 proposals.' }),
      makeToolResult({ tool: 'get_proposal_status', success: true, message: 'Status: draft.' }),
    ];
    const res = await buildResponse(
      'STATUS_CHECK',
      tools,
      READY,
      EMPTY_EXTRACTION,
      makeChatCtx(),
    );
    expect(res.text).toContain('Found 2 proposals.');
    expect(res.text).toContain('Status: draft.');
    expect(res.toolsCalled).toEqual(['list_proposals', 'get_proposal_status']);
  });

  it('merges actionCards from all tools', async () => {
    const cards1: ActionCard[] = [{ type: 'view', label: 'View A', href: '/a' }];
    const cards2: ActionCard[] = [{ type: 'edit', label: 'Edit B', href: '/b' }];
    const tools = [
      makeToolResult({ tool: 'list_proposals', success: true, message: 'A.', actionCards: cards1 }),
      makeToolResult({ tool: 'list_templates', success: true, message: 'B.', actionCards: cards2 }),
    ];
    const res = await buildResponse(
      'STATUS_CHECK',
      tools,
      READY,
      EMPTY_EXTRACTION,
      makeChatCtx(),
    );
    expect(res.actionCards).toEqual([...cards1, ...cards2]);
  });
});

// ---------------------------------------------------------------------------
// Multi-tool — LLM synthesis path
// ---------------------------------------------------------------------------

describe('buildResponse — multi-tool (with generateFn)', () => {
  it('calls generateFn with a summary prompt and returns the synthesised text', async () => {
    const tools = [
      makeToolResult({ tool: 'list_proposals', success: true, message: 'Found 3 proposals.' }),
      makeToolResult({ tool: 'get_proposal_status', success: true, message: 'Status: approved.' }),
    ];
    const generateFn = async (_prompt: string) => 'Here is what happened: three proposals exist, one is approved.';
    const res = await buildResponse(
      'STATUS_CHECK',
      tools,
      READY,
      EMPTY_EXTRACTION,
      makeChatCtx(),
      generateFn,
    );
    expect(res.text).toBe('Here is what happened: three proposals exist, one is approved.');
  });

  it('falls back to deterministic concatenation when generateFn throws', async () => {
    const tools = [
      makeToolResult({ tool: 'list_proposals', success: true, message: 'Listed.' }),
      makeToolResult({ tool: 'list_templates', success: true, message: 'Templates listed.' }),
    ];
    const generateFn = async (_prompt: string): Promise<string> => {
      throw new Error('LLM unavailable');
    };
    const res = await buildResponse(
      'STATUS_CHECK',
      tools,
      READY,
      EMPTY_EXTRACTION,
      makeChatCtx(),
      generateFn,
    );
    expect(res.text).toContain('Listed.');
    expect(res.text).toContain('Templates listed.');
  });
});

// ---------------------------------------------------------------------------
// buildNotReadyResponse
// ---------------------------------------------------------------------------

describe('buildNotReadyResponse', () => {
  it('formats required missing fields as a numbered list', () => {
    const readiness = makeReadiness({
      ready: false,
      missingFields: [
        { field: 'clientName', question: 'What is the client name?', required: true },
        { field: 'industry', question: 'What industry are they in?', required: true },
      ],
    });
    const res = buildNotReadyResponse('GENERATE_PROPOSAL', readiness, EMPTY_EXTRACTION);
    expect(res.text).toMatch(/1\. What is the client name\?/);
    expect(res.text).toMatch(/2\. What industry are they in\?/);
    expect(res.toolsCalled).toEqual([]);
    expect(res.actionCards).toEqual([]);
  });

  it('includes blockers above the question list', () => {
    const readiness = makeReadiness({
      ready: false,
      blockers: ['No proposals exist. Generate one first.'],
      missingFields: [],
    });
    const res = buildNotReadyResponse('MODIFY_PROPOSAL', readiness, EMPTY_EXTRACTION);
    expect(res.text).toContain('No proposals exist. Generate one first.');
  });

  it('only numbers required missing fields (not optional)', () => {
    const readiness = makeReadiness({
      ready: false,
      missingFields: [
        { field: 'clientName', question: 'Client name?', required: true },
        { field: 'budget', question: 'Budget?', required: false },
      ],
    });
    const res = buildNotReadyResponse('GENERATE_PROPOSAL', readiness, EMPTY_EXTRACTION);
    expect(res.text).toContain('Client name?');
    expect(res.text).not.toContain('Budget?');
  });

  it('sets requirementsUpdated true when extraction has fields', () => {
    const extraction = makeExtraction({
      clientName: { value: 'Oscorp', confidence: 1, source: 'user', updatedAt: '' },
    });
    const readiness = makeReadiness({
      ready: false,
      missingFields: [{ field: 'industry', question: 'Industry?', required: true }],
    });
    const res = buildNotReadyResponse('GENERATE_PROPOSAL', readiness, extraction);
    expect(res.requirementsUpdated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildPlanFailureResponse
// ---------------------------------------------------------------------------

describe('buildPlanFailureResponse', () => {
  it('returns a helpful rephrasing suggestion', () => {
    const res = buildPlanFailureResponse(EMPTY_EXTRACTION);
    expect(res.text).toMatch(/plan|rephras/i);
    expect(res.actionCards).toEqual([]);
    expect(res.toolsCalled).toEqual([]);
  });

  it('sets requirementsUpdated when extraction has fields', () => {
    const extraction = makeExtraction({
      timeline: { value: '6 months', confidence: 0.8, source: 'user', updatedAt: '' },
    });
    const res = buildPlanFailureResponse(extraction);
    expect(res.requirementsUpdated).toBe(true);
  });

  it('sets requirementsUpdated false when extraction has no fields', () => {
    const res = buildPlanFailureResponse(EMPTY_EXTRACTION);
    expect(res.requirementsUpdated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildConfirmationResponse — confirm_generation (ask before big generation)
// ---------------------------------------------------------------------------

describe('buildConfirmationResponse — confirm_generation', () => {
  it('asks to confirm a microsite generation', () => {
    const req = buildGenerationConfirmation('GENERATE_MICROSITE');
    const res = buildConfirmationResponse(req, EMPTY_EXTRACTION);
    expect(res.text).toMatch(/create a microsite/i);
    expect(res.text).toMatch(/go ahead|yes/i);
    expect(res.confirmationRequest).toEqual(req);
  });

  it('asks to confirm a proposal generation', () => {
    const req = buildGenerationConfirmation('GENERATE_PROPOSAL');
    const res = buildConfirmationResponse(req, EMPTY_EXTRACTION);
    expect(res.text).toMatch(/generate a proposal/i);
    expect(res.confirmationRequest).toEqual(req);
  });
});
