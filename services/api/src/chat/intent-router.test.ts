import { describe, it, expect, vi } from 'vitest';
import { routeIntent, isResetIntent, classifyIntentWithLLM } from './intent-router.js';

describe('routeIntent', () => {
  // -------------------------------------------------------------------
  // RFP analysis triggers
  // -------------------------------------------------------------------
  describe('rfp_analysis', () => {
    const cases = [
      'Analyze this RFP',
      'analyse rfp',
      'Should we bid on this?',
      'Go/no-go decision',
      'evaluate the rfp',
      'review rfp',
    ];

    for (const msg of cases) {
      it(`routes "${msg}" → rfp_analysis`, () => {
        expect(routeIntent(msg)?.workflowId).toBe('rfp_analysis');
      });
    }
  });

  // -------------------------------------------------------------------
  // Version control triggers
  // -------------------------------------------------------------------
  describe('proposal_version_control', () => {
    const cases = [
      'rollback',
      'roll back to the previous version',
      'revert to v1.0',
      'revert',
      'undo changes',
      'show history',
      'show versions',
      'version history',
      'proposal history',
      'list versions',
      'go back to version v1.2',
      'restore version',
    ];

    for (const msg of cases) {
      it(`routes "${msg}" → proposal_version_control`, () => {
        expect(routeIntent(msg)?.workflowId).toBe('proposal_version_control');
      });
    }
  });

  // -------------------------------------------------------------------
  // Proposal generation triggers
  // -------------------------------------------------------------------
  describe('proposal_generation', () => {
    const cases = [
      'Create proposal for cloud migration',
      'generate proposal',
      'draft a proposal about data analytics',
      'new proposal',
    ];

    for (const msg of cases) {
      it(`routes "${msg}" → proposal_generation`, () => {
        expect(routeIntent(msg)?.workflowId).toBe('proposal_generation');
      });
    }

    it('falls back to proposal_generation for messages containing "proposal"', () => {
      expect(routeIntent('I need a proposal')?.workflowId).toBe('proposal_generation');
    });
  });

  // -------------------------------------------------------------------
  // Null — no match
  // -------------------------------------------------------------------
  describe('no match', () => {
    const cases = [
      'What is RAG?',
      'Hello',
      'How does the system work?',
      '',
    ];

    for (const msg of cases) {
      it(`returns null for "${msg}"`, () => {
        expect(routeIntent(msg)).toBeNull();
      });
    }
  });

  // -------------------------------------------------------------------
  // Microsite generation triggers
  // -------------------------------------------------------------------
  describe('microsite_generation', () => {
    const cases = [
      'generate microsite',
      'create microsite',
      'build microsite',
      'create a microsite',
      'generate a microsite',
      'turn this into a microsite',
      'convert proposal to microsite',
      'proposal to microsite',
      'create presentation',
      'generate a presentation',
      'turn proposal into presentation',
      'create a site from this proposal',
      'generate a site',
      'microsite from proposal',
    ];

    for (const msg of cases) {
      it(`routes "${msg}" → microsite_generation`, () => {
        expect(routeIntent(msg)?.workflowId).toBe('microsite_generation');
      });
    }
  });

  // -------------------------------------------------------------------
  // Template creation triggers
  // -------------------------------------------------------------------
  describe('template_creation', () => {
    const cases = [
      'create template',
      'generate template',
      'build a template',
      'create a template',
      'design template',
      'new template',
    ];

    for (const msg of cases) {
      it(`routes "${msg}" → template_creation`, () => {
        expect(routeIntent(msg)?.workflowId).toBe('template_creation');
      });
    }
  });

  // -------------------------------------------------------------------
  // Compliance triggers
  // -------------------------------------------------------------------
  describe('compliance_redline', () => {
    const cases = [
      'check compliance',
      'compliance review',
      'redline',
      'legal review',
      'flag legal issues',
      'validate proposal',
    ];

    for (const msg of cases) {
      it(`routes "${msg}" → compliance_redline`, () => {
        expect(routeIntent(msg)?.workflowId).toBe('compliance_redline');
      });
    }
  });

  // -------------------------------------------------------------------
  // Priority: RFP > microsite > template > compliance > version > proposal
  // -------------------------------------------------------------------
  describe('priority ordering', () => {
    it('routes "review rfp" to rfp_analysis, not version control', () => {
      expect(routeIntent('review rfp')?.workflowId).toBe('rfp_analysis');
    });

    it('routes "rollback" to version control, not proposal', () => {
      expect(routeIntent('rollback the proposal')?.workflowId).toBe('proposal_version_control');
    });

    it('routes "show proposal history" to version control', () => {
      expect(routeIntent('show proposal history')?.workflowId).toBe('proposal_version_control');
    });

    it('routes microsite before proposal when both words present', () => {
      expect(routeIntent('create microsite from proposal')?.workflowId).toBe('microsite_generation');
    });

    it('routes template creation before proposal fallback', () => {
      expect(routeIntent('create a template for a new proposal')?.workflowId).toBe('template_creation');
    });
  });
});

// ---------------------------------------------------------------------------
// isResetIntent
// ---------------------------------------------------------------------------

describe('isResetIntent', () => {
  const resetCases = [
    'start over',
    'start again',
    'restart',
    'reset',
    'clear workflow',
    'new session',
    'cancel workflow',
    'cancel this',
    'forget this',
    'discard',
    'begin again',
    'start fresh',
    'start over and create a new proposal',
    'reset everything please',
  ];

  for (const msg of resetCases) {
    it(`detects reset in "${msg}"`, () => {
      expect(isResetIntent(msg)).toBe(true);
    });
  }

  const nonResetCases = [
    'create proposal',
    'yes',
    'no',
    'proceed',
    'generate a microsite',
    'What is the timeline?',
    '',
  ];

  for (const msg of nonResetCases) {
    it(`does not detect reset in "${msg}"`, () => {
      expect(isResetIntent(msg)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// classifyIntentWithLLM
// ---------------------------------------------------------------------------

describe('classifyIntentWithLLM', () => {
  it('returns workflow when LLM classifies a known intent', async () => {
    const generateFn = vi.fn().mockResolvedValue('{ "intent": "proposal_generation" }');
    const result = await classifyIntentWithLLM(
      'I mean to say to generate the proposal via this system',
      [],
      generateFn,
    );
    expect(result).toEqual({ workflowId: 'proposal_generation' });
    expect(generateFn).toHaveBeenCalledOnce();
  });

  it('returns null when LLM classifies as no intent', async () => {
    const generateFn = vi.fn().mockResolvedValue('{ "intent": null }');
    const result = await classifyIntentWithLLM('What is RAG?', [], generateFn);
    expect(result).toBeNull();
  });

  it('returns null for unknown workflow IDs', async () => {
    const generateFn = vi.fn().mockResolvedValue('{ "intent": "unknown_workflow" }');
    const result = await classifyIntentWithLLM('do something', [], generateFn);
    expect(result).toBeNull();
  });

  it('returns null when generateFn throws', async () => {
    const generateFn = vi.fn().mockRejectedValue(new Error('LLM unavailable'));
    const result = await classifyIntentWithLLM('generate a proposal', [], generateFn);
    expect(result).toBeNull();
  });

  it('returns null when generateFn returns invalid JSON', async () => {
    const generateFn = vi.fn().mockResolvedValue('not valid json');
    const result = await classifyIntentWithLLM('generate a proposal', [], generateFn);
    expect(result).toBeNull();
  });

  it('strips markdown code fences from LLM response', async () => {
    const generateFn = vi.fn().mockResolvedValue('```json\n{ "intent": "rfp_analysis" }\n```');
    const result = await classifyIntentWithLLM('analyze that document', [], generateFn);
    expect(result).toEqual({ workflowId: 'rfp_analysis' });
  });

  it('includes conversation context in the prompt', async () => {
    const generateFn = vi.fn().mockResolvedValue('{ "intent": "proposal_generation" }');
    const context = [
      { role: 'user' as const, content: 'Can this system create proposals?' },
      { role: 'assistant' as const, content: 'Yes, I can help you create proposals.' },
    ];
    await classifyIntentWithLLM('yes, let\'s do that', context, generateFn);
    const prompt = generateFn.mock.calls[0][0];
    expect(prompt).toContain('User: Can this system create proposals?');
    expect(prompt).toContain('Assistant: Yes, I can help you create proposals.');
  });

  it('handles all known workflow IDs', async () => {
    const workflows = [
      'proposal_generation',
      'rfp_analysis',
      'microsite_generation',
      'template_creation',
      'compliance_redline',
      'proposal_version_control',
    ];
    for (const wf of workflows) {
      const generateFn = vi.fn().mockResolvedValue(`{ "intent": "${wf}" }`);
      const result = await classifyIntentWithLLM('test', [], generateFn);
      expect(result).toEqual({ workflowId: wf });
    }
  });
});
