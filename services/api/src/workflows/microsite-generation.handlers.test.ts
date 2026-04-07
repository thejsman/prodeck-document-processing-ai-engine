import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCheckingProposal, handleGeneratingMicrosite } from './microsite-generation.handlers.js';
import type { HandlerContext } from './proposal-generation.handlers.js';
import type { WorkflowInstance } from './workflow-instance.service.js';

// ---------------------------------------------------------------------------
// Module-level mock state — shared across all tests.
// The agent mock reads these at call time so per-test changes take effect.
// ---------------------------------------------------------------------------

let agentShouldThrow = false;
let agentThrowError: Error = new Error('agent error');
let agentReturnValue: { markdown?: string; json?: unknown; assets?: string[] } = {
  markdown: '# Microsite',
  json: { sections: [] },
  assets: ['microsite-asset.json'],
};

vi.mock('@ai-engine/agent-microsite-generator', () => ({
  // Use a named function (not arrow) so `new` works
  MicrositeGeneratorAgent: vi.fn(function MicrositeGeneratorAgentMock(
    this: { run: unknown; name: string; description: string },
  ) {
    this.name = 'microsite-generator';
    this.description = '';
    this.run = vi.fn(async () => {
      if (agentShouldThrow) throw agentThrowError;
      return agentReturnValue;
    });
  }),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@ai-engine/core', () => ({
  toolRegistry: {},
}));

import { readFile, readdir } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstance(overrides: Partial<WorkflowInstance['context']> = {}): WorkflowInstance {
  return {
    id: 'test-id',
    namespace: 'test-ns',
    chatSessionId: 'session-1',
    workflowId: 'microsite_generation',
    state: 'checking_proposal',
    context: { ...overrides },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeCtx(instance: WorkflowInstance, incomingMessage = ''): HandlerContext {
  return {
    workdir: '/tmp/workdir',
    namespace: 'test-ns',
    instance,
    incomingMessage,
    onPhase: vi.fn(),
    onChunk: vi.fn(),
    onSection: vi.fn(),
    onToolEvent: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// handleCheckingProposal
// ---------------------------------------------------------------------------

describe('handleCheckingProposal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentShouldThrow = false;
    agentReturnValue = { markdown: '# Microsite', json: { sections: [] }, assets: ['microsite-asset.json'] };
  });

  it('signals READY immediately when proposalArtifactId already set', async () => {
    const instance = makeInstance({ proposalArtifactId: 'existing.md' });
    const result = await handleCheckingProposal(makeCtx(instance));
    expect(result.stateSignal).toBe('READY');
    expect(result.message).toBe('');
  });

  it('asks user to generate a proposal when none found', async () => {
    vi.mocked(readdir).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
    const instance = makeInstance();
    const result = await handleCheckingProposal(makeCtx(instance));
    expect(result.stateSignal).toBeUndefined();
    expect(result.message).toMatch(/no proposals found/i);
    expect(result.message).toMatch(/create a proposal/i);
  });

  it('lists single proposal and asks for confirmation', async () => {
    vi.mocked(readdir).mockResolvedValue(['my-proposal-1234567890.md'] as unknown as Awaited<ReturnType<typeof readdir>>);
    const instance = makeInstance();
    const result = await handleCheckingProposal(makeCtx(instance));
    expect(result.stateSignal).toBeUndefined();
    expect(result.message).toMatch(/my-proposal/i);
    expect(result.message).toMatch(/yes/i);
    expect(instance.context.awaitingMicrositeProposalSelection).toBe(true);
  });

  it('lists multiple proposals and asks for selection', async () => {
    vi.mocked(readdir).mockResolvedValue([
      'proposal-a-1000000001.md',
      'proposal-b-1000000002.md',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    const instance = makeInstance();
    const result = await handleCheckingProposal(makeCtx(instance));
    expect(result.message).toMatch(/1\./);
    expect(result.message).toMatch(/2\./);
    expect(result.message).toMatch(/which proposal/i);
  });

  it('accepts numeric reply to select a proposal', async () => {
    vi.mocked(readdir).mockResolvedValue([
      'proposal-a-1000000001.md',
      'proposal-b-1000000002.md',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    const instance = makeInstance({ awaitingMicrositeProposalSelection: true });
    const result = await handleCheckingProposal(makeCtx(instance, '1'));
    expect(result.stateSignal).toBe('READY');
    expect(instance.context.proposalArtifactId).toBeTruthy();
  });

  it('accepts affirmative reply to select the first proposal', async () => {
    const affirmatives = ['yes', 'ok', 'sure', 'proceed', 'use it'];
    for (const msg of affirmatives) {
      vi.mocked(readdir).mockResolvedValue(['proposal-a-1000000001.md'] as unknown as Awaited<ReturnType<typeof readdir>>);
      // Reset both flags before each call
      const instance = makeInstance({ awaitingMicrositeProposalSelection: true });
      const result = await handleCheckingProposal(makeCtx(instance, msg));
      expect(result.stateSignal).toBe('READY', `expected READY for message "${msg}"`);
    }
  });

  it('accepts filename fragment reply', async () => {
    vi.mocked(readdir).mockResolvedValue([
      'cloud-migration-1000000001.md',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    const instance = makeInstance({ awaitingMicrositeProposalSelection: true });
    // The handler matches when the message contains the filename (minus extension)
    const result = await handleCheckingProposal(makeCtx(instance, 'cloud-migration-1000000001'));
    expect(result.stateSignal).toBe('READY');
    expect(instance.context.proposalArtifactId).toBe('cloud-migration-1000000001.md');
  });

  it('re-lists when awaiting selection but reply is unrecognised', async () => {
    vi.mocked(readdir).mockResolvedValue([
      'proposal-a-1000000001.md',
      'proposal-b-1000000002.md',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    const instance = makeInstance({ awaitingMicrositeProposalSelection: true });
    const result = await handleCheckingProposal(makeCtx(instance, 'blah blah unrecognised'));
    // Should not signal READY — re-prompts instead
    expect(result.stateSignal).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleGeneratingMicrosite
// ---------------------------------------------------------------------------

describe('handleGeneratingMicrosite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentShouldThrow = false;
    agentReturnValue = { markdown: '# Microsite', json: { sections: [] }, assets: ['microsite-asset.json'] };
  });

  it('signals DONE and stores micrositeArtifactId on success', async () => {
    vi.mocked(readFile).mockResolvedValue('# Proposal Content\n\nSome content here.' as unknown as Buffer);
    const instance = makeInstance({ proposalArtifactId: 'proposal.md' });
    const ctx = makeCtx(instance);
    const result = await handleGeneratingMicrosite(ctx);
    expect(result.stateSignal).toBe('DONE');
    expect(instance.context.micrositeArtifactId).toBeTruthy();
    expect(result.actions?.sourceProposal).toBe('proposal.md');
  });

  it('emits phase events during generation', async () => {
    vi.mocked(readFile).mockResolvedValue('# Proposal\n\nContent.' as unknown as Buffer);
    const instance = makeInstance({ proposalArtifactId: 'proposal.md' });
    const ctx = makeCtx(instance);
    await handleGeneratingMicrosite(ctx);
    expect(ctx.onPhase).toHaveBeenCalledWith('Loading proposal');
    expect(ctx.onPhase).toHaveBeenCalledWith(expect.stringMatching(/generating microsite/i));
  });

  it('emits summary chunk on success', async () => {
    vi.mocked(readFile).mockResolvedValue('# Proposal\n\nContent.' as unknown as Buffer);
    const instance = makeInstance({ proposalArtifactId: 'proposal.md' });
    const ctx = makeCtx(instance);
    await handleGeneratingMicrosite(ctx);
    expect(ctx.onChunk).toHaveBeenCalledWith(expect.stringMatching(/microsite generated/i));
  });

  it('returns error message when proposal file not found', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: no such file'));
    const instance = makeInstance({ proposalArtifactId: 'missing.md' });
    const result = await handleGeneratingMicrosite(makeCtx(instance));
    expect(result.stateSignal).toBeUndefined();
    expect(result.message).toMatch(/could not read/i);
    expect(result.message).toMatch(/missing\.md/i);
  });

  it('returns error message when proposal file is empty', async () => {
    vi.mocked(readFile).mockResolvedValue('   ' as unknown as Buffer);
    const instance = makeInstance({ proposalArtifactId: 'empty.md' });
    const result = await handleGeneratingMicrosite(makeCtx(instance));
    expect(result.stateSignal).toBeUndefined();
    expect(result.message).toMatch(/empty/i);
  });

  it('returns error message when agent throws', async () => {
    vi.mocked(readFile).mockResolvedValue('# Proposal\n\nContent.' as unknown as Buffer);
    agentShouldThrow = true;
    agentThrowError = new Error('LLM unavailable');
    const instance = makeInstance({ proposalArtifactId: 'proposal.md' });
    const result = await handleGeneratingMicrosite(makeCtx(instance));
    expect(result.stateSignal).toBeUndefined();
    expect(result.message).toMatch(/error/i);
    expect(result.message).toMatch(/LLM unavailable/i);
  });

  it('stores layoutAST in context when agent returns json', async () => {
    vi.mocked(readFile).mockResolvedValue('# Proposal\n\nContent.' as unknown as Buffer);
    agentReturnValue = { json: { sections: [{ type: 'hero' }] }, assets: [] };
    const instance = makeInstance({ proposalArtifactId: 'proposal.md' });
    await handleGeneratingMicrosite(makeCtx(instance));
    expect(instance.context.micrositeLayoutAST).toEqual({ sections: [{ type: 'hero' }] });
  });

  it('handles agent returning no assets gracefully', async () => {
    vi.mocked(readFile).mockResolvedValue('# Proposal\n\nContent.' as unknown as Buffer);
    agentReturnValue = { markdown: '# Microsite', json: null, assets: [] };
    const instance = makeInstance({ proposalArtifactId: 'proposal.md' });
    const result = await handleGeneratingMicrosite(makeCtx(instance));
    expect(result.stateSignal).toBe('DONE');
  });
});
