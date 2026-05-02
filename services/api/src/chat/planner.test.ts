import { describe, it, expect, vi } from 'vitest';
import { Planner, buildFallbackPlan } from './planner.js';
import type { ChatContext } from './intents.js';
import type { NamespaceContext } from './context.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseChatCtx: ChatContext = {
  namespace: 'test-ns',
  proposals: [],
  templates: [],
  ingestedDocuments: [],
};

function makeNsContext(overrides: Partial<NamespaceContext> = {}): NamespaceContext {
  return {
    namespace: 'test-ns',
    requirements: { fields: {}, customFields: {} },
    knowledge: [],
    sources: [],
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildFallbackPlan
// ---------------------------------------------------------------------------

describe('buildFallbackPlan', () => {
  it('GENERATE_PROPOSAL → CALL_TOOL generate_proposal with known clientName/industry', () => {
    const nsCtx = makeNsContext({
      requirements: {
        fields: {
          clientName: { value: 'Acme Corp', confidence: 0.9, source: 'user', updatedAt: '2026-01-01' },
          industry: { value: 'Technology', confidence: 0.9, source: 'user', updatedAt: '2026-01-01' },
        },
        customFields: {},
      },
    });
    const plan = buildFallbackPlan('GENERATE_PROPOSAL', '', nsCtx);
    expect(plan).not.toBeNull();
    expect(plan!.intent).toBe('GENERATE_PROPOSAL');
    expect(plan!.actions[0]).toMatchObject({
      type: 'CALL_TOOL',
      tool: 'generate_proposal',
      params: { client: 'Acme Corp', industry: 'Technology' },
    });
  });

  it('GENERATE_PROPOSAL with missing requirements uses empty strings', () => {
    const plan = buildFallbackPlan('GENERATE_PROPOSAL', '', makeNsContext());
    expect(plan).not.toBeNull();
    expect(plan!.actions[0]).toMatchObject({
      type: 'CALL_TOOL',
      tool: 'generate_proposal',
      params: { client: '', industry: '' },
    });
  });

  it('STATUS_CHECK → CALL_TOOL list_proposals', () => {
    const plan = buildFallbackPlan('STATUS_CHECK', '', makeNsContext());
    expect(plan).not.toBeNull();
    expect(plan!.intent).toBe('STATUS_CHECK');
    expect(plan!.actions[0]).toMatchObject({
      type: 'CALL_TOOL',
      tool: 'list_proposals',
      params: {},
    });
  });

  it('QUERY → CALL_TOOL search_documents with message as query', () => {
    const plan = buildFallbackPlan('QUERY', 'what are the requirements?', makeNsContext());
    expect(plan).not.toBeNull();
    expect(plan!.intent).toBe('QUERY');
    expect(plan!.actions[0]).toMatchObject({
      type: 'CALL_TOOL',
      tool: 'search_documents',
      params: { query: 'what are the requirements?' },
    });
  });

  it('GENERATE_MICROSITE → null (triggers plan failure response)', () => {
    expect(buildFallbackPlan('GENERATE_MICROSITE', '', makeNsContext())).toBeNull();
  });

  it('MODIFY_PROPOSAL → null', () => {
    expect(buildFallbackPlan('MODIFY_PROPOSAL', 'update the summary', makeNsContext())).toBeNull();
  });

  it('GREETING → null', () => {
    expect(buildFallbackPlan('GREETING', 'hi', makeNsContext())).toBeNull();
  });

  it('GENERAL_CHAT → null', () => {
    expect(buildFallbackPlan('GENERAL_CHAT', 'tell me a joke', makeNsContext())).toBeNull();
  });

  it('UNKNOWN → null', () => {
    expect(buildFallbackPlan('UNKNOWN', 'asdfghjkl', makeNsContext())).toBeNull();
  });

  it('GENERATE_TEMPLATE → null', () => {
    expect(buildFallbackPlan('GENERATE_TEMPLATE', 'create template', makeNsContext())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Planner.buildPlan
// ---------------------------------------------------------------------------

describe('Planner.buildPlan', () => {
  it('returns parsed AgentPlan on valid LLM response', async () => {
    const expected = {
      intent: 'QUERY',
      actions: [{ type: 'CALL_TOOL', tool: 'search_documents', params: { query: 'requirements' } }],
    };
    const generateFn = vi.fn().mockResolvedValue(JSON.stringify(expected));
    const planner = new Planner(generateFn);

    const result = await planner.buildPlan('QUERY', 'what are the requirements?', baseChatCtx, makeNsContext());
    expect(result).toEqual(expected);
  });

  it('calls generateFn with prompt containing intent and message', async () => {
    const responsePlan = {
      intent: 'GENERATE_PROPOSAL',
      actions: [
        { type: 'CALL_TOOL', tool: 'generate_proposal', params: { client: 'Acme', industry: 'Tech' } },
      ],
    };
    const generateFn = vi.fn().mockResolvedValue(JSON.stringify(responsePlan));
    const planner = new Planner(generateFn);

    await planner.buildPlan('GENERATE_PROPOSAL', 'create a proposal for Acme', baseChatCtx, makeNsContext());

    expect(generateFn).toHaveBeenCalledOnce();
    const prompt = generateFn.mock.calls[0][0] as string;
    expect(prompt).toContain('GENERATE_PROPOSAL');
    expect(prompt).toContain('create a proposal for Acme');
  });

  it('returns null when LLM throws', async () => {
    const generateFn = vi.fn().mockRejectedValue(new Error('LLM unavailable'));
    const planner = new Planner(generateFn);

    const result = await planner.buildPlan('GENERATE_PROPOSAL', 'create proposal', baseChatCtx, makeNsContext());
    expect(result).toBeNull();
  });

  it('returns null when LLM returns invalid JSON', async () => {
    const generateFn = vi.fn().mockResolvedValue('not valid json at all');
    const planner = new Planner(generateFn);

    const result = await planner.buildPlan('GENERATE_PROPOSAL', 'create proposal', baseChatCtx, makeNsContext());
    expect(result).toBeNull();
  });

  it('handles markdown code fence wrapping in LLM response', async () => {
    const plan = {
      intent: 'QUERY',
      actions: [{ type: 'RESPOND', message: 'Here is the info' }],
    };
    const generateFn = vi.fn().mockResolvedValue(`\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``);
    const planner = new Planner(generateFn);

    const result = await planner.buildPlan('QUERY', 'tell me about requirements', baseChatCtx, makeNsContext());
    expect(result).toEqual(plan);
  });

  it('prompt includes available proposals and templates from chatContext', async () => {
    const generateFn = vi.fn().mockResolvedValue('null');
    const planner = new Planner(generateFn);

    const chatCtx: ChatContext = {
      ...baseChatCtx,
      proposals: [{ fileName: 'acme-proposal.md', status: 'draft' }],
      templates: [{ fileName: 'default-template.md', name: 'Default' }],
    };

    await planner.buildPlan('MODIFY_PROPOSAL', 'update the summary', chatCtx, makeNsContext());
    const prompt = generateFn.mock.calls[0][0] as string;
    expect(prompt).toContain('acme-proposal.md');
    expect(prompt).toContain('default-template.md');
  });

  it('prompt includes relevant knowledge entries filtered by category', async () => {
    const generateFn = vi.fn().mockResolvedValue('null');
    const planner = new Planner(generateFn);

    const nsCtx = makeNsContext({
      knowledge: [
        {
          id: 'k1',
          content: 'Client prefers agile methodology',
          category: 'preference',
          source: { type: 'document', fileName: 'rfp.pdf' },
          extractedAt: '2026-01-01',
          confidence: 0.9,
        },
      ],
    });

    // GENERATE_PROPOSAL includes 'preference' in its category priority
    await planner.buildPlan('GENERATE_PROPOSAL', 'create proposal', baseChatCtx, nsCtx);
    const prompt = generateFn.mock.calls[0][0] as string;
    expect(prompt).toContain('Client prefers agile methodology');
  });

  it('excludes superseded knowledge entries from the prompt', async () => {
    const generateFn = vi.fn().mockResolvedValue('null');
    const planner = new Planner(generateFn);

    const nsCtx = makeNsContext({
      knowledge: [
        {
          id: 'k1',
          content: 'Old budget was $100k',
          category: 'requirement',
          source: { type: 'document' },
          extractedAt: '2026-01-01',
          confidence: 0.8,
          supersededBy: 'k2',
        },
        {
          id: 'k2',
          content: 'Budget is now $150k',
          category: 'requirement',
          source: { type: 'chat' },
          extractedAt: '2026-01-02',
          confidence: 0.95,
        },
      ],
    });

    await planner.buildPlan('GENERATE_PROPOSAL', 'create proposal', baseChatCtx, nsCtx);
    const prompt = generateFn.mock.calls[0][0] as string;
    expect(prompt).not.toContain('Old budget was $100k');
    expect(prompt).toContain('Budget is now $150k');
  });

  it('STATUS_CHECK gets no knowledge entries in prompt (empty category priority)', async () => {
    const generateFn = vi.fn().mockResolvedValue('null');
    const planner = new Planner(generateFn);

    const nsCtx = makeNsContext({
      knowledge: [
        {
          id: 'k1',
          content: 'Client is Acme Corp',
          category: 'requirement',
          source: { type: 'document' },
          extractedAt: '2026-01-01',
          confidence: 0.9,
        },
      ],
    });

    await planner.buildPlan('STATUS_CHECK', 'list proposals', baseChatCtx, nsCtx);
    const prompt = generateFn.mock.calls[0][0] as string;
    // Knowledge section should be empty (no entries pass the filter)
    expect(prompt).not.toContain('Client is Acme Corp');
  });

  it('prompt includes current requirements from nsContext', async () => {
    const generateFn = vi.fn().mockResolvedValue('null');
    const planner = new Planner(generateFn);

    const nsCtx = makeNsContext({
      requirements: {
        fields: {
          clientName: { value: 'Globex', confidence: 0.9, source: 'user', updatedAt: '2026-01-01' },
        },
        customFields: {},
      },
    });

    await planner.buildPlan('GENERATE_PROPOSAL', 'create proposal', baseChatCtx, nsCtx);
    const prompt = generateFn.mock.calls[0][0] as string;
    expect(prompt).toContain('Globex');
  });

  it('caps knowledge at 15 entries', async () => {
    const generateFn = vi.fn().mockResolvedValue('null');
    const planner = new Planner(generateFn);

    const knowledge = Array.from({ length: 20 }, (_, i) => ({
      id: `k${i}`,
      content: `Requirement entry ${i}`,
      category: 'requirement' as const,
      source: { type: 'document' as const },
      extractedAt: '2026-01-01',
      confidence: i / 20,
    }));

    const nsCtx = makeNsContext({ knowledge });

    await planner.buildPlan('GENERATE_PROPOSAL', 'create proposal', baseChatCtx, nsCtx);
    const prompt = generateFn.mock.calls[0][0] as string;

    // Count how many knowledge entries appear — only top 15 by confidence
    const matchCount = (prompt.match(/\[requirement\]/g) ?? []).length;
    expect(matchCount).toBeLessThanOrEqual(15);
  });
});
