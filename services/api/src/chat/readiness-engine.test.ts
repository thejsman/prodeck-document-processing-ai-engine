import { describe, it, expect } from 'vitest';
import { checkReadiness } from './readiness-engine.js';
import type { ReadinessResult } from './readiness-engine.js';
import type { NamespaceContext } from './context.types.js';
import type { ChatContext } from './intents.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeContext(fields: Record<string, unknown> = {}): NamespaceContext {
  const builtFields: NamespaceContext['requirements']['fields'] = {}
  for (const [key, value] of Object.entries(fields)) {
    builtFields[key as keyof typeof builtFields] = {
      value,
      confidence: 0.9,
      source: 'user',
      updatedAt: new Date().toISOString(),
    } as never
  }
  return {
    namespace: 'test-ns',
    requirements: { fields: builtFields, customFields: {} },
    knowledge: [],
    sources: [],
    version: 1,
    updatedAt: new Date().toISOString(),
  }
}

function makeChatCtx(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    namespace: 'test-ns',
    proposals: [],
    templates: [],
    ingestedDocuments: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// GENERATE_PROPOSAL
// ---------------------------------------------------------------------------

describe('GENERATE_PROPOSAL', () => {
  it('not ready when namespace context is null (both required fields missing)', () => {
    const result = checkReadiness('GENERATE_PROPOSAL', null, makeChatCtx())
    expect(result.ready).toBe(false)
    const requiredMissing = result.missingFields.filter((f) => f.required)
    expect(requiredMissing.map((f) => f.field)).toContain('clientName')
    expect(requiredMissing.map((f) => f.field)).toContain('industry')
  })

  it('not ready when clientName is missing', () => {
    const ctx = makeContext({ industry: 'Finance' })
    const result = checkReadiness('GENERATE_PROPOSAL', ctx, makeChatCtx())
    expect(result.ready).toBe(false)
    const required = result.missingFields.filter((f) => f.required)
    expect(required.map((f) => f.field)).toContain('clientName')
    expect(required.map((f) => f.field)).not.toContain('industry')
  })

  it('not ready when industry is missing', () => {
    const ctx = makeContext({ clientName: 'Acme' })
    const result = checkReadiness('GENERATE_PROPOSAL', ctx, makeChatCtx())
    expect(result.ready).toBe(false)
    const required = result.missingFields.filter((f) => f.required)
    expect(required.map((f) => f.field)).toContain('industry')
    expect(required.map((f) => f.field)).not.toContain('clientName')
  })

  it('ready when both required fields are present', () => {
    const ctx = makeContext({ clientName: 'Acme', industry: 'Tech' })
    const result = checkReadiness('GENERATE_PROPOSAL', ctx, makeChatCtx())
    expect(result.ready).toBe(true)
    expect(result.blockers).toHaveLength(0)
    expect(result.missingFields.filter((f) => f.required)).toHaveLength(0)
  })

  it('optional fields reported as missing but do not block', () => {
    const ctx = makeContext({ clientName: 'Acme', industry: 'Tech' })
    const result = checkReadiness('GENERATE_PROPOSAL', ctx, makeChatCtx())
    expect(result.ready).toBe(true)
    const optional = result.missingFields.filter((f) => !f.required)
    expect(optional.map((f) => f.field)).toContain('projectType')
    expect(optional.map((f) => f.field)).toContain('budget')
    expect(optional.map((f) => f.field)).toContain('timeline')
  })

  it('optional fields absent from missingFields when they are populated', () => {
    const ctx = makeContext({
      clientName: 'Acme',
      industry: 'Tech',
      projectType: 'Cloud Migration',
      budget: '$100k',
      timeline: '6 months',
    })
    const result = checkReadiness('GENERATE_PROPOSAL', ctx, makeChatCtx())
    expect(result.ready).toBe(true)
    expect(result.missingFields).toHaveLength(0)
  })

  it('question strings match spec exactly', () => {
    const result = checkReadiness('GENERATE_PROPOSAL', null, makeChatCtx())
    const byField = Object.fromEntries(result.missingFields.map((f) => [f.field, f.question]))
    expect(byField['clientName']).toBe('What is the client or company name?')
    expect(byField['industry']).toBe('What industry is the client in?')
    expect(byField['projectType']).toBe('What type of project is this?')
    expect(byField['budget']).toBe('Do you have a rough budget range?')
    expect(byField['timeline']).toBe('What is the expected timeline?')
  })

  it('no blockers regardless of proposal/template state', () => {
    const result = checkReadiness('GENERATE_PROPOSAL', null, makeChatCtx())
    expect(result.blockers).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// MODIFY_PROPOSAL
// ---------------------------------------------------------------------------

describe('MODIFY_PROPOSAL', () => {
  it('not ready when no proposals exist', () => {
    const result = checkReadiness('MODIFY_PROPOSAL', null, makeChatCtx({ proposals: [] }))
    expect(result.ready).toBe(false)
    expect(result.blockers).toHaveLength(1)
    expect(result.blockers[0]).toBe('No proposals exist in this namespace. Generate one first.')
  })

  it('ready when at least one proposal exists', () => {
    const chatCtx = makeChatCtx({ proposals: [{ fileName: 'acme.md', status: 'draft' }] })
    const result = checkReadiness('MODIFY_PROPOSAL', null, chatCtx)
    expect(result.ready).toBe(true)
    expect(result.blockers).toHaveLength(0)
  })

  it('ready regardless of proposal status', () => {
    for (const status of ['draft', 'under_review', 'approved', 'finalized']) {
      const chatCtx = makeChatCtx({ proposals: [{ fileName: 'p.md', status }] })
      const result = checkReadiness('MODIFY_PROPOSAL', null, chatCtx)
      expect(result.ready).toBe(true)
    }
  })

  it('ready with multiple proposals', () => {
    const chatCtx = makeChatCtx({
      proposals: [
        { fileName: 'a.md', status: 'draft' },
        { fileName: 'b.md', status: 'approved' },
      ],
    })
    const result = checkReadiness('MODIFY_PROPOSAL', null, chatCtx)
    expect(result.ready).toBe(true)
  })

  it('namespace context is irrelevant (no required fields)', () => {
    const chatCtx = makeChatCtx({ proposals: [{ fileName: 'p.md', status: 'draft' }] })
    const result = checkReadiness('MODIFY_PROPOSAL', null, chatCtx)
    expect(result.missingFields).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// GENERATE_MICROSITE
// ---------------------------------------------------------------------------

describe('GENERATE_MICROSITE', () => {
  it('not ready when no proposals exist at all', () => {
    const result = checkReadiness('GENERATE_MICROSITE', null, makeChatCtx({ proposals: [] }))
    expect(result.ready).toBe(false)
    expect(result.blockers[0]).toBe('No proposals exist. Generate and approve a proposal first.')
  })

  it('not ready when only draft proposals exist — blocker includes count', () => {
    const chatCtx = makeChatCtx({
      proposals: [
        { fileName: 'a.md', status: 'draft' },
        { fileName: 'b.md', status: 'draft' },
      ],
    })
    const result = checkReadiness('GENERATE_MICROSITE', null, chatCtx)
    expect(result.ready).toBe(false)
    expect(result.blockers[0]).toContain('2')
    expect(result.blockers[0]).toContain('draft/review')
    expect(result.blockers[0]).toContain('Approve one first')
  })

  it('not ready when only under_review proposals exist — blocker includes count', () => {
    const chatCtx = makeChatCtx({
      proposals: [{ fileName: 'a.md', status: 'under_review' }],
    })
    const result = checkReadiness('GENERATE_MICROSITE', null, chatCtx)
    expect(result.ready).toBe(false)
    expect(result.blockers[0]).toContain('1')
  })

  it('not ready when mix of draft and under_review but none approved', () => {
    const chatCtx = makeChatCtx({
      proposals: [
        { fileName: 'a.md', status: 'draft' },
        { fileName: 'b.md', status: 'under_review' },
        { fileName: 'c.md', status: 'draft' },
      ],
    })
    const result = checkReadiness('GENERATE_MICROSITE', null, chatCtx)
    expect(result.ready).toBe(false)
    expect(result.blockers[0]).toContain('3')
  })

  it('ready when at least one approved proposal exists', () => {
    const chatCtx = makeChatCtx({
      proposals: [
        { fileName: 'a.md', status: 'draft' },
        { fileName: 'b.md', status: 'approved' },
      ],
    })
    const result = checkReadiness('GENERATE_MICROSITE', null, chatCtx)
    expect(result.ready).toBe(true)
    expect(result.blockers).toHaveLength(0)
  })

  it('ready when at least one finalized proposal exists', () => {
    const chatCtx = makeChatCtx({
      proposals: [{ fileName: 'final.md', status: 'finalized' }],
    })
    const result = checkReadiness('GENERATE_MICROSITE', null, chatCtx)
    expect(result.ready).toBe(true)
  })

  it('ready when both approved and finalized proposals exist', () => {
    const chatCtx = makeChatCtx({
      proposals: [
        { fileName: 'a.md', status: 'approved' },
        { fileName: 'b.md', status: 'finalized' },
      ],
    })
    const result = checkReadiness('GENERATE_MICROSITE', null, chatCtx)
    expect(result.ready).toBe(true)
  })

  it('no required missingFields', () => {
    const result = checkReadiness('GENERATE_MICROSITE', null, makeChatCtx())
    expect(result.missingFields).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// GENERATE_TEMPLATE
// ---------------------------------------------------------------------------

describe('GENERATE_TEMPLATE', () => {
  it('always ready regardless of context', () => {
    expect(checkReadiness('GENERATE_TEMPLATE', null, makeChatCtx()).ready).toBe(true)
    expect(checkReadiness('GENERATE_TEMPLATE', makeContext(), makeChatCtx()).ready).toBe(true)
    expect(
      checkReadiness('GENERATE_TEMPLATE', null, makeChatCtx({ templates: [] })).ready,
    ).toBe(true)
  })

  it('no missingFields and no blockers', () => {
    const result = checkReadiness('GENERATE_TEMPLATE', null, makeChatCtx())
    expect(result.missingFields).toHaveLength(0)
    expect(result.blockers).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// MODIFY_TEMPLATE
// ---------------------------------------------------------------------------

describe('MODIFY_TEMPLATE', () => {
  it('not ready when no templates exist', () => {
    const result = checkReadiness('MODIFY_TEMPLATE', null, makeChatCtx({ templates: [] }))
    expect(result.ready).toBe(false)
    expect(result.blockers[0]).toBe('No templates exist. Create one first.')
  })

  it('ready when at least one template exists', () => {
    const chatCtx = makeChatCtx({ templates: [{ fileName: 'consulting.md', name: 'Consulting' }] })
    const result = checkReadiness('MODIFY_TEMPLATE', null, chatCtx)
    expect(result.ready).toBe(true)
    expect(result.blockers).toHaveLength(0)
  })

  it('ready with multiple templates', () => {
    const chatCtx = makeChatCtx({
      templates: [
        { fileName: 'a.md', name: 'A' },
        { fileName: 'b.md', name: 'B' },
      ],
    })
    expect(checkReadiness('MODIFY_TEMPLATE', null, chatCtx).ready).toBe(true)
  })

  it('no required missingFields', () => {
    const result = checkReadiness('MODIFY_TEMPLATE', null, makeChatCtx())
    expect(result.missingFields).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Always-ready intents
// ---------------------------------------------------------------------------

describe('always-ready intents', () => {
  const alwaysReady: Array<Parameters<typeof checkReadiness>[0]> = [
    'UPDATE_REQUIREMENTS',
    'QUERY',
    'STATUS_CHECK',
    'INGEST_GUIDANCE',
    'GREETING',
    'GENERAL_CHAT',
    'UNKNOWN',
  ]

  for (const intent of alwaysReady) {
    describe(intent, () => {
      it('ready with null context and empty chatContext', () => {
        const result = checkReadiness(intent, null, makeChatCtx())
        expect(result.ready).toBe(true)
        expect(result.missingFields).toHaveLength(0)
        expect(result.blockers).toHaveLength(0)
      })

      it('ready even with proposals/templates populated', () => {
        const chatCtx = makeChatCtx({
          proposals: [{ fileName: 'p.md', status: 'draft' }],
          templates: [{ fileName: 't.md' }],
        })
        const result = checkReadiness(intent, makeContext({ clientName: 'X' }), chatCtx)
        expect(result.ready).toBe(true)
      })
    })
  }

  it('GENERAL_CHAT is always ready — not blocked even with no context', () => {
    // GENERAL_CHAT readiness = true so the pipeline can continue to the
    // deterministic decline stage. Blocking here would be wrong.
    const result = checkReadiness('GENERAL_CHAT', null, makeChatCtx())
    expect(result.ready).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ReadinessResult shape invariants
// ---------------------------------------------------------------------------

describe('result shape', () => {
  it('ready:true always has empty blockers', () => {
    const cases: Array<Parameters<typeof checkReadiness>> = [
      ['QUERY', null, makeChatCtx()],
      ['GENERATE_PROPOSAL', makeContext({ clientName: 'X', industry: 'Y' }), makeChatCtx()],
      ['MODIFY_PROPOSAL', null, makeChatCtx({ proposals: [{ fileName: 'p.md', status: 'draft' }] })],
    ]
    for (const args of cases) {
      const result: ReadinessResult = checkReadiness(...args)
      if (result.ready) {
        expect(result.blockers).toHaveLength(0)
      }
    }
  })

  it('ready:false always has at least one blocker or required missingField', () => {
    const cases: Array<Parameters<typeof checkReadiness>> = [
      ['GENERATE_PROPOSAL', null, makeChatCtx()],
      ['MODIFY_PROPOSAL', null, makeChatCtx({ proposals: [] })],
      ['GENERATE_MICROSITE', null, makeChatCtx({ proposals: [] })],
      ['MODIFY_TEMPLATE', null, makeChatCtx({ templates: [] })],
    ]
    for (const args of cases) {
      const result: ReadinessResult = checkReadiness(...args)
      expect(result.ready).toBe(false)
      const hasReason =
        result.blockers.length > 0 || result.missingFields.some((f) => f.required)
      expect(hasReason).toBe(true)
    }
  })

  it('missingField.required flag is set correctly', () => {
    const result = checkReadiness('GENERATE_PROPOSAL', null, makeChatCtx())
    for (const f of result.missingFields) {
      if (f.field === 'clientName' || f.field === 'industry') {
        expect(f.required).toBe(true)
      } else {
        expect(f.required).toBe(false)
      }
    }
  })
})
