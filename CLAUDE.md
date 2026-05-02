# CLAUDE.md
## AI Engine – Engineering & Architecture Standard

**Status:** Authoritative
**Scope:** Non-negotiable architectural and coding rules for this repository.
**Audience:** Humans and AI coding agents contributing to this project.

If something here conflicts with convenience, speed, or preference, this file wins.

---

## ⚠️ Active Development: Chat V2

**Chat V2 is currently being rewritten.** Before touching anything in `services/api/src/chat/` or `services/api/src/ingestion/`, read this section in full.

### Authoritative Spec
`docs/chat-redevelopment-spec-v3.md` governs all Chat V2 decisions.
- Read the relevant section of this spec **before writing any code**
- If the spec and a prompt disagree, **the spec wins**
- If you are unsure about a design decision, **check the spec**

Architecture: **Deterministic Orchestration Engine with LLM-Assisted Reasoning**

### Frozen Paths — DO NOT MODIFY
These are stable and must not be changed during V2 development:

```
plugins/processor-proposal-generator/
agents/microsite-generator-agent/
agents/proposal-section-agent/
services/ui/src/components/ProposalPage.tsx
services/api/src/proposal-routes.ts
packages/core/
```

### Active Paths (V2 Work Only)
```
services/api/src/chat/       ← new chat pipeline
services/api/src/ingestion/  ← new ingestion pipeline
{workdir}/namespaces/{namespace}/context.json  ← namespace truth source
```

### Golden Rules (Spec Section 0)
1. Chat NEVER generates final artifacts — all generation goes through tools
2. LLM output is ALWAYS validated before execution (Zod schemas)
3. Deterministic layers override LLM decisions
4. `context.json` (Namespace Context) = single source of truth
5. No execution without readiness check passing
6. Raw documents are never extracted directly — preprocessing first
7. No general-purpose answers — off-topic gets deterministic decline
8. All generation flows go through **existing** tool APIs (do not recreate)

### Two Pipelines (Spec Section 1)

**Chat Pipeline** — 9 stages:
```
Intent → Extract → Merge → Readiness → Plan → Validate → Execute → Respond → Persist
```

**Ingestion Pipeline** — 8 steps:
```
Detect Type → Preprocess → Validate → Extract → Knowledge → Validate → Merge → Index
```

> The old `ChatOrchestrator` / `WorkflowInstance` / state-machine system described in `docs/chat-workflows.md` is the **V1 system being replaced**. Do not extend it. Do not use it as a reference for new Chat V2 code.

---

## 1. Project Vision

This repository builds a **CLI-first, open-source AI document processing engine**.

The system must:
- Run locally on a developer machine
- Be extensible via plugins
- Support arbitrary document types
- Execute configurable pipelines
- Avoid coupling to any cloud, SaaS, or vendor

Meeting transcripts are **one use case**, not the product.

---

## 2. Core Design Principles

### 2.1 CLI is the Product

- The CLI is the primary interface
- APIs, UIs, and SaaS integrations are adapters
- Every feature must be usable via CLI first

If a feature cannot be exposed via CLI, it does not belong here.

---

### 2.2 Core Must Be Pure

The following are **forbidden** in `packages/core`:

- File system access
- Network calls
- Environment variables
- Cloud SDKs
- Global state
- Time-based logic without injection

Core logic must be deterministic, testable, and side-effect free.

---

### 2.3 Explicit Over Implicit

No magic behavior.

- Pipelines are declarative
- Plugins declare capabilities
- Errors fail loudly and early
- Configuration beats convention

---

## 3. Repository Structure Contract

The repository is a **pnpm monorepo**.

```
packages/
  core/                 ← pure logic (agents, tools, pipelines, config, memory)
  cli/                  ← CLI adapter (argument parsing, command routing)
  runtime/              ← side effects (filesystem, plugin loading, config loading)
  types/                ← contracts only (interfaces, no logic)
  plugin-sdk/           ← public plugin API
  planner/              ← multi-step tool execution planner
  layout-engine/        ← deterministic content → MDX layout conversion
  pipelines/            ← pipeline definitions
  providers/
    anthropic/          ← Anthropic provider adapter
    openai/             ← OpenAI provider adapter
    local/              ← Local/Ollama provider adapter
  tools/
    extract-section/    ← extract named sections from markdown
    search-documents/   ← FAISS RAG document search
    generate-mermaid/   ← LLM-based Mermaid diagram generation
    save-asset/         ← file persistence via injected write function

agents/
  proposal-section-agent/       ← regenerate individual proposal sections
  microsite-generator-agent/    ← convert proposals to presentation microsites

plugins/                ← reference plugins (extractors, processors, presenters)
services/
  api/                  ← Fastify REST API adapter
  ui/                   ← Next.js UI adapter
```

Violating package boundaries is not allowed.

---

## 4. Package Responsibility Rules

### `packages/types`
- Interfaces and types only
- No logic
- No imports from other packages
- Versioning here is treated as public API

---

### `packages/core`
- Pipeline execution
- Validation
- Registry logic (AgentRegistry, ToolRegistry)
- Domain errors
- Agent, Tool, and Planner interfaces

Must not depend on: CLI, Runtime, Providers, or Plugins directly.

---

### `packages/runtime`
- File system access
- Plugin loading
- Configuration loading
- Execution context
- Logging

This is the boundary between pure logic and the real world.

---

### `packages/plugin-sdk`
- Base classes and interfaces for plugins
- Plugin manifest specification
- Version compatibility checks

This package is **public-facing**. Breaking changes require a major version bump.

---

### `packages/providers`
- AI model adapters only
- No business logic
- Must implement provider interfaces
- Must be swappable at runtime

Providers are optional dependencies.

---

### `packages/cli`
- Argument parsing
- Command routing
- Output formatting
- User-facing errors

The CLI must never contain business logic.

---

### `packages/planner`
- Multi-step tool execution planning
- Plan generation via injected LLM function (`GenerateFn`)
- Sequential plan execution against ToolRegistry
- No direct LLM access — caller injects the generate function

Must remain independent of agents, layout engine, and providers.

---

### `packages/layout-engine`
- Deterministic conversion of content sections to presentation layouts
- Rule-based section → component mapping (layout-rules)
- Layout planning (layout-planner)
- MDX composition from layout plans (mdx-composer)

Must remain pure: no I/O, no network, no side effects.

---

### `packages/tools/*`
- Each tool is a separate workspace package
- Tools implement the `Tool` interface from core
- Side effects (filesystem, network) via injected functions only
- Pure tools (e.g. extract-section) have no dependencies beyond core

---

### `agents/*`
- Each agent is a separate workspace package
- Agents implement the `Agent` interface from core
- Agents receive tools, planner, config, and memory via `AgentInput`
- Agents must NOT access filesystem or services directly — use tools

---

## 5. Agent System Rules

Agents are task workers that sit above the pipeline/provider infrastructure.

### Agent Interface

```typescript
interface Agent {
  readonly name: string;
  readonly description: string;
  run(input: AgentInput): Promise<AgentOutput>;
}

interface AgentInput {
  namespace: string;
  prompt?: string;
  documents?: string[];
  config?: Record<string, unknown>;
  memory?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tools?: ToolRegistry;
  planner?: Planner;
}

interface AgentOutput {
  markdown?: string;
  json?: unknown;
  assets?: string[];
}
```

### Agent Rules

- Agents are registered in `AgentRegistry` (module-level singleton)
- `AgentRunner` orchestrates: resolve config/memory, enrich input, execute, record usage
- Agents access tools via `input.tools.get("tool-name")`
- Agents access the planner via `input.planner` (optional)
- Agents must work without a planner (provide a manual fallback)

### Creating a New Agent

1. Create `agents/<agent-name>/` with `package.json`, `tsconfig.json`, `src/index.ts`
2. Implement the `Agent` interface from `@ai-engine/core`
3. Register in CLI (`packages/cli/src/commands/agent-run.ts`) and API (`services/api/src/agent-routes.ts`)
4. Add workspace dependency in CLI and API `package.json`
5. Add tsconfig project reference in CLI and API `tsconfig.json`

---

## 6. Tool System Rules

Tools are deterministic, single-purpose operations that agents call.

### Tool Interface

```typescript
interface Tool {
  readonly name: string;
  readonly description: string;
  run(input: ToolInput): Promise<ToolOutput>;
}

interface ToolInput {
  namespace?: string;
  query?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

interface ToolOutput {
  text?: string;
  json?: unknown;
  files?: string[];
}
```

### Tool Rules

- Tools are registered in `ToolRegistry` (module-level singleton)
- `ToolRegistry.get()` throws on missing tool (fail-fast)
- Side effects (filesystem, network, LLM) must be injected via constructor
- Pure tools (no side effects) need no injected dependencies
- Agents must NEVER access filesystem or services directly — use tools

### Creating a New Tool

1. Create `packages/tools/<tool-name>/` with `package.json`, `tsconfig.json`, `src/index.ts`
2. Implement the `Tool` interface from `@ai-engine/core`
3. Inject any side-effect functions via constructor (e.g. `writeFn`, `queryFn`, `generateFn`)
4. Register in CLI and API alongside existing tools
5. Add `packages/tools/*` already covers workspace discovery

### Available Tools

| Tool | Package | Side Effects | Purpose |
|------|---------|-------------|---------|
| `extract-section` | `@ai-engine/tool-extract-section` | None (pure) | Extract named sections from markdown |
| `search-documents` | `@ai-engine/tool-search-documents` | `queryFn` injected | FAISS RAG document search |
| `generate-mermaid` | `@ai-engine/tool-generate-mermaid` | `generateFn` injected | LLM-based Mermaid diagram generation |
| `save-asset` | `@ai-engine/tool-save-asset` | `writeFn` injected | Save files to disk |

---

## 7. Planner System Rules

The planner enables agents to create multi-step tool execution plans.

### Planner Flow

```
Agent decides task
  ↓
Planner.generatePlan(task, availableTools)
  ↓
Plan = ordered list of tool steps
  ↓
Planner.executePlan(plan, toolRegistry)
  ↓
Sequential tool execution
  ↓
StepResults returned to agent
```

### Planner Rules

- `generatePlan()` requires an injected `GenerateFn` — no direct LLM access
- `executePlan()` runs steps sequentially against ToolRegistry
- Plan validation: every step must reference a tool in `availableTools`
- Agents must provide a manual fallback when planner is not available
- The planner does NOT modify ToolRegistry, AgentRunner, or providers

### Planner Interface (defined in core)

```typescript
interface Planner {
  generatePlan(input: PlannerInput): Promise<Plan>;
  executePlan(plan: Plan, toolRegistry: ToolRegistry): Promise<PlanExecutionResult>;
}
```

### Wiring the Planner

The CLI/API layer creates a concrete planner (with a real `GenerateFn`) and attaches it to `AgentInput.planner`. The `AgentRunner` forwards it untouched.

---

## 8. Layout Engine Rules

The layout engine converts content sections into structured MDX presentations.

### Layout Engine Flow

```
InputSections (name, content, diagram?)
  ↓
planLayout(sections, designConfig?)
  ↓
LayoutPlan (component assignments + props)
  ↓
composeMDX(plan)
  ↓
MDX string with imports and components
```

### Layout Rules

- Rule resolution: explicit name match → content heuristic → default
- Components: `Hero`, `TwoColumn`, `ArchitectureDiagram`, `FeatureGrid`, `Timeline`, `Section`
- Content heuristics: list-heavy → `FeatureGrid`, long paragraphs → `TwoColumn`
- Optional `DesignConfig`: theme, layout, primaryColor

### Layout Engine Rules

- Must remain pure and deterministic — no I/O, no network
- Agents must NOT generate MDX directly — call the layout engine
- The layout engine does NOT save files — agents use `save-asset` tool for that

---

## 9. Dependency Injection Pattern

All side effects are injected via constructor arguments or function parameters.

| Component | Injected Dependency | Purpose |
|-----------|-------------------|---------|
| `ConfigLoader` | `ReadFileFn` | Read config files |
| `UsageRecorder` | `appendLine` function | Append usage events |
| `SearchDocumentsTool` | `queryFn` | FAISS RAG queries |
| `GenerateMermaidTool` | `generateFn` | LLM diagram generation |
| `SaveAssetTool` | `writeFn` | File persistence |
| `generatePlan()` | `GenerateFn` | LLM plan generation |

This pattern keeps core logic pure while allowing runtime to wire real implementations.

---

## 10. CLI Commands

| Command | Description |
|---------|-------------|
| `ai-engine run <pipeline.yaml> <input>` | Run a pipeline |
| `ai-engine ingest <path>` | Ingest documents into FAISS index |
| `ai-engine query "<question>"` | Query the knowledge base |
| `ai-engine eval --dataset <file>` | Evaluate retrieval and generation quality |
| `ai-engine generate-proposal --client <n>` | Generate a structured proposal |
| `ai-engine namespaces` | List available namespaces |
| `ai-engine agent run <n> --namespace <ns>` | Run a named agent |
| `ai-engine tools list` | List available tools |
| `ai-engine planner simulate --task <desc>` | Simulate a tool execution plan |

---

## 11. Plugin System Rules

Plugins are first-class citizens.

Every plugin must:
- Declare a manifest
- Implement a known interface
- Be version-compatible with the SDK
- Fail safely if incompatible

Plugins must not:
- Access internal core state
- Depend on other plugins implicitly
- Assume cloud or SaaS context

---

## 12. Pipeline Rules

Pipelines are:
- Declarative
- Config-driven
- Order-sensitive
- Environment-agnostic

Pipelines must not:
- Hardcode providers
- Assume specific document types
- Embed secrets or credentials

---

## 13. AI Provider Rules

AI providers are adapters, not dependencies.

Rules:
- Core never knows which provider is used
- Processors receive providers via context
- Providers can be mocked for tests
- Vendor lock-in is treated as a bug

Python subprocess bridge: JSON over stdin/stdout for LLM calls. Uses `plugins/shared/providers/` factory.

---

## 14. Configuration and Memory

### Config Layer

Cascading resolution: global → org → namespace → user → invocation overrides.

`ConfigResolver` takes a `ConfigLoader` (injected `ReadFileFn`). Pure resolution logic in core.

### Memory Layer

Layered: org → namespace → user. Episodic arrays concatenated.

`MemoryRegistry` takes a `MemoryStore` interface. `FileMemoryStore` is the runtime implementation.

### Provider Policy

Per-namespace provider routing via `withProviderEnv` / `executeWithPolicy`.

---

## 15. Services (Adapters)

### `services/api`
- Fastify REST API
- Routes: `/agent/run`, `/agent/list`, `/tools/list`, ingest, query, proposals
- Auth hooks, audit hooks, multipart upload support
- Wires concrete tool implementations with real side effects
- Chat V2 entry point: `services/api/src/chat/` (see the Chat V2 section at the top of this file)

### `services/ui`
- Next.js frontend
- Proposal editing, section locking, version history
- Calls API for agent execution
- Chat page renders inline editable proposal section blocks (`ProposalSectionBlock`)

Services are **adapters** — they wire runtime dependencies and expose them over HTTP/UI.

---

## 16. Open Source Readiness

This repository must remain open-source compatible.

Forbidden concepts:
- Multi-tenancy
- Billing
- Authentication
- Authorization
- User accounts
- Cloud-specific assumptions

These belong in downstream systems.

---

## 17. Testing Expectations

- Core logic must have unit tests
- Plugins must have at least one happy-path test
- CLI commands must be smoke-tested
- Deterministic behavior is mandatory

No feature is complete without tests.

---

## 18. Workspace and Build

- Package manager: **pnpm** with workspace protocol (`workspace:*`)
- Module system: **ESM** (`"type": "module"` in all packages)
- TypeScript: **project references** (`tsconfig.json` with `references` array)
- Build: `npx tsc -b <package-path>`
- Workspace config: `pnpm-workspace.yaml`

### Adding a New Package

1. Create directory under the appropriate parent (`packages/`, `packages/tools/`, `agents/`)
2. Add `package.json` with `"type": "module"`, dependencies via `workspace:*`
3. Add `tsconfig.json` extending `../../tsconfig.base.json` with project references
4. Run `pnpm install` to link workspace
5. Add as dependency + tsconfig reference in consuming packages (CLI, API)

---

## 19. Contribution Discipline

When adding a feature, ask:

1. Is this core logic or an adapter?
2. Does this belong in core, runtime, or CLI?
3. Could this be a plugin instead?
4. Does this reduce future flexibility?
5. Does it use dependency injection for side effects?
6. Does the agent use tools (not direct I/O)?
7. Does the agent support both planner and manual fallback?

If unsure, stop and redesign.

---

## 20. Non-Goals

This project is NOT:
- A SaaS platform
- A UI framework
- A workflow orchestrator for cloud jobs
- A vendor-specific AI wrapper

Keep the scope tight.

---

## 21. Final Rule

> If a feature makes the system harder to extend, test, or reason about, it is the wrong feature.

Design for the next five years, not the next demo.

---
