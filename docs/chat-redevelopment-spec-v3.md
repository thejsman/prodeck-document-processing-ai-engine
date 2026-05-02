# ProDeck Chat Redevelopment — Technical Specification v3

**Version:** 3.1  
**Date:** April 14, 2026  
**Status:** Draft  
**Architecture:** Deterministic Orchestration Engine with LLM-Assisted Reasoning

---

## 0. Golden Rules

These rules are inviolable. Every design decision in this spec traces back to one of them.

| # | Rule | Implication |
|---|------|-------------|
| 1 | Chat NEVER generates final artifacts | All proposals, templates, microsites come from tools. The chat agent produces zero markdown/content directly. |
| 2 | All generation flows go through tools | Tools are the only code path that creates files. Chat orchestrates tool calls. |
| 3 | LLM output is ALWAYS validated before execution | Every LLM response (intent, plan, extraction) passes through a deterministic validator. Invalid output → safe fallback, never blind execution. |
| 4 | Deterministic layers override LLM decisions | Rule-based intent shortcuts, readiness checks, plan validators — all run BEFORE and AFTER the LLM. The LLM is an advisor, not a decider. |
| 5 | Namespace Context = single source of truth | All context about a client/project lives in `context.json` (structured requirements + knowledge base). Tools read from it. Chat updates it. No shadow state. |
| 6 | No execution without readiness | Before any tool call, a deterministic readiness check must pass. Missing required fields → ask, never guess. |
| 7 | Raw documents are never extracted directly | All documents pass through a type-aware preprocessing stage before requirement extraction. Noise is removed deterministically before LLM touches the content. |
| 8 | No general-purpose answers | The system is a proposal tool, not a general assistant. Off-topic questions are declined with a deterministic boundary response. Zero LLM tokens spent on non-project content. |

---

## 1. Pipeline Architecture

### 1.1 Chat Pipeline (per user message)

Every user message flows through exactly this 9-stage pipeline. No stage can be skipped. Each stage is a pure function or an async function with a defined contract.

```
User Message
     │
     ▼
┌─────────────────────────────────────────┐
│  Stage 1: Intent Classifier             │
│  (Deterministic rules → LLM fallback)   │
│  Output: Intent enum + confidence        │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Stage 2: Requirement Extractor         │
│  (LLM — extract facts from message)     │
│  Output: ExtractionResult                │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Stage 3: Context Merge                 │
│  (Deterministic — merge into store)     │
│  Output: Updated NamespaceContext         │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Stage 4: Readiness Engine              │
│  (Deterministic — check prerequisites)  │
│  Output: ReadinessResult (ready/missing) │
└──────────────┬──────────────────────────┘
               │
               ├── NOT READY → Skip to Stage 8 (ask missing fields)
               │
               ▼
┌─────────────────────────────────────────┐
│  Stage 5: Planner                       │
│  (LLM → strict JSON plan)              │
│  Output: AgentPlan                       │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Stage 6: Plan Validator                │
│  (Deterministic — schema + rules)       │
│  Output: ValidatedPlan | rejection       │
└──────────────┬──────────────────────────┘
               │
               ├── INVALID → Fallback response
               │
               ▼
┌─────────────────────────────────────────┐
│  Stage 7: Tool Router                   │
│  (Execute validated tool calls)          │
│  Output: ToolResult[]                    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Stage 8: Response Builder              │
│  (Deterministic templates, LLM only     │
│   when summarization needed)             │
│  Output: ChatResponse                    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Stage 9: Persist State                 │
│  (Save history, context, session state)  │
│  Output: void                            │
└─────────────────────────────────────────┘
```

### 1.2 Document Ingestion Pipeline (per uploaded document)

Runs asynchronously when a document is uploaded via `POST /ingest`. Completely separate from the chat pipeline but feeds into the same namespace context.

```
Raw Document Upload
       │
       ▼
┌──────────────────────────────────────────┐
│  Step 1: Document Type Detection         │
│  (Deterministic — filename + content)    │
│  Output: DocumentType enum               │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Step 2: Document Preprocessor           │
│  (LLM — type-specific prompt)            │
│  Noise removal, structuring, sectioning  │
│  Output: PreprocessedDocument            │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Step 3: Preprocessor Validator          │
│  (Deterministic — schema validation)     │
│  Output: Validated PreprocessedDocument   │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Step 4: Requirement Extraction          │
│  (LLM — extract structured fields from   │
│   cleaned content, NOT raw document)     │
│  Output: ExtractionResult                │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Step 5: Knowledge Entry Generation      │
│  (LLM — extract rich context entries)    │
│  Output: KnowledgeEntry[]                │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Step 6: Extraction Validator            │
│  (Deterministic — validate all outputs)  │
│  Output: Validated results               │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Step 7: Context Merge                   │
│  (Deterministic — same merge logic as    │
│   chat Stage 3)                          │
│  Output: Updated NamespaceContext         │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Step 8: FAISS Indexing                  │
│  (Existing — unchanged)                  │
│  Output: Updated vector index            │
└──────────────────────────────────────────┘
```

---

## 2. Namespace Context Model (Single Source of Truth)

### 2.1 Two-Layer Architecture

The namespace context has two layers serving two different consumers:

1. **Structured Requirements** — Machine-readable typed fields. Consumed by the readiness engine (deterministic). Drives "can we generate?" decisions.
2. **Knowledge Base** — Rich natural language entries. Consumed by the LLM planner. Drives "how should we generate?" decisions.

```typescript
// services/api/src/chat/context.types.ts

// ═══════════════════════════════════════════
// LAYER 1: Structured Requirements
// ═══════════════════════════════════════════

interface RequirementField<T> {
  value: T
  confidence: number          // 0.0 – 1.0
  source: 'user' | 'document' | 'inferred'
  updatedAt: string           // ISO timestamp
  sourceFile?: string         // which document (if source === 'document')
}

type RequirementKey =
  | 'clientName'
  | 'industry'
  | 'projectType'
  | 'budget'
  | 'timeline'
  | 'teamSize'
  | 'technicalStack'
  | 'keyObjectives'
  | 'constraints'
  | 'deliverables'
  | 'stakeholders'
  | 'contactName'

interface StructuredRequirements {
  fields: Partial<Record<RequirementKey, RequirementField<unknown>>>
  customFields: Record<string, RequirementField<string>>
}

// ═══════════════════════════════════════════
// LAYER 2: Knowledge Base
// ═══════════════════════════════════════════

type KnowledgeCategory =
  | 'requirement'       // explicit client need ("they need SOC 2 compliance")
  | 'preference'        // client preference ("CTO prefers PostgreSQL")
  | 'constraint'        // limitation or blocker ("legal review needed for data residency")
  | 'context'           // background info ("revenue ~$6M, grew $1M from snow services")
  | 'history'           // past interactions ("previously proposed $120k, they countered")
  | 'concern'           // risk or worry ("client worried about Google Ads ROI")
  | 'decision'          // firm decision made ("approved pillar content strategy")
  | 'action_item'       // next step ("agency to send proposal by end of month")
  | 'relationship'      // people and roles ("Jane is PM, CTO John approves budget")

interface KnowledgeEntry {
  id: string                           // uuid
  content: string                      // natural language fact or note
  category: KnowledgeCategory
  source: {
    type: 'document' | 'chat' | 'manual'
    fileName?: string                  // if from document
    chatSessionId?: string             // if from chat
    messageTimestamp?: string           // when in chat
  }
  extractedAt: string
  confidence: number                   // 0.0 – 1.0
  supersededBy?: string                // id of newer entry that replaces this one
}

// ═══════════════════════════════════════════
// COMBINED: Namespace Context
// ═══════════════════════════════════════════

interface NamespaceContext {
  namespace: string
  requirements: StructuredRequirements      // Layer 1: drives readiness engine
  knowledge: KnowledgeEntry[]               // Layer 2: drives LLM planner
  sources: ContextSource[]                  // which files contributed
  version: number                           // increments on every merge
  updatedAt: string
}

interface ContextSource {
  fileName: string
  documentType: DocumentType
  extractedAt: string
  fieldsExtracted: RequirementKey[]
  knowledgeEntriesCreated: number
  preprocessConfidence: number              // how clean was the preprocessing
}
```

### 2.2 Storage Path

```
{workdir}/namespaces/{namespace}/context.json
```

Replaces the previously proposed `requirements.json`. Single file, two layers.

### 2.3 Confidence Scoring by Source

| Source | Structured field confidence | Knowledge entry confidence |
|--------|---------------------------|--------------------------|
| User chat message | 0.9 | 0.85 |
| RFP document | 0.85 | 0.8 |
| Technical specification | 0.85 | 0.8 |
| Email / correspondence | 0.7 | 0.7 |
| Meeting transcript | 0.5 – 0.7 | 0.6 – 0.7 |
| Inferred (LLM reasoning) | 0.4 | 0.4 |

Meeting transcripts get a range because explicit statements ("our budget is $135k") get 0.7, while inferred facts ("seems like they're concerned about overhead") get 0.5.

---

## 3. Document Ingestion Pipeline — Detailed

### 3.1 Step 1: Document Type Detection (Deterministic)

```typescript
// services/api/src/ingestion/document-type-detector.ts

type DocumentType =
  | 'rfp'
  | 'technical_spec'
  | 'meeting_transcript'
  | 'email'
  | 'proposal_draft'
  | 'generic'

interface DetectionResult {
  type: DocumentType
  confidence: number
  signals: string[]         // what triggered the classification (for debugging)
}

function detectDocumentType(fileName: string, content: string): DetectionResult {
  const name = fileName.toLowerCase()
  const contentLower = content.toLowerCase().slice(0, 2000) // only check first 2000 chars
  const signals: string[] = []

  // --- Filename-based rules (high confidence) ---
  if (/rfp|request.for.proposal|solicitation/i.test(name)) {
    signals.push(`filename match: rfp`)
    return { type: 'rfp', confidence: 0.95, signals }
  }
  if (/meeting|minutes|call.notes|transcript|standup|sync/i.test(name)) {
    signals.push(`filename match: meeting`)
    return { type: 'meeting_transcript', confidence: 0.90, signals }
  }
  if (/tech.spec|architecture|technical|system.design|spec/i.test(name)) {
    signals.push(`filename match: technical`)
    return { type: 'technical_spec', confidence: 0.90, signals }
  }
  if (/proposal|draft/i.test(name)) {
    signals.push(`filename match: proposal`)
    return { type: 'proposal_draft', confidence: 0.85, signals }
  }

  // --- Content-based rules ---

  // Transcript indicators: Otter.ai footer, speaker patterns, filler words density
  if (contentLower.includes('transcribed by') || contentLower.includes('otter.ai')) {
    signals.push('content: otter.ai transcript marker')
    return { type: 'meeting_transcript', confidence: 0.95, signals }
  }
  // High density of conversational filler = likely transcript
  const fillerCount = (content.match(/\b(like|yeah|um|uh|okay|so|right|you know|I mean|basically)\b/gi) || []).length
  const wordCount = content.split(/\s+/).length
  const fillerRatio = fillerCount / wordCount
  if (fillerRatio > 0.04) { // >4% filler words = almost certainly a transcript
    signals.push(`content: filler ratio ${(fillerRatio * 100).toFixed(1)}%`)
    return { type: 'meeting_transcript', confidence: 0.85, signals }
  }

  // Email indicators
  if (/^(from|to|subject|date|cc|bcc)\s*:/im.test(content.slice(0, 500))) {
    signals.push('content: email header pattern')
    return { type: 'email', confidence: 0.90, signals }
  }

  // RFP indicators in content
  if (/\b(scope of work|evaluation criteria|submission deadline|proposal requirements|statement of work)\b/i.test(contentLower)) {
    signals.push('content: RFP terminology')
    return { type: 'rfp', confidence: 0.80, signals }
  }

  // Technical spec indicators
  if (/\b(architecture|API|endpoint|database|schema|deployment|infrastructure)\b/i.test(contentLower)) {
    const techTermCount = (contentLower.match(/\b(api|endpoint|database|schema|deployment|infrastructure|microservice|container|kubernetes|docker)\b/gi) || []).length
    if (techTermCount > 5) {
      signals.push(`content: ${techTermCount} technical terms`)
      return { type: 'technical_spec', confidence: 0.75, signals }
    }
  }

  signals.push('no strong signal — falling back to generic')
  return { type: 'generic', confidence: 0.50, signals }
}
```

### 3.2 Step 2: Document Preprocessor (LLM — Type-Specific)

The preprocessor transforms raw documents into structured, noise-free sections. Different document types get different prompts.

```typescript
// services/api/src/ingestion/document-preprocessor.ts

interface PreprocessedDocument {
  originalType: DocumentType
  participants?: Participant[]
  sections: DocumentSection[]
  actionItems: ActionItem[]
  rawLength: number                // word count of original
  cleanedLength: number            // word count of cleaned output
  noiseRatio: number               // how much was removed (0.0–1.0)
}

interface Participant {
  name: string
  role: string
  organization: string
  inferredFrom: string             // quote or context that identified them
}

interface DocumentSection {
  topic: string
  summary: string                  // 1-3 sentence summary
  keyFacts: string[]               // atomic factual statements
  decisions: string[]              // firm decisions made
  openQuestions: string[]           // unresolved items
  sentiment: 'positive' | 'neutral' | 'concern'
  relevantQuotes: string[]         // short supporting quotes (max 2)
}

interface ActionItem {
  owner: string                    // who is responsible
  action: string                   // what needs to happen
  deadline?: string                // when (if mentioned)
  status: 'open' | 'in_progress' | 'done'
}

async function preprocessDocument(
  fileName: string,
  content: string,
  docType: DocumentType,
  llmFn: LLMGenerateFn
): Promise<PreprocessedDocument> {
  const prompt = PREPROCESS_PROMPTS[docType]
  const raw = await llmFn(prompt(content))
  const parsed = safeParseJSON<PreprocessedDocument>(raw)

  if (!parsed) {
    // Fallback: return the content as a single generic section
    return {
      originalType: docType,
      sections: [{
        topic: 'Full Document',
        summary: content.slice(0, 500),
        keyFacts: [],
        decisions: [],
        openQuestions: [],
        sentiment: 'neutral',
        relevantQuotes: [],
      }],
      actionItems: [],
      rawLength: content.split(/\s+/).length,
      cleanedLength: content.split(/\s+/).length,
      noiseRatio: 0,
    }
  }

  return {
    ...parsed,
    originalType: docType,
    rawLength: content.split(/\s+/).length,
    cleanedLength: parsed.sections.reduce(
      (sum, s) => sum + s.summary.split(/\s+/).length + s.keyFacts.join(' ').split(/\s+/).length,
      0
    ),
    noiseRatio: 1 - (parsed.sections.length > 0 ? 0.5 : 0), // estimated
  }
}
```

### 3.3 Preprocessing Prompts by Document Type

#### Meeting Transcript Prompt

```typescript
// services/api/src/ingestion/prompts/meeting-transcript.ts

const MEETING_TRANSCRIPT_PROMPT = (content: string) => `
You are analyzing a raw meeting transcript. Meeting transcripts contain a mix of
business discussion and casual conversation (small talk, personal stories, weather,
sports, real estate, family, furniture, commute, etc).

Your job is to extract ONLY the business-relevant content.

STRICT RULES:
1. IGNORE all small talk, personal anecdotes, off-topic tangents, and social chatter
2. IGNORE greetings, goodbyes, and scheduling logistics
3. IDENTIFY participants and their roles from context clues
4. EXTRACT only business-relevant segments
5. GROUP them into distinct topics/themes
6. For each topic, capture decisions, facts, and open questions
7. Capture action items with owners and deadlines
8. Short relevant quotes that capture specific commitments or concerns (max 15 words each)

Transcript:
---
${content}
---

Respond with ONLY this JSON (no markdown, no explanation):
{
  "participants": [
    { "name": "...", "role": "...", "organization": "...", "inferredFrom": "..." }
  ],
  "sections": [
    {
      "topic": "Marketing Budget Planning",
      "summary": "Discussed 2025 marketing budget allocation...",
      "keyFacts": [
        "Last year budget was $135k, actual spend was $144k including rebranding",
        "Current Google Ads spend is approximately $20k/year"
      ],
      "decisions": ["Will prioritize website refresh and pillar content strategy"],
      "openQuestions": ["How to reallocate Google Ad spend vs organic"],
      "sentiment": "neutral",
      "relevantQuotes": ["we budgeted 135 and came in at 144"]
    }
  ],
  "actionItems": [
    { "owner": "agency", "action": "Send customizable proposal with pricing options", "deadline": "next 2 weeks", "status": "open" }
  ]
}
`
```

#### RFP Prompt

```typescript
// services/api/src/ingestion/prompts/rfp.ts

const RFP_PROMPT = (content: string) => `
You are analyzing a Request for Proposal (RFP) or similar solicitation document.
RFPs are already structured, so your job is to normalize the structure and
extract key fields.

Extract:
1. Client/issuing organization details
2. Project scope and objectives
3. Technical requirements
4. Budget constraints or range
5. Timeline and milestones
6. Evaluation criteria
7. Submission requirements
8. Compliance/regulatory requirements
9. Any specific deliverables listed

RFP Content:
---
${content}
---

Respond with ONLY this JSON:
{
  "participants": [
    { "name": "...", "role": "...", "organization": "...", "inferredFrom": "..." }
  ],
  "sections": [
    {
      "topic": "Project Scope",
      "summary": "...",
      "keyFacts": ["..."],
      "decisions": [],
      "openQuestions": [],
      "sentiment": "neutral",
      "relevantQuotes": []
    }
  ],
  "actionItems": [
    { "owner": "respondent", "action": "Submit proposal", "deadline": "...", "status": "open" }
  ]
}
`
```

#### Technical Specification Prompt

```typescript
// services/api/src/ingestion/prompts/technical-spec.ts

const TECHNICAL_SPEC_PROMPT = (content: string) => `
You are analyzing a technical specification or architecture document.

Extract:
1. System architecture overview
2. Technology stack and platform choices
3. Integration requirements (APIs, third-party services)
4. Performance requirements (latency, throughput, uptime)
5. Security and compliance requirements
6. Data model or schema requirements
7. Infrastructure requirements
8. Non-functional requirements

Technical Document:
---
${content}
---

Respond with ONLY this JSON:
{
  "sections": [
    {
      "topic": "Architecture Overview",
      "summary": "...",
      "keyFacts": ["..."],
      "decisions": ["..."],
      "openQuestions": ["..."],
      "sentiment": "neutral",
      "relevantQuotes": []
    }
  ],
  "actionItems": []
}
`
```

#### Email Prompt

```typescript
// services/api/src/ingestion/prompts/email.ts

const EMAIL_PROMPT = (content: string) => `
You are analyzing a business email or email thread.

Extract:
1. Sender and recipients (names/roles)
2. Key requests or asks
3. Decisions communicated
4. Deadlines mentioned
5. Any project requirements or constraints stated
6. Action items and their owners

IGNORE email signatures, disclaimers, forwarded headers, and auto-replies.

Email Content:
---
${content}
---

Respond with ONLY this JSON:
{
  "participants": [
    { "name": "...", "role": "...", "organization": "...", "inferredFrom": "..." }
  ],
  "sections": [
    {
      "topic": "...",
      "summary": "...",
      "keyFacts": ["..."],
      "decisions": ["..."],
      "openQuestions": ["..."],
      "sentiment": "neutral",
      "relevantQuotes": []
    }
  ],
  "actionItems": []
}
`
```

#### Generic Document Prompt

```typescript
// services/api/src/ingestion/prompts/generic.ts

const GENERIC_PROMPT = (content: string) => `
You are analyzing a business document. Extract the key topics, facts, decisions,
and action items. Group related information by topic.

Document:
---
${content}
---

Respond with ONLY this JSON:
{
  "sections": [
    {
      "topic": "...",
      "summary": "...",
      "keyFacts": ["..."],
      "decisions": ["..."],
      "openQuestions": ["..."],
      "sentiment": "neutral",
      "relevantQuotes": []
    }
  ],
  "actionItems": []
}
`
```

### 3.4 Step 3: Preprocessor Validator (Deterministic)

```typescript
// services/api/src/ingestion/preprocessor-validator.ts

import { z } from 'zod'

const ParticipantSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.string().max(200).default('unknown'),
  organization: z.string().max(200).default('unknown'),
  inferredFrom: z.string().max(500).default(''),
})

const SectionSchema = z.object({
  topic: z.string().min(1).max(200),
  summary: z.string().min(1).max(2000),
  keyFacts: z.array(z.string().max(500)).max(20).default([]),
  decisions: z.array(z.string().max(500)).max(10).default([]),
  openQuestions: z.array(z.string().max(500)).max(10).default([]),
  sentiment: z.enum(['positive', 'neutral', 'concern']).default('neutral'),
  relevantQuotes: z.array(z.string().max(200)).max(3).default([]),
})

const ActionItemSchema = z.object({
  owner: z.string().min(1).max(200),
  action: z.string().min(1).max(500),
  deadline: z.string().max(100).optional(),
  status: z.enum(['open', 'in_progress', 'done']).default('open'),
})

const PreprocessedDocumentSchema = z.object({
  participants: z.array(ParticipantSchema).max(20).default([]),
  sections: z.array(SectionSchema).min(1).max(30),
  actionItems: z.array(ActionItemSchema).max(20).default([]),
})

function validatePreprocessedDocument(raw: unknown): {
  valid: boolean
  document?: PreprocessedDocument
  errors: string[]
} {
  const result = PreprocessedDocumentSchema.safeParse(raw)
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
    }
  }
  return { valid: true, document: result.data as PreprocessedDocument, errors: [] }
}
```

### 3.5 Step 4: Requirement Extraction (from cleaned content)

This is the same extraction logic as chat Stage 2, but runs on the **preprocessed sections**, not the raw document. This is the critical difference.

```typescript
// services/api/src/ingestion/requirement-extractor.ts

async function extractRequirementsFromPreprocessed(
  preprocessed: PreprocessedDocument,
  docType: DocumentType,
  llmFn: LLMGenerateFn
): Promise<ExtractionResult> {

  // Build a clean summary from preprocessed sections
  const cleanContent = preprocessed.sections.map(s =>
    `## ${s.topic}\n${s.summary}\nFacts: ${s.keyFacts.join('; ')}\nDecisions: ${s.decisions.join('; ')}`
  ).join('\n\n')

  // Add participant info if available
  const participantContext = preprocessed.participants
    ?.map(p => `${p.name} — ${p.role} at ${p.organization}`)
    .join('\n') || 'No participants identified'

  const baseConfidence = CONFIDENCE_BY_DOC_TYPE[docType]

  const prompt = `
Extract structured project/client information from this preprocessed document summary.
This content has already been cleaned and structured — extract only facts that are
clearly stated or strongly implied.

Return ONLY a JSON object. Omit fields not mentioned. Do NOT guess or infer
values that are not supported by the content.

Extractable fields:
- clientName (string)
- industry (string)
- projectType (string)
- budget (string, include currency and qualifiers like "approximately")
- timeline (string)
- teamSize (number)
- technicalStack (string[])
- keyObjectives (string[])
- constraints (string[])
- deliverables (string[])
- stakeholders (string[])
- contactName (string)

Participants identified:
${participantContext}

Document summary:
---
${cleanContent}
---

JSON output (empty {} if nothing to extract):
`

  const raw = await llmFn(prompt)
  const parsed = safeParseJSON<Record<string, unknown>>(raw)

  if (!parsed || typeof parsed !== 'object') {
    return { fields: {}, knowledge: [], raw: raw ?? '' }
  }

  const fields: ExtractionResult['fields'] = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined) continue
    if (!VALID_REQUIREMENT_KEYS.includes(key as RequirementKey)) continue

    fields[key as RequirementKey] = {
      value,
      confidence: baseConfidence,
      source: 'document',
      updatedAt: new Date().toISOString(),
    }
  }

  return { fields, knowledge: [], raw: raw ?? '' }
}

const CONFIDENCE_BY_DOC_TYPE: Record<DocumentType, number> = {
  rfp: 0.85,
  technical_spec: 0.85,
  meeting_transcript: 0.6,       // lower — informal, may be speculative
  email: 0.7,
  proposal_draft: 0.75,
  generic: 0.65,
}
```

### 3.6 Step 5: Knowledge Entry Generation

Generates rich context entries that don't fit into structured fields. This is what makes meeting transcripts valuable — the knowledge layer captures preferences, concerns, relationships, and history.

```typescript
// services/api/src/ingestion/knowledge-extractor.ts

async function extractKnowledge(
  preprocessed: PreprocessedDocument,
  docType: DocumentType,
  fileName: string,
  llmFn: LLMGenerateFn
): Promise<KnowledgeEntry[]> {

  const cleanContent = preprocessed.sections.map(s =>
    `## ${s.topic}\n${s.summary}\nFacts: ${s.keyFacts.join('; ')}\n` +
    `Decisions: ${s.decisions.join('; ')}\nConcerns: ${s.openQuestions.join('; ')}`
  ).join('\n\n')

  const prompt = `
Extract knowledge entries from this document summary. Each entry should be a single
atomic fact, preference, concern, decision, or piece of context that would be useful
when writing a proposal or planning a project for this client.

Categories to use:
- requirement: explicit client need
- preference: client preference or opinion
- constraint: limitation or blocker
- context: background info about the company/project
- history: past interactions or previous work
- concern: risk, worry, or unresolved issue
- decision: firm decision that was made
- action_item: specific next step with an owner
- relationship: people, roles, and reporting structures

RULES:
1. Each entry must be a complete, standalone sentence
2. Do not include small talk or personal information
3. Mark confidence 0.7 for explicitly stated facts, 0.5 for inferred/implied ones
4. Maximum 25 entries — prioritize the most useful information
5. If the same fact appears in a structured requirement field, still include it
   as knowledge if the context adds nuance

Document summary:
---
${cleanContent}
---

Respond with ONLY a JSON array:
[
  { "content": "...", "category": "requirement", "confidence": 0.7 },
  { "content": "...", "category": "preference", "confidence": 0.5 }
]
`

  const raw = await llmFn(prompt)
  const parsed = safeParseJSON<Array<{ content: string; category: string; confidence: number }>>(raw)

  if (!parsed || !Array.isArray(parsed)) return []

  const now = new Date().toISOString()

  return parsed
    .filter(e =>
      e.content && typeof e.content === 'string' &&
      VALID_KNOWLEDGE_CATEGORIES.includes(e.category as KnowledgeCategory) &&
      typeof e.confidence === 'number' && e.confidence >= 0.3 && e.confidence <= 1.0
    )
    .slice(0, 25) // hard cap
    .map(e => ({
      id: generateUUID(),
      content: e.content,
      category: e.category as KnowledgeCategory,
      source: {
        type: 'document' as const,
        fileName,
      },
      extractedAt: now,
      confidence: Math.min(e.confidence, CONFIDENCE_BY_DOC_TYPE[docType]), // cap by doc type
    }))
}

const VALID_KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = [
  'requirement', 'preference', 'constraint', 'context',
  'history', 'concern', 'decision', 'action_item', 'relationship',
]
```

### 3.7 Step 6: Extraction Validator (Deterministic)

```typescript
// services/api/src/ingestion/extraction-validator.ts

import { z } from 'zod'

const KnowledgeEntrySchema = z.object({
  content: z.string().min(5).max(500),
  category: z.enum([
    'requirement', 'preference', 'constraint', 'context',
    'history', 'concern', 'decision', 'action_item', 'relationship',
  ]),
  confidence: z.number().min(0.3).max(1.0),
})

function validateExtractionResults(
  fields: ExtractionResult['fields'],
  knowledge: KnowledgeEntry[]
): { validFields: ExtractionResult['fields']; validKnowledge: KnowledgeEntry[]; errors: string[] } {
  const errors: string[] = []

  // Validate structured fields
  const validFields: ExtractionResult['fields'] = {}
  for (const [key, field] of Object.entries(fields)) {
    if (!VALID_REQUIREMENT_KEYS.includes(key as RequirementKey)) {
      errors.push(`Unknown requirement key: ${key}`)
      continue
    }
    if (field.value === null || field.value === undefined || field.value === '') {
      errors.push(`Empty value for key: ${key}`)
      continue
    }
    validFields[key as RequirementKey] = field
  }

  // Validate knowledge entries
  const validKnowledge: KnowledgeEntry[] = []
  for (const entry of knowledge) {
    const result = KnowledgeEntrySchema.safeParse(entry)
    if (result.success) {
      validKnowledge.push(entry)
    } else {
      errors.push(`Invalid knowledge entry: ${result.error.errors[0]?.message}`)
    }
  }

  return { validFields, validKnowledge, errors }
}
```

### 3.8 Step 7: Context Merge (Deterministic)

Same merge logic used by both ingestion pipeline and chat pipeline.

```typescript
// services/api/src/chat/context.service.ts

class ContextService {
  constructor(private workdir: string) {}

  async get(namespace: string): Promise<NamespaceContext | null> {
    const path = `${this.workdir}/namespaces/${namespace}/context.json`
    // Read and parse, return null if not found
  }

  async save(namespace: string, context: NamespaceContext): Promise<void> {
    const path = `${this.workdir}/namespaces/${namespace}/context.json`
    // Write atomically
  }

  // --- Merge structured requirements ---

  async mergeRequirements(
    namespace: string,
    incoming: ExtractionResult['fields'],
    source?: ContextSource
  ): Promise<NamespaceContext> {
    const current = await this.get(namespace) || this.createEmpty(namespace)

    for (const [key, field] of Object.entries(incoming)) {
      if (ARRAY_FIELDS.includes(key as RequirementKey)) {
        current.requirements.fields[key] = mergeArrayField(
          current.requirements.fields[key], field
        )
      } else {
        current.requirements.fields[key] = mergeField(
          current.requirements.fields[key], field
        )
      }
    }

    if (source) current.sources.push(source)
    current.version += 1
    current.updatedAt = new Date().toISOString()

    await this.save(namespace, current)
    return current
  }

  // --- Merge knowledge entries ---

  async mergeKnowledge(
    namespace: string,
    incoming: KnowledgeEntry[]
  ): Promise<NamespaceContext> {
    const current = await this.get(namespace) || this.createEmpty(namespace)

    for (const entry of incoming) {
      // Check for duplicates/superseded entries
      const existingIdx = current.knowledge.findIndex(k =>
        k.category === entry.category &&
        this.isSemanticallyDuplicate(k.content, entry.content)
      )

      if (existingIdx >= 0) {
        const existing = current.knowledge[existingIdx]
        if (entry.confidence >= existing.confidence) {
          // Mark old as superseded, add new
          existing.supersededBy = entry.id
          current.knowledge.push(entry)
        }
        // Otherwise keep existing, discard incoming
      } else {
        current.knowledge.push(entry)
      }
    }

    // Cap total knowledge entries per namespace
    const active = current.knowledge.filter(k => !k.supersededBy)
    if (active.length > MAX_KNOWLEDGE_ENTRIES) {
      // Evict lowest confidence entries
      const sorted = active.sort((a, b) => a.confidence - b.confidence)
      const toEvict = sorted.slice(0, active.length - MAX_KNOWLEDGE_ENTRIES)
      for (const entry of toEvict) {
        entry.supersededBy = 'evicted'
      }
    }

    current.version += 1
    current.updatedAt = new Date().toISOString()

    await this.save(namespace, current)
    return current
  }

  // --- Simple duplicate detection ---
  private isSemanticallyDuplicate(a: string, b: string): boolean {
    // Normalize and check Jaccard similarity on word sets
    const wordsA = new Set(a.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/))
    const wordsB = new Set(b.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/))
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)))
    const union = new Set([...wordsA, ...wordsB])
    return intersection.size / union.size > 0.7 // >70% word overlap = duplicate
  }

  private createEmpty(namespace: string): NamespaceContext {
    return {
      namespace,
      requirements: { fields: {}, customFields: {} },
      knowledge: [],
      sources: [],
      version: 0,
      updatedAt: new Date().toISOString(),
    }
  }
}

const MAX_KNOWLEDGE_ENTRIES = 200  // per namespace
const ARRAY_FIELDS: RequirementKey[] = [
  'technicalStack', 'keyObjectives', 'constraints',
  'deliverables', 'stakeholders',
]
```

### 3.9 Merge Rules for Structured Fields (unchanged)

```typescript
function mergeField<T>(
  existing: RequirementField<T> | undefined,
  incoming: RequirementField<T>
): RequirementField<T> {
  if (!existing) return incoming
  // User-stated always wins over document-extracted
  if (incoming.source === 'user' && existing.source === 'document') return incoming
  // Same source → higher confidence wins
  if (incoming.confidence >= existing.confidence) return incoming
  return existing
}

function mergeArrayField<T>(
  existing: RequirementField<T[]> | undefined,
  incoming: RequirementField<T[]>
): RequirementField<T[]> {
  if (!existing) return incoming
  const merged = [...new Set([...(existing.value || []), ...(incoming.value || [])])]
  return {
    value: merged,
    confidence: Math.max(existing.confidence, incoming.confidence),
    source: incoming.source === 'user' ? 'user' : existing.source,
    updatedAt: incoming.updatedAt,
  }
}
```

### 3.10 Full Ingestion Orchestrator

```typescript
// services/api/src/ingestion/ingest-orchestrator.ts

async function processDocument(
  namespace: string,
  fileName: string,
  content: string,
  llmFn: LLMGenerateFn,
  contextService: ContextService
): Promise<IngestionResult> {
  const startTime = Date.now()

  // Step 1: Detect document type
  const detection = detectDocumentType(fileName, content)

  // Step 2: Preprocess
  const preprocessed = await preprocessDocument(fileName, content, detection.type, llmFn)

  // Step 3: Validate preprocessing
  const ppValidation = validatePreprocessedDocument(preprocessed)
  if (!ppValidation.valid) {
    console.warn(`Preprocessing validation failed for ${fileName}:`, ppValidation.errors)
    // Continue with raw fallback — don't block ingestion
  }
  const cleanDoc = ppValidation.document || preprocessed

  // Step 4: Extract structured requirements
  const extraction = await extractRequirementsFromPreprocessed(cleanDoc, detection.type, llmFn)

  // Step 5: Extract knowledge entries
  const knowledge = await extractKnowledge(cleanDoc, detection.type, fileName, llmFn)

  // Step 6: Validate extraction
  const { validFields, validKnowledge, errors } = validateExtractionResults(
    extraction.fields, knowledge
  )

  // Step 7: Merge into namespace context
  const source: ContextSource = {
    fileName,
    documentType: detection.type,
    extractedAt: new Date().toISOString(),
    fieldsExtracted: Object.keys(validFields) as RequirementKey[],
    knowledgeEntriesCreated: validKnowledge.length,
    preprocessConfidence: detection.confidence,
  }

  await contextService.mergeRequirements(namespace, validFields, source)
  await contextService.mergeKnowledge(namespace, validKnowledge)

  // Step 8: FAISS indexing (existing — unchanged)
  await faissIndexService.index(namespace, fileName, content)

  return {
    fileName,
    documentType: detection.type,
    detectionConfidence: detection.confidence,
    fieldsExtracted: Object.keys(validFields),
    knowledgeEntriesCreated: validKnowledge.length,
    preprocessingStats: {
      rawWordCount: preprocessed.rawLength,
      cleanedWordCount: preprocessed.cleanedLength,
      sectionsFound: cleanDoc.sections.length,
      participantsFound: cleanDoc.participants?.length || 0,
      actionItemsFound: cleanDoc.actionItems.length,
    },
    validationErrors: errors,
    durationMs: Date.now() - startTime,
  }
}
```

### 3.11 Example: What Happens When the LC Grounds Transcript Is Ingested

```
Upload: "LC_Grounds1.txt" (8,156 words)

Step 1 — Document Type Detection:
  Signal: filler ratio 6.2% (> 4% threshold)
  Signal: content contains "Transcribed by https://otter.ai"
  → Type: meeting_transcript (confidence: 0.95)

Step 2 — Preprocessing (meeting-specific prompt):
  Participants identified:
    - Clark (Owner, LC Grounds — client)
    - Ben (Marketing strategist, KM agency)
    - Chris (Account manager, KM agency)
  
  Sections extracted:
    1. "Marketing Budget & Attribution"
       keyFacts: ["Last year budget $135k, actual $144k with rebranding",
                  "Google Ads spend ~$20k/year", "Revenue ~$6M, grew $1M"]
       decisions: ["Will set up attribution reporting"]
       sentiment: concern
    
    2. "Pillar Content SEO Strategy"
       keyFacts: ["New approach: one long-form pillar piece + 10-12 sub-posts",
                  "Pushed across website, YouTube, Reddit, social",
                  "Focus on outdoor living spaces as primary topic"]
       decisions: ["Will do one pillar topic first for 6-month test"]
       sentiment: positive
    
    3. "Website Refresh"
       keyFacts: ["Current site is 4 years old", "Estimated $13-15k",
                  "Would be ~$2k/month over 6-12 months"]
       decisions: ["Prioritized as important"]
       sentiment: neutral
    
    4. "Lead Response & Automation"
       keyFacts: ["Current response time too slow for client expectations",
                  "Interested in CallRail virtual assistant ($700 install, $500/mo)",
                  "Want automated calendar booking for new leads"]
       decisions: []
       openQuestions: ["Hire person vs automate?"]
       sentiment: concern
    
    5. "Proposed Monthly Budget"
       keyFacts: ["~$10k/month (website refresh $2k + pillar content $7.5k + ad spend)",
                  "Total annual ~$120k plus ad spend"]
    
  Action items:
    - Owner: KM agency — "Send customizable clickable proposal with pricing"
    - Owner: KM agency — "Schedule 1-day on-site audit for attribution + workflow"
    - Owner: Clark — "Provide revenue/close-rate data for attribution calculator"
  
  Raw: 8,156 words → Cleaned: ~850 words (89.6% noise removed)

Step 3 — Validation: PASS (5 sections, 3 participants, 3 action items)

Step 4 — Requirement Extraction (from cleaned content):
  {
    clientName: { value: "LC Grounds", confidence: 0.6, source: "document" },
    industry: { value: "Landscaping / Outdoor Services", confidence: 0.6, source: "document" },
    budget: { value: "~$135-144k/year for marketing", confidence: 0.6, source: "document" },
    stakeholders: { value: ["Clark (Owner)", "Mary Ann (Account Manager)"], confidence: 0.6 },
    keyObjectives: { value: [
      "Improve lead response automation",
      "Build pillar content SEO presence",
      "Website refresh",
      "Attribution reporting for ad spend ROI"
    ], confidence: 0.6 }
  }

Step 5 — Knowledge Entries (14 entries):
  [
    { content: "LC Grounds is a landscaping company in Northern Virginia, Great Falls area", category: "context", confidence: 0.7 },
    { content: "Annual revenue approximately $6M, grew ~$1M last year partly from snow services", category: "context", confidence: 0.6 },
    { content: "Marketing budget last year was $135k, came in at $144k after adding rebranding costs", category: "context", confidence: 0.7 },
    { content: "Client questioning ROI of $20k+ annual Google Ads spend — wants attribution data before committing", category: "concern", confidence: 0.7 },
    { content: "Agency proposing pillar content SEO strategy as replacement for traditional blog-based SEO", category: "context", confidence: 0.7 },
    { content: "Client interested in outdoor living spaces and lawn maintenance as two primary service pillars", category: "preference", confidence: 0.6 },
    { content: "Client concerned about over-specializing in one service area for SEO — wants balanced coverage", category: "concern", confidence: 0.6 },
    { content: "Client values personal touch and relationships in sales process — resistant to fully automated approach", category: "preference", confidence: 0.7 },
    { content: "Lead response time is a major pain point — calls not being answered or handled properly", category: "concern", confidence: 0.7 },
    { content: "Employee CC handles phones but quality is inconsistent — missed calls, poor scheduling", category: "concern", confidence: 0.6 },
    { content: "Company is hiring and growing — needs marketing to support lead flow for additional crews", category: "requirement", confidence: 0.6 },
    { content: "Website is 4 years old, refresh estimated at $13-15k, considered high priority", category: "requirement", confidence: 0.7 },
    { content: "Agency proposed ~$10k/month total (website $2k + pillar content $7.5k + ad management)", category: "context", confidence: 0.7 },
    { content: "Agency to send customizable proposal with pricing options in next 2 weeks", category: "action_item", confidence: 0.7 }
  ]

Step 6 — Validation: PASS (5 fields, 14 knowledge entries, 0 errors)
Step 7 — Merged into lc-grounds namespace context.json (version 1)
Step 8 — FAISS indexed for RAG search
```

---

## 4. Chat Pipeline Stage 1 — Intent Classifier

### 4.1 Intent Enum

```typescript
// services/api/src/chat/intents.ts

type Intent =
  | 'GENERATE_PROPOSAL'
  | 'MODIFY_PROPOSAL'
  | 'GENERATE_TEMPLATE'
  | 'MODIFY_TEMPLATE'
  | 'GENERATE_MICROSITE'
  | 'UPDATE_REQUIREMENTS'
  | 'QUERY'
  | 'STATUS_CHECK'
  | 'INGEST_GUIDANCE'
  | 'GREETING'
  | 'GENERAL_CHAT'          // off-topic but coherent — decline + redirect
  | 'UNKNOWN'               // gibberish, unparseable
```

### 4.2 Hybrid Classification

Deterministic rules fire first. LLM fallback only if no rule matches.

```typescript
// services/api/src/chat/intent-classifier.ts

interface ClassificationResult {
  intent: Intent
  confidence: number
  source: 'rule' | 'llm'
  matchedRule?: string
}

const INTENT_RULES: Array<{
  id: string
  test: (message: string, context: ChatContext) => boolean
  intent: Intent
  confidence: number
}> = [
  // --- HIGH PRIORITY: Contextual rules (conversation state) ---
  {
    id: 'ctx_awaiting_proposal_input',
    test: (_msg, ctx) => ctx.awaitingInput?.intent === 'GENERATE_PROPOSAL',
    intent: 'GENERATE_PROPOSAL',
    confidence: 0.95,
  },
  {
    id: 'ctx_awaiting_microsite_input',
    test: (_msg, ctx) => ctx.awaitingInput?.intent === 'GENERATE_MICROSITE',
    intent: 'GENERATE_MICROSITE',
    confidence: 0.95,
  },

  // --- KEYWORD RULES: Most-specific to least-specific ---
  {
    id: 'kw_microsite',
    test: (msg) => /\b(microsite|presentation|convert\s+to\s+(a\s+)?present)/i.test(msg),
    intent: 'GENERATE_MICROSITE',
    confidence: 0.90,
  },
  {
    id: 'kw_template_create',
    test: (msg) => /\b(create|generate|build|new)\b.*\btemplate\b/i.test(msg),
    intent: 'GENERATE_TEMPLATE',
    confidence: 0.90,
  },
  {
    id: 'kw_template_modify',
    test: (msg) => /\b(modify|edit|change|update|add|remove)\b.*\btemplate\b/i.test(msg),
    intent: 'MODIFY_TEMPLATE',
    confidence: 0.90,
  },
  {
    id: 'kw_proposal_edit',
    test: (msg) => /\b(make|rewrite|shorten|expand|improve|edit|change)\b.*\b(section|summary|pricing|exec)/i.test(msg),
    intent: 'MODIFY_PROPOSAL',
    confidence: 0.85,
  },
  {
    id: 'kw_proposal_create',
    test: (msg) => /\b(create|generate|write|draft|build|need)\b.*\bproposal\b/i.test(msg),
    intent: 'GENERATE_PROPOSAL',
    confidence: 0.90,
  },
  {
    id: 'kw_requirement_update',
    test: (msg) => /(\$[\d,]+|budget\s*(is|changed|updated|=)|timeline\s*(is|changed)|they\s+(want|prefer|need|require))/i.test(msg),
    intent: 'UPDATE_REQUIREMENTS',
    confidence: 0.85,
  },
  {
    id: 'kw_status',
    test: (msg) => /\b(status|version|history|list\s+proposals?|show\s+me)\b/i.test(msg),
    intent: 'STATUS_CHECK',
    confidence: 0.80,
  },
  {
    id: 'kw_query',
    test: (msg) => /\b(what|how|when|who|tell\s+me|requirements?|summarize|search)\b/i.test(msg),
    intent: 'QUERY',
    confidence: 0.70,
  },
  {
    id: 'kw_upload',
    test: (msg) => /\b(upload|ingest|add\s+documents?|import)\b/i.test(msg),
    intent: 'INGEST_GUIDANCE',
    confidence: 0.85,
  },
  {
    id: 'kw_greeting',
    test: (msg) => /^(hi|hello|hey|good\s+(morning|afternoon|evening)|what'?s\s+up)\b/i.test(msg) && msg.length < 30,
    intent: 'GREETING',
    confidence: 0.95,
  },
]

function classifyIntent(message: string, context: ChatContext): ClassificationResult {
  for (const rule of INTENT_RULES) {
    if (rule.test(message, context)) {
      return { intent: rule.intent, confidence: rule.confidence, source: 'rule', matchedRule: rule.id }
    }
  }
  return llmClassifyIntent(message, context)
}
```

### 4.3 LLM Fallback

```typescript
async function llmClassifyIntent(message: string, context: ChatContext): Promise<ClassificationResult> {
  const prompt = `
Classify the user's intent into exactly one category:

PROJECT-RELATED (about proposals, templates, microsites, documents, client work):
  GENERATE_PROPOSAL, MODIFY_PROPOSAL, GENERATE_TEMPLATE, MODIFY_TEMPLATE,
  GENERATE_MICROSITE, UPDATE_REQUIREMENTS, QUERY, STATUS_CHECK, INGEST_GUIDANCE

NON-PROJECT:
  GREETING — hello, hi, good morning (short social opener)
  GENERAL_CHAT — any message NOT related to proposals, templates, microsites,
    documents, or project work. Includes: general knowledge questions, personal
    requests, jokes, weather, math, coding help, writing emails, off-topic chat.
  UNKNOWN — gibberish, empty, completely unparseable

IMPORTANT: If the message is ambiguous but COULD relate to project work
(e.g., "help me with pricing", "summarize this", "analyze the competition"),
classify it as the most relevant project intent (QUERY, UPDATE_REQUIREMENTS, etc.),
NOT as GENERAL_CHAT. Only use GENERAL_CHAT when the message is clearly unrelated
to proposals, templates, microsites, or client project work.

Context:
- Namespace: ${context.namespace}
- Active proposals: ${context.proposals.map(p => p.fileName).join(', ') || 'none'}
- Recent conversation topic: ${context.recentTopic || 'none'}

User message: "${message}"

Respond with ONLY this JSON:
{"intent": "...", "confidence": 0.XX}
`
  const raw = await llmGenerateFn(prompt)
  const parsed = safeParseJSON<{ intent: string; confidence: number }>(raw)

  if (!parsed) return { intent: 'UNKNOWN', confidence: 0, source: 'llm' }
  if (!VALID_INTENTS.includes(parsed.intent as Intent)) return { intent: 'UNKNOWN', confidence: 0, source: 'llm' }
  if (typeof parsed.confidence !== 'number' || parsed.confidence < 0.6) return { intent: 'UNKNOWN', confidence: parsed.confidence ?? 0, source: 'llm' }

  return { intent: parsed.intent as Intent, confidence: parsed.confidence, source: 'llm' }
}
```

---

## 5. Chat Pipeline Stage 2 — Requirement Extractor (from chat messages)

Same extraction pattern as ingestion, but simpler — chat messages are short, already in natural language, and don't need preprocessing.

```typescript
// services/api/src/chat/requirement-extractor.ts

interface ExtractionResult {
  fields: Partial<Record<RequirementKey, RequirementField<unknown>>>
  knowledge: KnowledgeEntry[]
  raw: string
}

async function extractFromMessage(
  message: string,
  currentContext: NamespaceContext | null,
  llmFn: LLMGenerateFn
): Promise<ExtractionResult> {
  // Skip for greetings, status checks, short messages
  if (message.length < 10) return { fields: {}, knowledge: [], raw: '' }

  const prompt = `
Extract factual project/client information from this chat message.
Return ONLY a JSON object. Omit fields not mentioned. Do not guess.

Extractable fields:
- clientName (string)
- industry (string)
- projectType (string)
- budget (string)
- timeline (string)
- teamSize (number)
- technicalStack (string[])
- keyObjectives (string[])
- constraints (string[])
- deliverables (string[])
- stakeholders (string[])
- contactName (string)

Current known context: ${JSON.stringify(currentContext?.requirements?.fields || {})}

User message: "${message}"

JSON output (empty {} if nothing to extract):
`

  const raw = await llmFn(prompt)
  const parsed = safeParseJSON<Record<string, unknown>>(raw)
  if (!parsed || typeof parsed !== 'object') return { fields: {}, knowledge: [], raw: raw ?? '' }

  const fields: ExtractionResult['fields'] = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined) continue
    if (!VALID_REQUIREMENT_KEYS.includes(key as RequirementKey)) continue
    fields[key as RequirementKey] = {
      value,
      confidence: 0.9,     // user-stated facts get highest confidence
      source: 'user',
      updatedAt: new Date().toISOString(),
    }
  }

  return { fields, knowledge: [], raw: raw ?? '' }
}
```

---

## 6. Chat Pipeline Stage 3 — Context Merge (Deterministic)

Uses the same `ContextService.mergeRequirements()` defined in Section 3.8. No separate logic.

---

## 7. Chat Pipeline Stage 4 — Readiness Engine (Deterministic)

```typescript
// services/api/src/chat/readiness-engine.ts

interface ReadinessResult {
  ready: boolean
  missingFields: MissingField[]
  blockers: string[]
}

interface MissingField {
  field: RequirementKey
  question: string
  required: boolean
}

const READINESS_RULES: Record<Intent, ReadinessCheck> = {
  GENERATE_PROPOSAL: {
    required: [
      { field: 'clientName', question: 'What is the client or company name?' },
      { field: 'industry', question: 'What industry is the client in?' },
    ],
    optional: [
      { field: 'projectType', question: 'What type of project is this?' },
      { field: 'budget', question: 'Do you have a rough budget range?' },
      { field: 'timeline', question: 'What is the expected timeline?' },
    ],
    customCheck: null,
  },
  MODIFY_PROPOSAL: {
    required: [], optional: [],
    customCheck: (ctx) => {
      if (ctx.proposals.length === 0) return { ready: false, blockers: ['No proposals exist in this namespace. Generate one first.'] }
      return { ready: true, blockers: [] }
    },
  },
  GENERATE_MICROSITE: {
    required: [], optional: [],
    customCheck: (ctx) => {
      const eligible = ctx.proposals.filter(p => p.status === 'approved' || p.status === 'finalized')
      if (eligible.length === 0) {
        const drafts = ctx.proposals.filter(p => p.status === 'draft' || p.status === 'under_review')
        if (drafts.length > 0) {
          return { ready: false, blockers: [
            `No approved/finalized proposals. You have ${drafts.length} in draft/review. Approve one first, or I can change the status.`
          ] }
        }
        return { ready: false, blockers: ['No proposals exist. Generate and approve a proposal first.'] }
      }
      return { ready: true, blockers: [] }
    },
  },
  GENERATE_TEMPLATE: { required: [], optional: [], customCheck: null },
  MODIFY_TEMPLATE: {
    required: [], optional: [],
    customCheck: (ctx) => {
      if (ctx.templates.length === 0) return { ready: false, blockers: ['No templates exist. Create one first.'] }
      return { ready: true, blockers: [] }
    },
  },
  UPDATE_REQUIREMENTS: { required: [], optional: [], customCheck: null },
  QUERY: { required: [], optional: [], customCheck: null },
  STATUS_CHECK: { required: [], optional: [], customCheck: null },
  INGEST_GUIDANCE: { required: [], optional: [], customCheck: null },
  GREETING: { required: [], optional: [], customCheck: null },
  GENERAL_CHAT: { required: [], optional: [], customCheck: null },  // always "ready" — goes to deterministic decline
  UNKNOWN: { required: [], optional: [], customCheck: null },
}

function checkReadiness(intent: Intent, context: NamespaceContext | null, chatContext: ChatContext): ReadinessResult {
  const rules = READINESS_RULES[intent]
  const missing: MissingField[] = []
  const blockers: string[] = []

  for (const req of rules.required) {
    const field = context?.requirements?.fields[req.field]
    if (!field?.value) missing.push({ ...req, required: true })
  }

  if (rules.customCheck) {
    const custom = rules.customCheck(chatContext)
    if (!custom.ready) blockers.push(...custom.blockers)
  }

  return { ready: missing.filter(m => m.required).length === 0 && blockers.length === 0, missingFields: missing, blockers }
}
```

---

## 8. Chat Pipeline Stage 5 — Planner (LLM → Strict JSON)

Only reached if readiness passes. The planner now receives knowledge entries in its context.

```typescript
// services/api/src/chat/planner.ts

interface AgentPlan {
  intent: Intent
  actions: AgentAction[]
}

type AgentAction =
  | { type: 'ASK'; question: string }
  | { type: 'UPDATE_REQUIREMENTS'; data: Record<string, unknown> }
  | { type: 'CALL_TOOL'; tool: ToolName; params: Record<string, unknown> }
  | { type: 'RESPOND'; message: string }

type ToolName =
  | 'generate_proposal' | 'generate_template' | 'modify_template'
  | 'generate_microsite' | 'edit_proposal_section' | 'search_documents'
  | 'list_proposals' | 'list_templates' | 'get_proposal_status' | 'set_proposal_status'

async function buildPlan(
  intent: Intent,
  message: string,
  chatContext: ChatContext,
  nsContext: NamespaceContext
): Promise<AgentPlan | null> {

  // Select relevant knowledge entries for the planner
  const relevantKnowledge = selectRelevantKnowledge(intent, nsContext.knowledge)

  const prompt = `
You are a plan builder for ProDeck, a consulting proposal tool.
Produce an action plan as strict JSON. Nothing else.

## Intent: ${intent}
## User Message: "${message}"

## Available Tools
- generate_proposal: params { client, industry, template?, teamSize?, duration?, ratePerWeek? }
- generate_template: params { description, name? }
- modify_template: params { templateName, instruction }
- generate_microsite: params { proposalFileName, companyName?, tagline?, primaryColor?, secondaryColor?, theme?, customInstructions? }
- edit_proposal_section: params { proposalFileName, sectionName, instruction }
- search_documents: params { query }
- list_proposals: params {}
- list_templates: params {}
- get_proposal_status: params { proposalFileName }
- set_proposal_status: params { proposalFileName, status }

## Current Requirements
${JSON.stringify(nsContext.requirements.fields)}

## Relevant Project Knowledge
${relevantKnowledge.map(k => `[${k.category}] ${k.content}`).join('\n')}

## Available Artifacts
- Proposals: ${JSON.stringify(chatContext.proposals)}
- Templates: ${JSON.stringify(chatContext.templates)}
- Documents: ${chatContext.ingestedDocuments.map(d => d.fileName).join(', ') || 'none'}

## Rules
1. Use ONLY action types: ASK, UPDATE_REQUIREMENTS, CALL_TOOL, RESPOND
2. Use ONLY the tool names listed above
3. If user provides info to save, include UPDATE_REQUIREMENTS before CALL_TOOL
4. For MODIFY_PROPOSAL, use edit_proposal_section tool
5. For QUERY, use search_documents or RESPOND with known info
6. If multiple proposals exist and user doesn't specify, include ASK
7. NEVER invent tool names or action types
8. Use knowledge entries to enrich tool parameters when relevant

Respond with ONLY this JSON:
{ "intent": "${intent}", "actions": [...] }
`

  const raw = await llmGenerateFn(prompt)
  return safeParseJSON<AgentPlan>(raw)
}

// Filter knowledge entries relevant to the current intent
function selectRelevantKnowledge(intent: Intent, knowledge: KnowledgeEntry[]): KnowledgeEntry[] {
  const active = knowledge.filter(k => !k.supersededBy)

  const categoryPriority: Record<Intent, KnowledgeCategory[]> = {
    GENERATE_PROPOSAL: ['requirement', 'preference', 'constraint', 'context', 'decision', 'relationship'],
    MODIFY_PROPOSAL: ['requirement', 'preference', 'concern'],
    GENERATE_MICROSITE: ['preference', 'context', 'relationship'],
    GENERATE_TEMPLATE: ['requirement', 'context'],
    MODIFY_TEMPLATE: ['requirement'],
    UPDATE_REQUIREMENTS: ['requirement', 'context'],
    QUERY: ['requirement', 'context', 'history', 'concern', 'decision'],
    STATUS_CHECK: [],
    INGEST_GUIDANCE: [],
    GREETING: ['context'],
    GENERAL_CHAT: [],             // no knowledge needed — deterministic decline
    UNKNOWN: [],
  }

  const relevant = categoryPriority[intent] || []
  return active
    .filter(k => relevant.includes(k.category))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 15) // max 15 entries in planner context
}
```

---

## 9. Chat Pipeline Stage 6 — Plan Validator (Deterministic)

```typescript
// services/api/src/chat/plan-validator.ts

import { z } from 'zod'

const PlanSchema = z.object({
  intent: z.enum([
    'GENERATE_PROPOSAL', 'MODIFY_PROPOSAL', 'GENERATE_TEMPLATE',
    'MODIFY_TEMPLATE', 'GENERATE_MICROSITE', 'UPDATE_REQUIREMENTS',
    'QUERY', 'STATUS_CHECK', 'INGEST_GUIDANCE', 'GREETING', 'GENERAL_CHAT', 'UNKNOWN',
  ]),
  actions: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('ASK'), question: z.string().min(1).max(500) }),
    z.object({ type: z.literal('UPDATE_REQUIREMENTS'), data: z.record(z.unknown()) }),
    z.object({
      type: z.literal('CALL_TOOL'),
      tool: z.enum([
        'generate_proposal', 'generate_template', 'modify_template',
        'generate_microsite', 'edit_proposal_section', 'search_documents',
        'list_proposals', 'list_templates', 'get_proposal_status', 'set_proposal_status',
      ]),
      params: z.record(z.unknown()),
    }),
    z.object({ type: z.literal('RESPOND'), message: z.string().min(1).max(2000) }),
  ])).min(1).max(5),
})

// Tool-specific parameter schemas (same as v2 — omitted for brevity, unchanged)

function validatePlan(raw: unknown): ValidationResult {
  const planResult = PlanSchema.safeParse(raw)
  if (!planResult.success) {
    return { valid: false, errors: planResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`) }
  }

  const plan = planResult.data
  const errors: string[] = []

  // Tool param validation per tool (same as v2)
  for (const action of plan.actions) {
    if (action.type === 'CALL_TOOL') {
      const schema = TOOL_PARAM_SCHEMAS[action.tool]
      if (schema) {
        const paramResult = schema.safeParse(action.params)
        if (!paramResult.success) {
          errors.push(`Tool "${action.tool}" invalid params: ${paramResult.error.errors.map(e => e.message).join(', ')}`)
        }
      }
    }
  }

  // Business rules
  if (plan.actions.filter(a => a.type === 'CALL_TOOL').length > 3) errors.push('Max 3 tool calls per turn')
  if (plan.intent === 'GREETING' && plan.actions.some(a => a.type === 'CALL_TOOL')) errors.push('GREETING should not call tools')
  if (plan.intent === 'GENERAL_CHAT' && plan.actions.some(a => a.type === 'CALL_TOOL')) errors.push('GENERAL_CHAT should not call tools')

  return { valid: errors.length === 0, plan: errors.length === 0 ? plan as AgentPlan : undefined, errors }
}
```

---

## 10. Chat Pipeline Stages 7–9

### Stage 7: Tool Router, Stage 8: Response Builder, Stage 9: Persist State

These stages are **unchanged from v2 spec** (Sections 8, 9, 10 of v2). The tool handlers, response builder logic, and persistence mechanism remain identical. The only difference is that `NamespaceContext` is now used instead of `NamespaceRequirements`, and the planner now has access to knowledge entries.

Key references for implementers:

- Tool handlers wrap existing APIs — `generate_proposal` → `POST /generate-proposal`, `generate_microsite` → `MicrositeGeneratorAgent.run()`, etc.
- Response builder uses deterministic templates for greetings, not-ready responses, single-tool results, and requirement confirmations. LLM summarization only for multi-tool or QUERY results.

### 10.1 Boundary Response Builder (GENERAL_CHAT handler)

`GENERAL_CHAT` and `UNKNOWN` intents short-circuit the pipeline at Stage 1. They never reach planning, tools, or LLM response generation. Responses are fully deterministic.

**Design principles:**
1. **Acknowledge what they asked** — the user knows we understood them
2. **Decline specifically** — not a generic wall, but a reason tied to their question
3. **Pivot naturally** — every response ends with a bridge to what we *can* do
4. **Zero LLM tokens** — all boundary responses are pattern-matched templates
5. **Ambiguous messages get project interpretation** — handled by the LLM classifier routing them to QUERY or other project intents, NOT here

```typescript
// services/api/src/chat/boundary-response.ts

function buildBoundaryResponse(message: string): ChatResponse {
  const text = matchBoundaryPattern(message)
  return {
    text,
    actionCards: [],
    requirementsUpdated: false,
    toolsCalled: [],
  }
}

function matchBoundaryPattern(message: string): string {
  const m = message.toLowerCase()

  // --- Category: General knowledge / trivia ---
  if (/weather|temperature|rain|forecast/i.test(m)) {
    return "I'm focused on proposal and project work, so weather is outside my scope. " +
           "But if your project has weather-related constraints, I can note that in the requirements."
  }

  if (/news|politics|stock|market|sports|score/i.test(m)) {
    return "I don't cover news or current events — I'm built for creating proposals, " +
           "templates, and presentation microsites. What project are you working on?"
  }

  // --- Category: Tasks for a different tool ---
  if (/email|mail|write.*(to|for)|draft.*(message|letter|note)|slack/i.test(m)) {
    return "I can't draft emails or messages, but I can create a proposal or " +
           "presentation that you can share with your client. Want to start one?"
  }

  if (/code|programming|python|javascript|debug|function|script|api/i.test(m)) {
    return "I'm built for proposal and presentation work, not coding. " +
           "If you need technical content in a proposal though, I can help with that."
  }

  if (/powerpoint|pptx|slides|keynote|google.slides/i.test(m)) {
    return "I don't create slide decks, but I can generate a presentation microsite " +
           "from an approved proposal — it's interactive and shareable. Want to try that?"
  }

  if (/translate|translation|spanish|french|german|chinese/i.test(m)) {
    return "Translation isn't something I handle. I focus on generating proposals, " +
           "templates, and microsites for client work. How can I help with a project?"
  }

  if (/spreadsheet|excel|csv|calculate|math/i.test(m)) {
    return "I don't work with spreadsheets or calculations directly. " +
           "If you need pricing in a proposal, I can add a pricing section — " +
           "just tell me team size, duration, and rate."
  }

  // --- Category: Personal / social ---
  if (/joke|funny|entertain|bored|story|poem/i.test(m)) {
    return "I'm more of a proposals-and-presentations specialist than an entertainer. " +
           "Got a client project I can help with?"
  }

  if (/how are you|what'?s up|how'?s it going/i.test(m) && m.length < 30) {
    return "All good on my end — ready to help with proposals, templates, or microsites. " +
           "What are you working on?"
  }

  if (/thank|thanks|thx/i.test(m) && m.length < 30) {
    return "You're welcome! Let me know if you need anything else for your project."
  }

  // --- Category: Self-identification ---
  if (/who are you|what can you|help me|what do you do|capabilities/i.test(m)) {
    return "I'm ProDeck AI — I help consulting teams create client proposals, " +
           "proposal templates, and presentation microsites. I work best when you " +
           "upload project documents (RFPs, meeting notes, tech specs) and then ask me " +
           "to generate or edit proposals from that context. What are you working on?"
  }

  // --- Default: warm decline + redirect ---
  return "That's outside what I can help with — I'm focused on proposals, templates, " +
         "and presentation microsites for client work. If there's a project you're " +
         "working on, I'd be happy to help."
}

function buildUnknownResponse(): ChatResponse {
  return {
    text: "I didn't quite understand that. I can help with creating proposals, " +
          "editing proposal sections, generating templates, building microsites, " +
          "or answering questions about your project documents. What would you like to do?",
    actionCards: [],
    requirementsUpdated: false,
    toolsCalled: [],
  }
}
```

### 10.2 Message Classification: Three Buckets

| Bucket | Intent | LLM calls | Response type | Example |
|--------|--------|-----------|---------------|---------|
| **Project-related** | GENERATE_PROPOSAL, QUERY, etc. | 2–4 | Full pipeline | "Create a proposal for Acme Corp" |
| **Off-topic but coherent** | GENERAL_CHAT | 1 (classifier only) | Deterministic decline + redirect | "What's the weather today?" |
| **Unparseable** | UNKNOWN | 1 (classifier only) | Deterministic "didn't understand" | "asdfghjkl" |

The classifier prompt explicitly instructs the LLM to **favor project intents for ambiguous messages**. "Help me with pricing", "Summarize this", and "Can you analyze the competition" route to QUERY or UPDATE_REQUIREMENTS, not GENERAL_CHAT. Only clearly unrelated messages become GENERAL_CHAT.
- State persistence saves chat history, awaiting input state, and any requirement updates from Stage 3.

---

## 11. Full Pipeline — Chat Agent

```typescript
// services/api/src/chat/chat-agent.ts

async function runChatAgent(input: ChatAgentInput): Promise<ChatResponse> {
  const { message, namespace, chatSessionId, conversationHistory } = input

  // --- STAGE 1: Intent Classification ---
  input.onPhase('Classifying intent...')
  const chatContext = await buildChatContext(namespace, chatSessionId, conversationHistory)
  const classification = classifyIntent(message, chatContext)

  // Early exit: off-topic or unparseable — deterministic response, no LLM
  if (classification.intent === 'UNKNOWN') {
    const response = buildUnknownResponse()
    await persistState(chatSessionId, namespace, message, response, classification)
    input.onDone(response)
    return response
  }
  if (classification.intent === 'GENERAL_CHAT') {
    const response = buildBoundaryResponse(message)
    await persistState(chatSessionId, namespace, message, response, classification)
    input.onDone(response)
    return response
  }

  // --- STAGE 2: Requirement Extraction ---
  input.onPhase('Extracting requirements...')
  const nsContext = await contextService.get(namespace)
  const extraction = await extractFromMessage(message, nsContext, llmGenerateFn)

  // --- STAGE 3: Context Merge ---
  let currentContext = nsContext
  if (Object.keys(extraction.fields).length > 0) {
    input.onPhase('Updating context...')
    currentContext = await contextService.mergeRequirements(namespace, extraction.fields)
  }

  // --- STAGE 4: Readiness Check ---
  const readiness = checkReadiness(classification.intent, currentContext, chatContext)
  if (!readiness.ready) {
    const response = buildNotReadyResponse(classification.intent, readiness, extraction)
    await persistState(chatSessionId, namespace, message, response, classification)
    input.onDone(response)
    return response
  }

  // --- STAGE 5: Plan ---
  input.onPhase('Planning actions...')
  const rawPlan = await buildPlan(classification.intent, message, chatContext, currentContext)

  // --- STAGE 6: Validate Plan ---
  const validation = validatePlan(rawPlan)
  if (!validation.valid) {
    console.warn('Plan validation failed:', validation.errors)
    const fallback = buildFallbackPlan(classification.intent, message, chatContext)
    if (!fallback) {
      const response = buildPlanFailureResponse(extraction)
      await persistState(chatSessionId, namespace, message, response, classification)
      input.onDone(response)
      return response
    }
    validation.plan = fallback
  }

  const plan = validation.plan!

  // --- STAGE 7: Execute Tools ---
  const toolActions = plan.actions.filter((a): a is CallToolAction => a.type === 'CALL_TOOL')
  const updateActions = plan.actions.filter((a): a is UpdateRequirementsAction => a.type === 'UPDATE_REQUIREMENTS')
  const askActions = plan.actions.filter((a): a is AskAction => a.type === 'ASK')

  for (const update of updateActions) {
    await contextService.mergeRequirements(namespace, update.data)
  }

  let toolResults: ToolExecutionResult[] = []
  if (toolActions.length > 0) {
    input.onPhase('Executing...')
    toolResults = await executeToolActions(toolActions, {
      namespace, workdir: config.workdir, llmFn: llmGenerateFn,
      onPhase: input.onPhase, onToolEvent: input.onToolEvent,
    })
  }

  // --- STAGE 8: Build Response ---
  input.onPhase('Building response...')
  const response = await buildResponse(classification.intent, toolResults, readiness, extraction, chatContext)
  if (askActions.length > 0) {
    response.text += '\n\n' + askActions.map(a => a.question).join('\n')
  }

  // --- STAGE 9: Persist ---
  await persistState(chatSessionId, namespace, message, response, classification)
  for (const chunk of chunkText(response.text)) { input.onChunk(chunk) }
  input.onDone(response)
  return response
}
```

---

## 12. Cost Control

```typescript
const DEFAULT_COST_CONFIG = {
  maxLLMCallsPerTurn: 4,          // chat pipeline
  maxLLMCallsPerIngestion: 4,     // ingestion pipeline (preprocess + extract + knowledge + validation)
  maxToolCallsPerTurn: 3,
  maxTokensPerLLMCall: 2000,
  maxKnowledgeEntriesPerNamespace: 200,
  enableCostTracking: true,
}
```

---

## 13. SSE Event Protocol

| Event | Payload | Source |
|-------|---------|--------|
| `phase` | `{ phase: string }` | Chat pipeline (all stages) |
| `chunk` | `string` | Chat Stage 8 (streaming) |
| `proposal_section` | `{ section, content, artifactId }` | Chat Stage 7 |
| `done` | `{ message, actionCards }` | Chat Stage 8 |
| `error` | `{ error }` | Any stage |
| `tool_progress` | `{ tool, status, params?, durationMs?, error? }` | Chat Stage 7 |
| `context_updated` | `{ fieldsUpdated: string[], knowledgeAdded: number, source: string }` | Chat Stage 3 / Ingestion Step 7 |
| `document_processed` | `{ fileName, type, fieldsExtracted, knowledgeEntries, noiseRatio }` | Ingestion pipeline completion |
| `intent_classified` | `{ intent, confidence, source }` | Chat Stage 1 (debug mode) |

---

## 14. Files to Create / Modify

### New Files

| File | Purpose |
|------|---------|
| **Chat Pipeline** | |
| `services/api/src/chat/chat-agent.ts` | Main 9-stage pipeline |
| `services/api/src/chat/intents.ts` | Intent enum + types |
| `services/api/src/chat/intent-classifier.ts` | Hybrid rules + LLM classifier |
| `services/api/src/chat/requirement-extractor.ts` | Chat message extraction |
| `services/api/src/chat/context.types.ts` | NamespaceContext, RequirementField, KnowledgeEntry |
| `services/api/src/chat/context.service.ts` | Context CRUD + merge logic (both layers) |
| `services/api/src/chat/readiness-engine.ts` | Deterministic readiness checks |
| `services/api/src/chat/planner.ts` | LLM plan generation with knowledge context |
| `services/api/src/chat/plan-validator.ts` | Zod schema validation |
| `services/api/src/chat/tool-router.ts` | Tool execution orchestration |
| `services/api/src/chat/tool-handlers.ts` | 10 tool handler implementations |
| `services/api/src/chat/response-builder.ts` | Deterministic + LLM responses |
| `services/api/src/chat/boundary-response.ts` | GENERAL_CHAT + UNKNOWN deterministic responses |
| `services/api/src/chat/cost-control.ts` | LLM/tool budgeting |
| `services/api/src/chat/utils.ts` | safeParseJSON, slugify, chunkText, generateUUID |
| **Ingestion Pipeline** | |
| `services/api/src/ingestion/ingest-orchestrator.ts` | 8-step ingestion pipeline |
| `services/api/src/ingestion/document-type-detector.ts` | Filename + content rules |
| `services/api/src/ingestion/document-preprocessor.ts` | LLM preprocessing dispatcher |
| `services/api/src/ingestion/preprocessor-validator.ts` | Zod schema for preprocessed docs |
| `services/api/src/ingestion/requirement-extractor.ts` | Extraction from cleaned content |
| `services/api/src/ingestion/knowledge-extractor.ts` | Knowledge entry generation |
| `services/api/src/ingestion/extraction-validator.ts` | Validates fields + knowledge |
| `services/api/src/ingestion/prompts/meeting-transcript.ts` | Transcript preprocessing prompt |
| `services/api/src/ingestion/prompts/rfp.ts` | RFP preprocessing prompt |
| `services/api/src/ingestion/prompts/technical-spec.ts` | Technical spec prompt |
| `services/api/src/ingestion/prompts/email.ts` | Email prompt |
| `services/api/src/ingestion/prompts/generic.ts` | Generic document prompt |
| **Tests** | |
| `services/api/src/chat/__tests__/intent-classifier.test.ts` | |
| `services/api/src/chat/__tests__/readiness-engine.test.ts` | |
| `services/api/src/chat/__tests__/plan-validator.test.ts` | |
| `services/api/src/chat/__tests__/context-service.test.ts` | |
| `services/api/src/chat/__tests__/pipeline.integration.test.ts` | |
| `services/api/src/ingestion/__tests__/document-type-detector.test.ts` | |
| `services/api/src/ingestion/__tests__/preprocessor.test.ts` | |
| `services/api/src/ingestion/__tests__/ingestion-pipeline.integration.test.ts` | |

### Modified Files

| File | Change |
|------|--------|
| `services/api/src/chat-routes.ts` | Wire `runChatAgent` to `POST /chat/message` |
| `services/api/src/chat/context-builder.ts` | Build ChatContext from NamespaceContext |
| Ingest route handler | Replace direct FAISS indexing with `processDocument()` orchestrator |

### Unchanged (DO NOT TOUCH)

| File/Dir | Reason |
|----------|--------|
| `plugins/processor-proposal-generator/` | Called via tool handler |
| `agents/microsite-generator-agent/` | Called via tool handler |
| `agents/proposal-section-agent/` | Called via tool handler |
| `services/ui/src/components/ProposalPage.tsx` | Proposal editor UI |
| `services/ui/src/components/MicrositePreview/` | Microsite preview UI |
| `services/api/src/proposal-routes.ts` | Proposal CRUD API |
| `packages/core/` | Core library |

---

## 15. Conversation Flow Traces

### 15.1 Proposal from Meeting Transcript (the LC Grounds scenario)

```
[User uploads LC_Grounds1.txt and LC_Grounds2.txt]

Ingestion pipeline runs for each:
  LC_Grounds1.txt:
    Type: meeting_transcript (filler ratio 6.2%, otter.ai marker)
    Preprocessed: 8,156 words → 5 sections, 850 cleaned words (89.6% noise)
    Fields: clientName, industry, budget, stakeholders, keyObjectives
    Knowledge: 14 entries (concerns, preferences, context, action items)
  
  LC_Grounds2.txt:
    Type: meeting_transcript (filler ratio 5.8%, otter.ai marker)
    Preprocessed: 6,200 words → 4 sections, 620 cleaned words (90% noise)
    Fields: (merged into existing — no conflicts)
    Knowledge: 11 entries (additional concerns, context)

context.json now has:
  requirements.fields: clientName, industry, budget, stakeholders, keyObjectives
  knowledge: 25 active entries

---

User: "Create a proposal for LC Grounds"

Stage 1 → Intent: GENERATE_PROPOSAL (rule: kw_proposal_create)
Stage 2 → Extracted: { clientName: "LC Grounds" } (already known)
Stage 3 → No merge needed (value already matches)
Stage 4 → Readiness: READY (clientName ✓, industry ✓)
Stage 5 → Plan: CALL_TOOL generate_proposal
  (planner sees 25 knowledge entries including budget, concerns, preferences)
  params: { client: "LC Grounds", industry: "Landscaping / Outdoor Services" }
Stage 6 → Validation: PASS
Stage 7 → Tool executed successfully
Stage 8 → "Proposal generated: lc-grounds_proposal_v1.md" + [View Proposal →]
```

### 15.2 Proposal from No Documents

```
User: "I need a proposal for a software project"

Stage 1 → GENERATE_PROPOSAL (rule)
Stage 2 → Extracted: { projectType: "software project" }
Stage 3 → Merged: projectType set
Stage 4 → NOT READY (missing: clientName, industry)
Stage 8 → "I need a few details:
  1. What is the client or company name?
  2. What industry is the client in?"
  awaitingInput: GENERATE_PROPOSAL

---

User: "TechStart Inc, fintech"

Stage 1 → GENERATE_PROPOSAL (ctx_awaiting_proposal_input)
Stage 2 → Extracted: { clientName: "TechStart Inc", industry: "fintech" }
Stage 3 → Merged
Stage 4 → READY
Stage 5–7 → generate_proposal called
Stage 8 → "Proposal generated: techstart-inc_proposal_v1.md" + [View Proposal →]
```

### 15.3 Microsite (blocked then unblocked)

```
User: "Generate a microsite"

Stage 1 → GENERATE_MICROSITE
Stage 4 → NOT READY — blocker: "No approved proposals. 1 in draft. Approve first."
Stage 8 → Blocker message

---

User: "Approve the proposal"

Stage 1 → STATUS_CHECK (rule: kw_status — but context refines)
Stage 5 → Plan: CALL_TOOL set_proposal_status
Stage 7 → Status changed to approved
Stage 8 → "lc-grounds_proposal_v1.md status changed to approved."

---

User: "Now generate the microsite with a dark theme"

Stage 1 → GENERATE_MICROSITE
Stage 4 → READY (1 approved proposal)
Stage 5 → Plan: CALL_TOOL generate_microsite
  params: { proposalFileName: "lc-grounds_proposal_v1.md", theme: "Obsidian Luxury" }
Stage 7 → Microsite generated
Stage 8 → "Microsite generated." + [View Microsite →]
```

### 15.4–15.6 (Requirement Update, Section Edit, Knowledge Query)

Same as v2 — unchanged.

### 15.7 Off-Topic Message (GENERAL_CHAT)

```
User: "What's the weather like today?"

Stage 1 → Intent: GENERAL_CHAT (LLM fallback, confidence: 0.92)
  No keyword rule matched → LLM classified as GENERAL_CHAT
Stage 1 → Early exit (GENERAL_CHAT short-circuits pipeline)
Response (deterministic, 0 LLM calls for response):
  "I'm focused on proposal and project work, so weather is outside my scope.
   But if your project has weather-related constraints, I can note that
   in the requirements."
Stage 9 → Persisted

Total LLM calls: 1 (classifier only)
Total tool calls: 0
```

### 15.8 Adjacent But Unsupported Request

```
User: "Can you write an email to the client about the proposal?"

Stage 1 → Intent: GENERAL_CHAT (LLM fallback, confidence: 0.80)
  No keyword rule matched → LLM sees "email" as primary action, not project-related
Stage 1 → Early exit
Response (deterministic):
  "I can't draft emails or messages, but I can create a proposal or
   presentation that you can share with your client. Want to start one?"

Total LLM calls: 1
```

### 15.9 Ambiguous Message (Routed to Project Intent, NOT GENERAL_CHAT)

```
User: "Can you help me with the pricing?"

Stage 1 → Intent: QUERY (rule: kw_query — "help" triggers it)
  OR: LLM fallback → QUERY (confidence: 0.78) — ambiguous but project-favored
Stage 2 → Extracted: {} (no concrete facts)
Stage 4 → READY
Stage 5 → Plan: search_documents or RESPOND using known pricing context
Stage 8 → Response uses knowledge entries about budget

Total LLM calls: 2–3 (full pipeline)
Note: Classifier favored project interpretation over GENERAL_CHAT
```

### 15.10 Gibberish (UNKNOWN)

```
User: "asdfghjkl zxcvbnm"

Stage 1 → Intent: UNKNOWN (LLM fallback, confidence: 0.15 → below 0.6 threshold)
Stage 1 → Early exit
Response (deterministic):
  "I didn't quite understand that. I can help with creating proposals,
   editing proposal sections, generating templates, building microsites,
   or answering questions about your project documents. What would you like to do?"

Total LLM calls: 1
```

---

## 16. Testing Strategy

### 16.1 Unit Tests

| Component | Test Cases |
|-----------|------------|
| `document-type-detector` | Otter.ai transcript → meeting_transcript. Email headers → email. RFP keywords → rfp. High filler ratio → meeting. Generic fallback. |
| `preprocessor-validator` | Valid preprocessed doc passes. Missing sections → fail. Oversized entries → fail. |
| `knowledge-extractor` | Meeting transcript produces preference + concern entries. RFP produces requirement entries. Invalid categories rejected. Max 25 cap enforced. |
| `context-service` | Merge: user overwrites document. Array union. Knowledge dedup (70% Jaccard). Eviction at 200 cap. Version increments. |
| `intent-classifier` | All keyword rules. Contextual overrides. LLM fallback. Off-topic → GENERAL_CHAT. Gibberish → UNKNOWN. Ambiguous project-adjacent → QUERY (not GENERAL_CHAT). |
| `readiness-engine` | Missing clientName → not ready. Microsite with no approved → blocker. GENERAL_CHAT → always ready. |
| `plan-validator` | Valid plan passes. Unknown tool → reject. Bad params → reject. GENERAL_CHAT + tool calls → reject. |
| `response-builder` | Greeting → deterministic. Not-ready → questions. Single tool → template. |
| `boundary-response` | Weather → decline + pivot. Email request → decline + propose proposal. Self-identification → capability description. Gibberish → "didn't understand". Thanks → acknowledgment. |

### 16.2 Integration Tests

| Flow | Assertions |
|------|------------|
| Transcript ingestion | Raw Otter transcript → type detected → preprocessed (>80% noise removed) → fields extracted → knowledge entries created → context.json updated |
| RFP ingestion | RFP → type detected → minimal preprocessing → high-confidence extraction → context updated |
| Full proposal from transcript | Ingest meeting notes → chat "create proposal" → readiness passes → proposal generated with knowledge context |
| No-docs proposal | Empty namespace → readiness blocks → ask → answer → generate |
| Knowledge query | Ingest transcript → "what are their concerns?" → search + knowledge entries → summarized response |
| Off-topic decline | "What's the weather?" → GENERAL_CHAT → deterministic decline → no tools called, 1 LLM call |
| Ambiguous favors project | "Help me with pricing" → QUERY (not GENERAL_CHAT) → full pipeline |
| Adjacent unsupported | "Write an email to the client" → GENERAL_CHAT → specific decline + proposal pivot |
| Gibberish | "asdfghjkl" → UNKNOWN → "didn't understand" → no tools called |

### 16.3 Regression Suite

```json
[
  { "input": "Create a proposal for Acme Corp", "expectedIntent": "GENERATE_PROPOSAL", "expectedSource": "rule" },
  { "input": "Make the exec summary shorter", "expectedIntent": "MODIFY_PROPOSAL", "expectedSource": "rule" },
  { "input": "Convert to a presentation", "expectedIntent": "GENERATE_MICROSITE", "expectedSource": "rule" },
  { "input": "What are the key requirements?", "expectedIntent": "QUERY", "expectedSource": "rule" },
  { "input": "The budget changed to $200k", "expectedIntent": "UPDATE_REQUIREMENTS", "expectedSource": "rule" },
  { "input": "Create a template for fintech", "expectedIntent": "GENERATE_TEMPLATE", "expectedSource": "rule" },
  { "input": "Show me version history", "expectedIntent": "STATUS_CHECK", "expectedSource": "rule" },
  { "input": "Hello", "expectedIntent": "GREETING", "expectedSource": "rule" },
  { "input": "How do I upload docs?", "expectedIntent": "INGEST_GUIDANCE", "expectedSource": "rule" },
  { "input": "Can you analyze our competitive landscape?", "expectedIntent": "QUERY", "expectedSource": "llm" },
  { "input": "Help me with the pricing section", "expectedIntent": "QUERY", "expectedSource": "rule", "note": "ambiguous but project-favored" },
  { "input": "What's the weather today?", "expectedIntent": "GENERAL_CHAT", "expectedSource": "llm" },
  { "input": "Write me a Python script", "expectedIntent": "GENERAL_CHAT", "expectedSource": "llm" },
  { "input": "Can you draft an email to my boss?", "expectedIntent": "GENERAL_CHAT", "expectedSource": "llm" },
  { "input": "Tell me a joke", "expectedIntent": "GENERAL_CHAT", "expectedSource": "llm" },
  { "input": "Who won the Super Bowl?", "expectedIntent": "GENERAL_CHAT", "expectedSource": "llm" },
  { "input": "What can you do?", "expectedIntent": "GENERAL_CHAT", "expectedSource": "llm" },
  { "input": "Thanks!", "expectedIntent": "GENERAL_CHAT", "expectedSource": "llm" },
  { "input": "asdfghjkl", "expectedIntent": "UNKNOWN", "expectedSource": "llm" }
]
```

---

## 17. Migration Plan

### Phase 1: Context Model + Ingestion (Week 1)
- [ ] `context.types.ts` — NamespaceContext, KnowledgeEntry, RequirementField
- [ ] `context.service.ts` — CRUD + merge (both layers)
- [ ] `document-type-detector.ts` — filename + content rules
- [ ] `document-preprocessor.ts` — LLM dispatcher + all 5 prompts
- [ ] `preprocessor-validator.ts` — Zod schemas
- [ ] Unit tests for all

### Phase 2: Extraction + Knowledge (Week 2)
- [ ] `requirement-extractor.ts` (ingestion version — from cleaned content)
- [ ] `knowledge-extractor.ts` — knowledge entry generation
- [ ] `extraction-validator.ts` — field + knowledge validation
- [ ] `ingest-orchestrator.ts` — full 8-step pipeline
- [ ] Integration test: ingest LC Grounds transcript end-to-end
- [ ] Wire to existing ingest route (behind flag: `INGEST_V2=true`)

### Phase 3: Chat Pipeline (Week 3)
- [ ] `intents.ts` + `intent-classifier.ts` (include GENERAL_CHAT intent)
- [ ] `boundary-response.ts` (deterministic decline patterns)
- [ ] `requirement-extractor.ts` (chat version — from messages)
- [ ] `readiness-engine.ts`
- [ ] `planner.ts` (with knowledge context)
- [ ] `plan-validator.ts` (GENERAL_CHAT + tool calls → reject)
- [ ] `tool-handlers.ts` + `tool-router.ts`
- [ ] `response-builder.ts`
- [ ] `chat-agent.ts` (wire all 9 stages, GENERAL_CHAT/UNKNOWN early exit)
- [ ] Wire to `chat-routes.ts` behind flag: `CHAT_V2=true`

### Phase 4: Hardening (Week 4)
- [ ] Integration tests: all flows from Section 15
- [ ] Regression test suite
- [ ] Error handling: LLM timeout, tool failure, malformed plan, ingestion failure
- [ ] SSE event compatibility with existing UI
- [ ] Performance measurement per stage
- [ ] Remove feature flags, deprecate old orchestrator

---

## 18. LLM Call Budget

### Per Chat Message

| Stage | LLM Calls | Skippable? |
|-------|-----------|------------|
| 1. Intent Classifier | 0 or 1 | Yes — 0 if rule matches |
| 2. Requirement Extractor | 0 or 1 | Yes — 0 for greetings, short msgs |
| 5. Planner | 1 | No (when readiness passes) |
| 8. Response Builder | 0 or 1 | Yes — 0 for deterministic responses |

**Best case (greeting):** 0 LLM calls  
**Off-topic (GENERAL_CHAT):** 1 LLM call (classifier only, deterministic response)  
**Typical (proposal generation):** 2–3 calls  
**Worst (complex query + multi-tool):** 4 calls  

### Per Document Ingestion

| Step | LLM Calls | Skippable? |
|------|-----------|------------|
| 2. Preprocessor | 1 | No |
| 4. Requirement Extraction | 1 | Skippable if preprocessor found nothing |
| 5. Knowledge Extraction | 1 | Skippable if preprocessor found nothing |

**Per document:** 2–3 LLM calls  
**For the LC Grounds scenario (2 transcripts):** 4–6 LLM calls total

---

## 19. Open Questions

1. **Conversation history window**: How many messages in planner context? Recommend 20.
2. **Knowledge conflict resolution**: When two documents contradict (different budgets), flag as concern or last-write-wins? Current: higher confidence wins.
3. **Multi-proposal disambiguation**: Multiple proposals exist, user says "edit the proposal" — ASK or default to latest?
4. **Template auto-selection**: Should readiness engine pick template by industry, or always use default?
5. **Knowledge entry TTL**: Should knowledge entries expire after N days? Or only be superseded by newer entries?
6. **Preprocessing cost**: Meeting transcripts need 1 extra LLM call vs RFPs. Is the noise removal worth it for all document types, or only transcripts?
7. **Participant extraction accuracy**: Speaker identification from raw transcripts is unreliable without speaker diarization. Should we treat participant data as low-confidence (0.4)?
