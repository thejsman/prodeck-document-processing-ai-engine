# Chat Workflow System

Reference documentation for the stateful chat workflow engine in `services/api`.

---

## Overview

The chat system executes multi-turn AI workflows through a state machine driven by user messages. Each message is routed to the appropriate workflow, the relevant state handler is executed, and the result is streamed back to the client via SSE.

```
User message
  ↓
POST /chat/message  (chat-routes.ts)
  ↓
ChatOrchestrator.processMessage()
  ↓
routeIntent()  →  load or create WorkflowInstance
  ↓
Execution loop  →  STATE_HANDLERS[currentState](ctx)
  ↓
HandlerResult  →  transition to next state
  ↓
SSE stream to client
```

---

## Registered Workflows

| Workflow ID | Triggered by | Entry state |
|-------------|-------------|-------------|
| `proposal_generation` | "create a proposal", "generate proposal" | `collecting_rfp` |
| `rfp_analysis` | "analyze rfp", "should we bid" | `checking_rfp` |
| `proposal_version_control` | "rollback", "show history", "update section" | `resolve_action` |
| `template_creation` | "create template", "build a template" | `analyzing_rfp` |

Intent detection is rule-based (no ML). Patterns live in `services/api/src/chat/intent-router.ts`.

---

## Proposal Generation Workflow

### State machine

```
collecting_rfp
  → READY → collecting_inputs
              → READY → recommend_template
                          → READY → generating_outline
                                      → READY → generating_sections
                                                  → DONE → completed
```

### States

| State | Kind | Handler | Purpose |
|-------|------|---------|---------|
| `collecting_rfp` | input | `handleCollectingRfp` | Wait for RFP document upload or context |
| `collecting_inputs` | input | `handleCollectingInputs` | Gather industry / timeline / budget (auto-fills from vector store with confidence scoring) |
| `recommend_template` | agent | `handleRecommendTemplate` | Match ingested documents to a proposal template |
| `generating_outline` | agent | `handleGeneratingOutline` | Draft section-level outline using LLM + tools |
| `generating_sections` | agent | `handleGeneratingSections` | Generate each section individually, emit as structured blocks |

### Confidence-aware auto-fill (collecting_inputs)

Requirements are extracted from the namespace vector store with confidence scores:

| Score | Action |
|-------|--------|
| ≥ 0.85 | Auto-filled silently |
| 0.60–0.84 | Presented to user for confirmation with supporting evidence quote |
| < 0.60 | Discarded — user is asked manually |

### Cross-section coherence (generating_sections)

`ProposalState` accumulates key points, timeline, pricing, and tone as sections complete. Each subsequent section prompt includes a coherence block to prevent contradictions.

```typescript
interface ProposalState {
  keyPoints: string[];
  timeline: string | null;
  pricing:  string | null;
  tone:     string | null;
}
```

---

## Proposal Section Blocks

### How sections are emitted

`handleGeneratingSections` emits each section via `ctx.onSection` when available, falling back to `ctx.onChunk` for non-section-aware callers (e.g. `resumeWorkflow`).

```typescript
// onSection path (streaming chat):
onSection(sectionName, content, artifactId)
  → SSE: event: proposal_section
         data: { section, content, artifactId }

// onChunk fallback (resume / non-streaming):
onChunk(`## ${section}\n\n${content}\n\n`)
  → SSE: data: "## Section\n\n..."
```

### Frontend rendering

`useSSE` accumulates `proposal_section` events into `sections: ProposalSection[]`. The chat page renders each as a `ProposalSectionBlock` component.

```
Streaming:          sections.length > 0  →  render ProposalSectionBlock list
                    + skeleton block while isStreaming
Plain text:         chunks && sections.length === 0  →  typewriter render
History (sections): message.sections  →  ProposalSectionBlock list
History (plain):    message.content   →  ReactMarkdown
```

### ProposalSectionBlock actions

Each block renders a toolbar with:

| Button | Behaviour |
|--------|-----------|
| Edit | Opens textarea; ⌘↵ saves, Esc cancels |
| Improve | Instruction: "Improve clarity, impact, and persuasiveness" |
| Regenerate | Instruction: "Rewrite using proposal context and objectives" |
| Tone ▾ | Dropdown: More formal / More persuasive / Shorten |

After every action:
1. `POST /chat/proposal/section/edit` is called
2. Section content is replaced in the block
3. Version badge (e.g. `v1.2`) appears in the header
4. Block flashes and scrolls into view

---

## API Endpoints

### `POST /chat/message`

Accepts a user message and streams the workflow response.

**Request:**
```json
{
  "message": "Generate a proposal for an e-commerce platform",
  "namespace": "acme-corp",
  "chatSessionId": "uuid",
  "stream": true
}
```

**SSE stream:**
```
event: phase
data: {"phase":"Analyzing documents"}

event: proposal_section
data: {"section":"Executive Summary","content":"...","artifactId":"chat-draft-1234.md"}

event: proposal_section
data: {"section":"Problem Statement","content":"...","artifactId":"chat-draft-1234.md"}

event: done
data: {"message":"Proposal draft ready.","actions":{"openProposalUrl":"/proposals/acme-corp/chat-draft-1234.md"}}
```

---

### `POST /chat/proposal/section/edit`

Edit a single section of a proposal artifact in-place.

**Request:**
```json
{
  "namespace": "acme-corp",
  "artifactId": "chat-draft-1714000000000.md",
  "section": "Executive Summary",
  "instruction": "Make this more concise and ROI-focused"
}
```

Or with direct content replacement:
```json
{
  "namespace": "acme-corp",
  "artifactId": "chat-draft-1714000000000.md",
  "section": "Executive Summary",
  "newContent": "We deliver measurable outcomes..."
}
```

**Response:**
```json
{
  "content": "We deliver measurable outcomes...",
  "versionLabel": "v1.2"
}
```

**Rules:**
- Provide `instruction` OR `newContent` — not both, not neither
- Always creates a new version snapshot via `createVersionFromEdit`
- Never regenerates the full proposal — section-only operation

---

### `GET /chat/session/:chatSessionId/stream`

Long-lived SSE channel for server-initiated events (e.g. ingestion complete triggering workflow resume).

**Events:** same format as `POST /chat/message` stream.

---

### `GET /chat/session/:chatSessionId/history`

Returns persisted message history for the session.

**Query params:** `namespace` (required)

---

## HandlerContext Reference

```typescript
interface HandlerContext {
  workdir: string;
  namespace: string;
  /** Live instance — handlers may mutate instance.context directly. */
  instance: WorkflowInstance;
  incomingMessage: string;
  /** Emit a progress phase label to the client. */
  onPhase: (phase: string) => void;
  /** Emit a raw token chunk (used by non-section handlers). */
  onChunk: (chunk: string) => void;
  /**
   * Emit a fully-generated proposal section as a structured block.
   * Optional — handlers must fall back to onChunk when absent.
   */
  onSection?: (section: string, content: string, artifactId: string) => void;
  /** Emit a tool execution trace event. Optional. */
  onToolEvent?: (event: ToolTraceEvent) => void;
  /** Full LLM context built by context-builder for this turn. */
  conversationContext?: LLMContext;
}
```

---

## HandlerResult Reference

```typescript
interface HandlerResult {
  /** Human-readable message returned to the user. */
  message: string;
  /** Drives the next state transition (e.g. "READY", "DONE", "SKIP"). */
  stateSignal?: string;
  /** Action links included in the completion payload. */
  actions?: Record<string, string>;
}
```

If `stateSignal` is absent, the workflow pauses and waits for the next user message.

---

## Adding a New Workflow

### 1. Define the workflow

```typescript
// services/api/src/workflows/my-workflow.workflow.ts
export const MyWorkflow: WorkflowDefinition = {
  id: 'my_workflow',
  initialState: 'first_state',
  states: {
    first_state: {
      kind: 'input',
      transitions: { READY: 'processing_state' },
    },
    processing_state: {
      kind: 'agent',
      transitions: { DONE: 'completed' },
    },
    completed: { kind: 'terminal', transitions: {} },
  },
};
```

### 2. Write handlers

```typescript
// services/api/src/workflows/my-workflow.handlers.ts
export async function handleFirstState(ctx: HandlerContext): Promise<HandlerResult> {
  const { incomingMessage, onPhase, onChunk } = ctx;
  onPhase('Processing your request');
  // ... logic
  onChunk('Here is my response.');
  return { message: 'Here is my response.', stateSignal: 'READY' };
}
```

### 3. Register

```typescript
// In chat-orchestrator.ts:
import { MyWorkflow } from '../workflows/my-workflow.workflow.js';
import { handleFirstState } from '../workflows/my-workflow.handlers.js';

const WORKFLOW_REGISTRY = {
  // ...existing
  [MyWorkflow.id]: MyWorkflow,
};

const STATE_HANDLERS = {
  // ...existing
  first_state:      handleFirstState,
  processing_state: handleProcessingState,
};
```

### 4. Add intent trigger

```typescript
// In intent-router.ts:
const MY_TRIGGERS = ['do the thing', 'run my workflow'];

// In routeIntent():
for (const trigger of MY_TRIGGERS) {
  if (lower.includes(trigger)) return { workflowId: 'my_workflow' };
}
```

---

## Version Control

All proposal mutations (inline section edits, rollbacks) create version snapshots.

```
workdir/namespaces/<namespace>/proposals/<artifactId>.versions.json
```

Each version entry:
```typescript
interface ProposalVersion {
  id: string;
  artifactId: string;
  versionLabel: string;   // "v1.0", "v1.1", ...
  createdAt: string;
  createdBy: string;      // "system" | "agent" | "user"
  summary?: string;
  snapshotPath: string;   // path to the frozen markdown snapshot
}
```

Key functions (in `proposals/proposal-version.service.ts`):
- `createInitialVersion` — called after `handleGeneratingSections`
- `createVersionFromEdit` — called after every section edit
- `listVersions` — returns history sorted oldest→newest
- `rollbackToVersion` — copies a snapshot back as the live file and creates a new version entry
