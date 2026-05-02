import { describe, it, expect, vi } from 'vitest';
import {
  detectIntent,
  buildRequirementStatus,
  buildTaskInstruction,
  buildConversationWindow,
  formatConversationForContext,
  buildInterruptContext,
} from './context-builder.js';

// ---------------------------------------------------------------------------
// detectIntent
// ---------------------------------------------------------------------------

describe('detectIntent', () => {
  // Workflow affirmatives → CONFIRMATION (confidence 10)
  describe('workflow affirmatives return CONFIRMATION', () => {
    const affirmatives = [
      'yes', 'y', 'no', 'n',
      'proceed', 'continue', 'go ahead', 'go on',
      'ok', 'okay', 'sure', 'alright', 'fine', 'great',
      'use this', 'use that', 'use it', 'accept', 'confirm',
      'approve', 'approved', 'looks good', 'looks great', 'perfect',
      'that works', 'sounds good', 'sounds great',
      '1', '2', '3', '4', '5',
      'next', 'skip', 'done',
    ];

    for (const msg of affirmatives) {
      it(`"${msg}" → CONFIRMATION`, () => {
        const result = detectIntent(msg);
        expect(result.intent).toBe('CONFIRMATION');
        expect(result.confidence).toBe(10);
      });
    }
  });

  // Short workflow inputs — below threshold → WORKFLOW_INPUT
  describe('short messages without ? return WORKFLOW_INPUT', () => {
    const shorts = [
      'fintech',
      '12 weeks',
      '$50k',
      'cloud migration',
      'list',
      'show me',
    ];

    for (const msg of shorts) {
      it(`short "${msg}" → WORKFLOW_INPUT`, () => {
        expect(detectIntent(msg).intent).toBe('WORKFLOW_INPUT');
      });
    }
  });

  // Clear questions → QUESTION
  describe('genuine questions return QUESTION', () => {
    const questions = [
      'What is the timeline for this project?',
      'How does the pricing work?',
      'Why is the budget so high?',
      'Can you explain the technical approach?',
      'What are the deliverables?',
      'What is RAG?',
      'How does the system work?',
      'Tell me about the project scope',
      'Explain the methodology',
      "What's in the knowledge base?",
      'Summarize the documents',
      'Summarise the key findings',
    ];

    for (const msg of questions) {
      it(`"${msg}" → QUESTION`, () => {
        expect(detectIntent(msg).intent).toBe('QUESTION');
      });
    }
  });

  it('messages ending with ? (length > 5) return QUESTION', () => {
    expect(detectIntent('Is this the right approach?').intent).toBe('QUESTION');
    expect(detectIntent('What budget should I use?').intent).toBe('QUESTION');
  });

  // "yes?" is 4 chars — ? only scores when length > 5, so score stays 0
  it('"yes?" is too short to score, returns WORKFLOW_INPUT', () => {
    expect(detectIntent('yes?').intent).toBe('WORKFLOW_INPUT');
  });

  // Confusion expressions — must never return QUESTION
  describe('confusion expressions do not return QUESTION', () => {
    const confusionCases = [
      'what?', 'huh?', 'sorry?', 'pardon?', 'excuse me?',
      'what do you mean?', "i don't understand", 'i dont understand',
      'can you repeat?', 'come again?',
    ];

    for (const msg of confusionCases) {
      it(`"${msg}" → not QUESTION`, () => {
        expect(detectIntent(msg).intent).not.toBe('QUESTION');
      });
    }
  });

  // Negative signals — command starters reduce score
  it('command-like starters return WORKFLOW_INPUT', () => {
    expect(detectIntent('generate the proposal').intent).toBe('WORKFLOW_INPUT');
    expect(detectIntent('proceed with the outline').intent).toBe('WORKFLOW_INPUT');
  });

  // Confidence
  it('clear questions have confidence >= 4', () => {
    expect(detectIntent('What is the timeline for this project?').confidence).toBeGreaterThanOrEqual(4);
  });

  it('workflow affirmatives have confidence 10', () => {
    expect(detectIntent('yes').confidence).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// buildRequirementStatus
// ---------------------------------------------------------------------------

describe('buildRequirementStatus', () => {
  it('shows known and missing fields', () => {
    const status = buildRequirementStatus({
      industry: 'fintech',
      budget: '$50k',
    });
    expect(status).toContain('industry: fintech');
    expect(status).toContain('budget: $50k');
    expect(status).toContain('timeline: missing');
    expect(status).toContain('team size: missing');
    expect(status).toContain('client name: missing');
    expect(status).toContain('project type: missing');
  });

  it('shows all missing when requirements empty', () => {
    const status = buildRequirementStatus({});
    expect(status).not.toContain('fintech');
    const missingCount = (status.match(/missing/g) ?? []).length;
    expect(missingCount).toBe(6);
  });

  it('shows all known when all fields present', () => {
    const status = buildRequirementStatus({
      industry: 'healthcare',
      timeline: '12 weeks',
      budget: '$100k',
      teamSize: '5 engineers',
      clientName: 'Acme Corp',
      projectType: 'cloud migration',
    });
    expect(status).not.toContain('missing');
  });
});

// ---------------------------------------------------------------------------
// buildTaskInstruction
// ---------------------------------------------------------------------------

describe('buildTaskInstruction', () => {
  it('asks for next requirement when in collecting state with few inputs', () => {
    const instruction = buildTaskInstruction('collecting_inputs', {});
    expect(instruction).toMatch(/ask|missing|requirement/i);
  });

  it('falls through to workflow fallback when all required fields are present', () => {
    const instruction = buildTaskInstruction('collecting_inputs', {
      industry: 'fintech',
      projectType: 'web app',
      timeline: '12 weeks',
      budget: '$50k',
      teamSize: '5',
      clientName: 'Acme',
    });
    expect(instruction).toMatch(/WORKFLOW|GENERATION|REVIEW|continue/i);
  });

  it('returns generation instruction for generating states when inputs are complete', () => {
    const allRequirements = {
      industry: 'fintech', projectType: 'web app', timeline: '12 weeks',
      budget: '$50k', teamSize: '5', clientName: 'Acme',
    };
    for (const state of ['generating_outline', 'generating_sections', 'gap_analysis']) {
      const instruction = buildTaskInstruction(state, allRequirements);
      expect(instruction).toMatch(/GENERATION|generate|content/i);
    }
  });

  it('returns review instruction for review states when inputs are complete', () => {
    const allRequirements = {
      industry: 'fintech', projectType: 'web app', timeline: '12 weeks',
      budget: '$50k', teamSize: '5', clientName: 'Acme',
    };
    for (const state of ['recommend_template', 'review_template', 'qa_review']) {
      const instruction = buildTaskInstruction(state, allRequirements);
      expect(instruction).toMatch(/REVIEW|present|confirm/i);
    }
  });

  it('returns fallback for unknown states', () => {
    const instruction = buildTaskInstruction('unknown_state', {});
    expect(instruction.length).toBeGreaterThan(0);
  });
});


// ---------------------------------------------------------------------------
// buildInterruptContext
// ---------------------------------------------------------------------------

describe('buildInterruptContext', () => {
  const baseConversationContext = {
    systemPrompt: '',
    conversationWindow: [
      { role: 'user' as const, content: 'okay' },
      { role: 'assistant' as const, content: 'No template matched. Reply yes to proceed.' },
    ],
    workflowState: 'recommend_template',
    proposalRequirements: {},
    requirementStatus: '',
    taskInstruction: '',
  };

  it('includes current workflow state', () => {
    const result = buildInterruptContext('recommend_template', baseConversationContext, {});
    expect(result).toContain('Current workflow state: recommend_template');
  });

  it('includes recent conversation messages', () => {
    const result = buildInterruptContext('recommend_template', baseConversationContext, {});
    expect(result).toContain('User: okay');
    expect(result).toContain('Assistant: No template matched. Reply yes to proceed.');
  });

  it('includes template recommendation when present', () => {
    const ctx = {
      templateRecommendation: { confidence: 0.14, reasoning: 'Low match score — custom structure recommended.' },
    };
    const result = buildInterruptContext('recommend_template', baseConversationContext, ctx);
    expect(result).toContain('14%');
    expect(result).toContain('custom structure recommended');
  });

  it('includes selected template name and sections', () => {
    const ctx = {
      selectedTemplate: {
        name: 'Custom Generated',
        structure: ['Executive Summary', 'Project Overview', 'Budget'],
      },
    };
    const result = buildInterruptContext('recommend_template', baseConversationContext, ctx);
    expect(result).toContain('Selected template: Custom Generated');
    expect(result).toContain('Executive Summary');
  });

  it('includes proposal artifact id when present', () => {
    const ctx = { proposalArtifactId: 'nb-corp_proposal_v1.md' };
    const result = buildInterruptContext('generating_sections', baseConversationContext, ctx);
    expect(result).toContain('nb-corp_proposal_v1.md');
  });

  it('includes requirements when gathered', () => {
    const ctx = { proposalRequirements: { industry: 'fintech', budget: '$50k' } };
    const result = buildInterruptContext('collecting_inputs', baseConversationContext, ctx);
    expect(result).toContain('industry: fintech');
    expect(result).toContain('budget: $50k');
  });

  it('omits empty sections gracefully', () => {
    const result = buildInterruptContext('collecting_inputs', baseConversationContext, {});
    expect(result).not.toContain('Selected template');
    expect(result).not.toContain('Generated proposal');
    expect(result).not.toContain('Requirements gathered');
  });

  it('limits conversation window to last 4 messages', () => {
    const manyMessages = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `message ${i}`,
    }));
    const ctx = { ...baseConversationContext, conversationWindow: manyMessages };
    const result = buildInterruptContext('recommend_template', ctx, {});
    expect(result).toContain('message 9');
    expect(result).not.toContain('message 0');
  });
});

// ---------------------------------------------------------------------------
// buildConversationWindow
// ---------------------------------------------------------------------------

describe('buildConversationWindow', () => {
  it('returns the last 10 messages', () => {
    const messages = Array.from({ length: 15 }, (_, i) => ({
      id: `msg-${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `message ${i}`,
      timestamp: new Date().toISOString(),
    }));
    const window = buildConversationWindow(messages);
    expect(window).toHaveLength(10);
    expect(window[0].content).toBe('message 5');
    expect(window[9].content).toBe('message 14');
  });

  it('trims messages longer than 1000 chars', () => {
    const longContent = 'x'.repeat(1500);
    const messages = [{ id: 'msg-0', role: 'user' as const, content: longContent, timestamp: new Date().toISOString() }];
    const window = buildConversationWindow(messages);
    expect(window[0].content).toHaveLength(1000 + '…[trimmed]'.length);
    expect(window[0].content).toContain('…[trimmed]');
  });

  it('does not trim messages at or under 1000 chars', () => {
    const content = 'x'.repeat(1000);
    const messages = [{ id: 'msg-0', role: 'user' as const, content, timestamp: new Date().toISOString() }];
    const window = buildConversationWindow(messages);
    expect(window[0].content).toBe(content);
    expect(window[0].content).not.toContain('[trimmed]');
  });

  it('returns empty array for empty history', () => {
    expect(buildConversationWindow([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatConversationForContext
// ---------------------------------------------------------------------------

describe('formatConversationForContext', () => {
  it('formats user messages with "User:" prefix', () => {
    const result = formatConversationForContext([{ role: 'user', content: 'hello' }]);
    expect(result[0]).toBe('User: hello');
  });

  it('formats assistant messages with "Assistant:" prefix', () => {
    const result = formatConversationForContext([{ role: 'assistant', content: 'hi there' }]);
    expect(result[0]).toBe('Assistant: hi there');
  });

  it('preserves order of messages', () => {
    const result = formatConversationForContext([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ]);
    expect(result).toEqual(['User: first', 'Assistant: second', 'User: third']);
  });
});
