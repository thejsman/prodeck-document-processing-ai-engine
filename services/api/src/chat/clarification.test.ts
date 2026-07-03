import { describe, it, expect } from 'vitest';
import { detectClarification } from './clarification.js';
import type { ChatContext } from './intents.js';

const baseCtx: ChatContext = {
  namespace: 'acme',
  proposals: [],
  templates: [],
  ingestedDocuments: [],
};

function ctx(overrides: Partial<ChatContext> = {}): ChatContext {
  return { ...baseCtx, ...overrides };
}

const approved = { fileName: 'acme::acme_proposal_v1.md', status: 'approved' };
const draft = { fileName: 'acme::acme_proposal_v2.md', status: 'draft' };

describe('detectClarification — microsite', () => {
  it('asks a questionnaire for a bare "microsite" when an approved proposal exists', () => {
    const result = detectClarification('GENERATE_MICROSITE', 'microsite', ctx({ proposals: [approved] }));
    expect(result).not.toBeNull();
    expect(result!.resumeIntent).toBe('GENERATE_MICROSITE');
    expect(result!.questions.length).toBeGreaterThanOrEqual(2);
    expect(result!.questions.map((q) => q.field)).toContain('micrositeSource');
    // Single approved proposal → its name is surfaced in the source question.
    expect(result!.questions[0]!.question).toContain('acme_proposal_v1');
  });

  it('lists multiple approved proposals to choose from', () => {
    const second = { fileName: 'acme::acme_proposal_v3.md', status: 'finalized' };
    const result = detectClarification('GENERATE_MICROSITE', 'landing page', ctx({ proposals: [approved, second] }));
    expect(result).not.toBeNull();
    expect(result!.questions[0]!.question).toContain('acme_proposal_v1');
    expect(result!.questions[0]!.question).toContain('acme_proposal_v3');
  });

  it('does NOT clarify when the request already carries specifics', () => {
    const result = detectClarification(
      'GENERATE_MICROSITE',
      'generate a microsite from the acme proposal with a dark theme',
      ctx({ proposals: [approved] }),
    );
    expect(result).toBeNull();
  });

  it('does NOT clarify when no approved/finalized proposal exists (readiness blocker guides instead)', () => {
    const result = detectClarification('GENERATE_MICROSITE', 'microsite', ctx({ proposals: [draft] }));
    expect(result).toBeNull();
  });

  it('does NOT clarify while resuming the same intent (awaitingInput)', () => {
    const result = detectClarification(
      'GENERATE_MICROSITE',
      'microsite',
      ctx({ proposals: [approved], awaitingInput: { intent: 'GENERATE_MICROSITE' } }),
    );
    expect(result).toBeNull();
  });

  it('does NOT clarify while a confirmation is pending', () => {
    const result = detectClarification(
      'GENERATE_MICROSITE',
      'microsite',
      ctx({ proposals: [approved], awaitingConfirmation: { kind: 'confirm_template' } }),
    );
    expect(result).toBeNull();
  });
});

describe('detectClarification — other intents', () => {
  it('returns null for non-microsite intents (proposal handled by readiness engine)', () => {
    expect(detectClarification('GENERATE_PROPOSAL', 'proposal', ctx())).toBeNull();
    expect(detectClarification('QUERY', 'what is the budget', ctx())).toBeNull();
  });
});
