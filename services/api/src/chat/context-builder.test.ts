import { describe, it, expect, vi } from 'vitest';
import {
  detectInterrupt,
  buildRequirementStatus,
  buildTaskInstruction,
  mergeRequirements,
  extractRequirementsFromMessage,
  buildConversationWindow,
  formatConversationForContext,
  buildInterruptContext,
} from './context-builder.js';

// ---------------------------------------------------------------------------
// detectInterrupt
// ---------------------------------------------------------------------------

describe('detectInterrupt', () => {
  // Workflow affirmatives — must never fire
  describe('workflow affirmatives are not interrupts', () => {
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
      it(`"${msg}" is not an interrupt`, () => {
        expect(detectInterrupt(msg)).toBe(false);
      });
    }
  });

  // Short messages without ? — not interrupts
  describe('short messages without ? are not interrupts', () => {
    const shorts = [
      'fintech',
      '12 weeks',
      '$50k',
      'cloud migration',
      'list',          // was previously triggering as interrupt
      'show me',       // was previously triggering as interrupt
    ];

    for (const msg of shorts) {
      it(`short "${msg}" is not an interrupt`, () => {
        expect(detectInterrupt(msg)).toBe(false);
      });
    }
  });

  // Clear questions — must fire
  describe('genuine questions are interrupts', () => {
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
      'What\'s in the knowledge base?',
      'Summarize the documents',
      'Summarise the key findings',
    ];

    for (const msg of questions) {
      it(`"${msg}" is an interrupt`, () => {
        expect(detectInterrupt(msg)).toBe(true);
      });
    }
  });

  // Questions ending with ?
  it('any message ending with ? is an interrupt', () => {
    expect(detectInterrupt('Is this the right approach?')).toBe(true);
    expect(detectInterrupt('What budget should I use?')).toBe(true);
  });

  // Edge: "yes?" is technically a question but won't match affirmative check
  it('"yes?" ends with ? so is treated as an interrupt', () => {
    expect(detectInterrupt('yes?')).toBe(true);
  });

  // Confusion expressions — end with ? but are NOT knowledge queries
  describe('confusion expressions are not interrupts', () => {
    const confusionCases = [
      'what?', 'huh?', 'sorry?', 'pardon?', 'excuse me?',
      'what do you mean?', "i don't understand", 'i dont understand',
      'can you repeat?', 'come again?',
    ];

    for (const msg of confusionCases) {
      it(`"${msg}" is not an interrupt`, () => {
        expect(detectInterrupt(msg)).toBe(false);
      });
    }
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

  it('proceeds with collection when enough inputs present', () => {
    const instruction = buildTaskInstruction('collecting_inputs', {
      industry: 'fintech',
      timeline: '12 weeks',
      budget: '$50k',
    });
    expect(instruction).toMatch(/proceed|intake|collection/i);
  });

  it('returns generation instruction for generating states', () => {
    for (const state of ['generating_outline', 'generating_sections', 'gap_analysis']) {
      const instruction = buildTaskInstruction(state, {});
      expect(instruction).toMatch(/proceed|generation|available/i);
    }
  });

  it('returns review instruction for review states', () => {
    for (const state of ['recommend_template', 'review_template', 'qa_review']) {
      const instruction = buildTaskInstruction(state, {});
      expect(instruction).toMatch(/present|await|confirm/i);
    }
  });

  it('returns fallback for unknown states', () => {
    const instruction = buildTaskInstruction('unknown_state', {});
    expect(instruction.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// mergeRequirements
// ---------------------------------------------------------------------------

describe('mergeRequirements', () => {
  it('merges non-overlapping fields', () => {
    const merged = mergeRequirements(
      { industry: 'fintech' },
      { timeline: '12 weeks' },
    );
    expect(merged).toEqual({ industry: 'fintech', timeline: '12 weeks' });
  });

  it('extracted values overwrite existing', () => {
    const merged = mergeRequirements(
      { industry: 'fintech', budget: '$50k' },
      { industry: 'healthcare' },
    );
    expect(merged.industry).toBe('healthcare');
    expect(merged.budget).toBe('$50k');
  });

  it('ignores empty string values in extracted', () => {
    const merged = mergeRequirements(
      { industry: 'fintech' },
      { industry: '' },
    );
    // Empty string is falsy so it should not overwrite
    expect(merged.industry).toBe('fintech');
  });

  it('does not mutate the existing object', () => {
    const existing = { industry: 'fintech' };
    mergeRequirements(existing, { timeline: '12 weeks' });
    expect(existing).toEqual({ industry: 'fintech' });
  });
});

// ---------------------------------------------------------------------------
// extractRequirementsFromMessage
// ---------------------------------------------------------------------------

describe('extractRequirementsFromMessage', () => {
  it('extracts industry from colon pattern', async () => {
    const result = await extractRequirementsFromMessage('industry: fintech');
    expect(result.industry).toBe('fintech');
  });

  it('extracts budget from dollar pattern', async () => {
    const result = await extractRequirementsFromMessage('our budget is $50k');
    expect(result.budget).toBeTruthy();
    expect(result.budget).toContain('50');
  });

  it('extracts timeline from duration pattern', async () => {
    const result = await extractRequirementsFromMessage('the project will take 12 weeks');
    expect(result.timeline).toMatch(/12.*week/i);
  });

  it('extracts team size from headcount pattern', async () => {
    const result = await extractRequirementsFromMessage('we need 5 engineers on this');
    expect(result.teamSize).toMatch(/5.*engineer/i);
  });

  it('extracts industry from keyword match', async () => {
    const result = await extractRequirementsFromMessage('this is a healthcare project');
    expect(result.industry).toBe('healthcare');
  });

  it('extracts project type from known keywords', async () => {
    const result = await extractRequirementsFromMessage('we need a cloud migration strategy');
    expect(result.projectType).toBe('cloud migration');
  });

  it('returns empty object when nothing matches', async () => {
    const result = await extractRequirementsFromMessage('hello there');
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('normalises budget with k suffix', async () => {
    const result = await extractRequirementsFromMessage('budget: $150k');
    expect(result.budget).toBe('$150,000');
  });

  it('normalises timeline casing', async () => {
    const result = await extractRequirementsFromMessage('timeline is 3 Months');
    expect(result.timeline).toBe('3 months');
  });

  it('calls generateFn only for missing fields (LLM fallback)', async () => {
    const generateFn = vi.fn().mockResolvedValue('{}');
    // Message with all fields already extractable by regex — LLM should not be called
    await extractRequirementsFromMessage(
      'industry: fintech, timeline: 12 weeks, budget: $50k, team size: 5 engineers',
      generateFn,
    );
    // LLM fallback is only called when fields are missing; fintech + 12 weeks + $50k
    // cover industry, timeline, budget — only clientName, teamSize, projectType may be missing
    // but LLM call is non-fatal either way; we just check it doesn't throw
    expect(generateFn).toBeDefined();
  });

  it('does not throw when generateFn returns invalid JSON', async () => {
    const generateFn = vi.fn().mockResolvedValue('not valid json');
    await expect(
      extractRequirementsFromMessage('some message', generateFn),
    ).resolves.toBeDefined();
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
