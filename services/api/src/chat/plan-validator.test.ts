import { describe, it, expect } from 'vitest';
import { validatePlan } from './plan-validator.js';

// ---------------------------------------------------------------------------
// Valid plans
// ---------------------------------------------------------------------------

describe('valid plans', () => {
  it('GENERATE_PROPOSAL with required params passes', () => {
    const result = validatePlan({
      intent: 'GENERATE_PROPOSAL',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'generate_proposal',
          params: { client: 'Acme Corp', industry: 'Technology' },
        },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.plan).toBeDefined();
  });

  it('GREETING with RESPOND passes', () => {
    const result = validatePlan({
      intent: 'GREETING',
      actions: [{ type: 'RESPOND', message: 'Hello! How can I help you today?' }],
    });
    expect(result.valid).toBe(true);
  });

  it('STATUS_CHECK with list_proposals passes', () => {
    const result = validatePlan({
      intent: 'STATUS_CHECK',
      actions: [{ type: 'CALL_TOOL', tool: 'list_proposals', params: {} }],
    });
    expect(result.valid).toBe(true);
  });

  it('QUERY with search_documents passes', () => {
    const result = validatePlan({
      intent: 'QUERY',
      actions: [
        { type: 'CALL_TOOL', tool: 'search_documents', params: { query: 'client requirements' } },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('plan with ASK action passes', () => {
    const result = validatePlan({
      intent: 'GENERATE_PROPOSAL',
      actions: [{ type: 'ASK', question: 'What is the client name?' }],
    });
    expect(result.valid).toBe(true);
  });

  it('plan with UPDATE_REQUIREMENTS passes', () => {
    const result = validatePlan({
      intent: 'UPDATE_REQUIREMENTS',
      actions: [{ type: 'UPDATE_REQUIREMENTS', data: { clientName: 'Acme' } }],
    });
    expect(result.valid).toBe(true);
  });

  it('generate_microsite with valid 6-char hex color passes', () => {
    const result = validatePlan({
      intent: 'GENERATE_MICROSITE',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'generate_microsite',
          params: { proposalFileName: 'acme-proposal.md', primaryColor: '#1a2b3c' },
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('generate_microsite without optional color params passes', () => {
    const result = validatePlan({
      intent: 'GENERATE_MICROSITE',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'generate_microsite',
          params: { proposalFileName: 'acme-proposal.md' },
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('GENERAL_CHAT with only RESPOND passes', () => {
    const result = validatePlan({
      intent: 'GENERAL_CHAT',
      actions: [
        {
          type: 'RESPOND',
          message: "I'm here to help with proposals and templates. What would you like to work on?",
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('multi-action plan with exactly 3 CALL_TOOL passes', () => {
    const result = validatePlan({
      intent: 'GENERATE_PROPOSAL',
      actions: [
        { type: 'CALL_TOOL', tool: 'list_proposals', params: {} },
        { type: 'CALL_TOOL', tool: 'list_templates', params: {} },
        { type: 'CALL_TOOL', tool: 'list_proposals', params: {} },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('plan with mixed action types passes', () => {
    const result = validatePlan({
      intent: 'GENERATE_PROPOSAL',
      actions: [
        { type: 'ASK', question: 'Which template to use?' },
        { type: 'UPDATE_REQUIREMENTS', data: { clientName: 'Acme' } },
        {
          type: 'CALL_TOOL',
          tool: 'generate_proposal',
          params: { client: 'Acme', industry: 'Tech' },
        },
      ],
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Structural validation — unknown tool names and intent values
// ---------------------------------------------------------------------------

describe('structural validation', () => {
  it('unknown tool name → reject', () => {
    const result = validatePlan({
      intent: 'QUERY',
      actions: [{ type: 'CALL_TOOL', tool: 'unknown_tool', params: {} }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('invented tool name → reject', () => {
    const result = validatePlan({
      intent: 'GENERATE_PROPOSAL',
      actions: [{ type: 'CALL_TOOL', tool: 'create_client_record', params: {} }],
    });
    expect(result.valid).toBe(false);
  });

  it('invalid intent value → reject', () => {
    const result = validatePlan({
      intent: 'INVALID_INTENT',
      actions: [{ type: 'RESPOND', message: 'hello' }],
    });
    expect(result.valid).toBe(false);
  });

  it('empty actions array → reject', () => {
    const result = validatePlan({
      intent: 'GENERATE_PROPOSAL',
      actions: [],
    });
    expect(result.valid).toBe(false);
  });

  it('more than 5 actions → reject', () => {
    const result = validatePlan({
      intent: 'GENERATE_PROPOSAL',
      actions: Array(6).fill({ type: 'RESPOND', message: 'hello' }),
    });
    expect(result.valid).toBe(false);
  });

  it('null input → reject', () => {
    expect(validatePlan(null).valid).toBe(false);
  });

  it('string input → reject', () => {
    expect(validatePlan('string').valid).toBe(false);
  });

  it('number input → reject', () => {
    expect(validatePlan(42).valid).toBe(false);
  });

  it('missing intent field → reject', () => {
    const result = validatePlan({
      actions: [{ type: 'RESPOND', message: 'hi' }],
    });
    expect(result.valid).toBe(false);
  });

  it('missing actions field → reject', () => {
    const result = validatePlan({ intent: 'GREETING' });
    expect(result.valid).toBe(false);
  });

  it('ASK with empty question → reject', () => {
    const result = validatePlan({
      intent: 'GENERATE_PROPOSAL',
      actions: [{ type: 'ASK', question: '' }],
    });
    expect(result.valid).toBe(false);
  });

  it('RESPOND with empty message → reject', () => {
    const result = validatePlan({
      intent: 'GREETING',
      actions: [{ type: 'RESPOND', message: '' }],
    });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Per-tool parameter validation
// ---------------------------------------------------------------------------

describe('per-tool param validation', () => {
  it('generate_proposal missing required client → reject', () => {
    const result = validatePlan({
      intent: 'GENERATE_PROPOSAL',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'generate_proposal',
          params: { industry: 'Technology' },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('generate_proposal'))).toBe(true);
  });

  it('generate_proposal missing required industry → reject', () => {
    const result = validatePlan({
      intent: 'GENERATE_PROPOSAL',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'generate_proposal',
          params: { client: 'Acme Corp' },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('generate_proposal'))).toBe(true);
  });

  it('generate_proposal empty client string → reject', () => {
    const result = validatePlan({
      intent: 'GENERATE_PROPOSAL',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'generate_proposal',
          params: { client: '', industry: 'Technology' },
        },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('generate_microsite invalid hex color (no hash) → reject', () => {
    const result = validatePlan({
      intent: 'GENERATE_MICROSITE',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'generate_microsite',
          params: { proposalFileName: 'acme.md', primaryColor: 'ff0000' },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('generate_microsite'))).toBe(true);
  });

  it('generate_microsite invalid hex color (3-char shorthand) → reject', () => {
    const result = validatePlan({
      intent: 'GENERATE_MICROSITE',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'generate_microsite',
          params: { proposalFileName: 'acme.md', primaryColor: '#abc' },
        },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('generate_microsite invalid hex color (plain word) → reject', () => {
    const result = validatePlan({
      intent: 'GENERATE_MICROSITE',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'generate_microsite',
          params: { proposalFileName: 'acme.md', primaryColor: 'blue' },
        },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('generate_microsite missing proposalFileName → reject', () => {
    const result = validatePlan({
      intent: 'GENERATE_MICROSITE',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'generate_microsite',
          params: { primaryColor: '#ff0000' },
        },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('edit_proposal_section missing proposalFileName → reject', () => {
    const result = validatePlan({
      intent: 'MODIFY_PROPOSAL',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'edit_proposal_section',
          params: { sectionName: 'Executive Summary', instruction: 'Make it shorter' },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('edit_proposal_section'))).toBe(true);
  });

  it('edit_proposal_section missing sectionName → reject', () => {
    const result = validatePlan({
      intent: 'MODIFY_PROPOSAL',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'edit_proposal_section',
          params: { proposalFileName: 'acme.md', instruction: 'Make it shorter' },
        },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('edit_proposal_section missing instruction → reject', () => {
    const result = validatePlan({
      intent: 'MODIFY_PROPOSAL',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'edit_proposal_section',
          params: { proposalFileName: 'acme.md', sectionName: 'Executive Summary' },
        },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('search_documents with empty query string → reject', () => {
    const result = validatePlan({
      intent: 'QUERY',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'search_documents',
          params: { query: '' },
        },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('generate_template missing required description → reject', () => {
    const result = validatePlan({
      intent: 'GENERATE_TEMPLATE',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'generate_template',
          params: { name: 'My Template' },
        },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('modify_template missing instruction → reject', () => {
    const result = validatePlan({
      intent: 'MODIFY_TEMPLATE',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'modify_template',
          params: { templateName: 'default' },
        },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('get_proposal_status missing proposalFileName → reject', () => {
    const result = validatePlan({
      intent: 'STATUS_CHECK',
      actions: [
        { type: 'CALL_TOOL', tool: 'get_proposal_status', params: {} },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('set_proposal_status missing status → reject', () => {
    const result = validatePlan({
      intent: 'STATUS_CHECK',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'set_proposal_status',
          params: { proposalFileName: 'acme.md' },
        },
      ],
    });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Business rules
// ---------------------------------------------------------------------------

describe('business rules', () => {
  it('more than 3 CALL_TOOL actions → reject with message', () => {
    const result = validatePlan({
      intent: 'GENERATE_PROPOSAL',
      actions: [
        { type: 'CALL_TOOL', tool: 'list_proposals', params: {} },
        { type: 'CALL_TOOL', tool: 'list_templates', params: {} },
        { type: 'CALL_TOOL', tool: 'list_proposals', params: {} },
        { type: 'CALL_TOOL', tool: 'list_templates', params: {} },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Max 3 tool calls'))).toBe(true);
  });

  it('exactly 3 CALL_TOOL actions → valid', () => {
    const result = validatePlan({
      intent: 'GENERATE_PROPOSAL',
      actions: [
        { type: 'CALL_TOOL', tool: 'list_proposals', params: {} },
        { type: 'CALL_TOOL', tool: 'list_templates', params: {} },
        { type: 'CALL_TOOL', tool: 'list_proposals', params: {} },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('GREETING + CALL_TOOL → reject with GREETING message', () => {
    const result = validatePlan({
      intent: 'GREETING',
      actions: [{ type: 'CALL_TOOL', tool: 'list_proposals', params: {} }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('GREETING'))).toBe(true);
  });

  it('GENERAL_CHAT + CALL_TOOL → reject with GENERAL_CHAT message', () => {
    const result = validatePlan({
      intent: 'GENERAL_CHAT',
      actions: [
        {
          type: 'CALL_TOOL',
          tool: 'search_documents',
          params: { query: 'some query' },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('GENERAL_CHAT'))).toBe(true);
  });

  it('GREETING with ASK (no tool call) → valid', () => {
    const result = validatePlan({
      intent: 'GREETING',
      actions: [{ type: 'ASK', question: 'How can I assist you today?' }],
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ValidationResult shape
// ---------------------------------------------------------------------------

describe('result shape', () => {
  it('valid plan includes plan object matching input', () => {
    const raw = {
      intent: 'QUERY',
      actions: [
        { type: 'CALL_TOOL', tool: 'search_documents', params: { query: 'client requirements' } },
      ],
    };
    const result = validatePlan(raw);
    expect(result.valid).toBe(true);
    expect(result.plan?.intent).toBe('QUERY');
    expect(result.plan?.actions[0]).toMatchObject({
      type: 'CALL_TOOL',
      tool: 'search_documents',
    });
  });

  it('invalid plan does not include plan object', () => {
    const result = validatePlan({
      intent: 'GREETING',
      actions: [{ type: 'CALL_TOOL', tool: 'list_proposals', params: {} }],
    });
    expect(result.valid).toBe(false);
    expect(result.plan).toBeUndefined();
  });

  it('errors array is empty on success', () => {
    const result = validatePlan({
      intent: 'STATUS_CHECK',
      actions: [{ type: 'CALL_TOOL', tool: 'list_proposals', params: {} }],
    });
    expect(result.errors).toHaveLength(0);
  });

  it('multiple violations produce multiple errors', () => {
    const result = validatePlan({
      intent: 'GREETING',
      actions: [
        { type: 'CALL_TOOL', tool: 'list_proposals', params: {} },
        { type: 'CALL_TOOL', tool: 'list_templates', params: {} },
        { type: 'CALL_TOOL', tool: 'list_proposals', params: {} },
        { type: 'CALL_TOOL', tool: 'list_templates', params: {} },
      ],
    });
    expect(result.valid).toBe(false);
    // Both "Max 3 tool calls" and "GREETING should not call tools" should be present
    expect(result.errors.some((e) => e.includes('Max 3 tool calls'))).toBe(true);
    expect(result.errors.some((e) => e.includes('GREETING'))).toBe(true);
  });
});
