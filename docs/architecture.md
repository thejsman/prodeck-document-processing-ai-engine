# Architecture

## Package dependency graph

```
   ┌──────────────┐        ┌────────────────┐
   │ packages/cli │        │ services/api   │
   │ (CLI adapter)│        │ (HTTP adapter) │
   └──────┬───────┘        └───────┬────────┘
          │                        │
          └──────────┬─────────────┘
                     │
          ┌──────────▼──────────────┐
          │   packages/runtime      │  Side effects boundary
          │                         │
          │  Plugin Loader          │
          │  Pipeline Runner        │
          │  Python Processor Runner│
          │  Knowledge Bridge       │
          │  Storage (local / S3)   │
          │  Config Loader          │
          │  File Memory Store      │
          └──────────┬──────────────┘
                     │
          ┌──────────▼──────────────┐
          │   packages/core         │  Pure logic
          │                         │
          │  AgentRegistry          │
          │  AgentRunner            │
          │  ToolRegistry           │
          │  ConfigResolver         │
          │  MemoryRegistry         │
          │  Pipeline Validator     │
          │  Domain Errors          │
          └──────────┬──────────────┘
                     │
          ┌──────────▼──────────────┐
          │   packages/types        │  Contracts only (interfaces, no logic)
          └─────────────────────────┘
```

Agents and tools depend on core and types only. The runtime wires concrete
implementations (storage, LLM functions, knowledge bridge) at startup and
injects them into agents and tools.

```
agents/*  ──────────────────────────────────────────┐
packages/tools/*  ──────────────────────────────────┤
packages/planner  ──────────────────────────────────┤
packages/layout-engine  ────────────────────────────┤
                                                     ▼
                                          packages/core + packages/types
```

The planner and layout engine are also pure — they receive injected functions
(e.g., `GenerateFn`) from the CLI or API layer.

## Key boundaries

### types (packages/types)

Interfaces and type definitions only. No imports from other packages.
Treated as a public API — breaking changes require a major version bump.

### core (packages/core)

Pure logic. No file system, no network, no environment variables.

Contains:
- `AgentRegistry` / `AgentRunner` — agent orchestration
- `ToolRegistry` — tool registration and fail-fast lookup
- `ConfigResolver` — cascading config resolution (pure)
- `MemoryRegistry` — layered memory resolution
- Pipeline validation and schema
- Domain errors (`PipelineValidationError`, `PluginRegistryError`)

### runtime (packages/runtime)

The boundary between pure logic and the real world. Handles all side effects.

| Module | Responsibility |
|--------|---------------|
| `loader/plugin-loader.ts` | Discover and validate plugins from disk |
| `loader/pipeline-loader.ts` | Parse YAML pipeline files |
| `execution/pipeline-runner.ts` | Execute pipeline steps sequentially |
| `execution/python-processor-runner.ts` | Bridge to Python processor plugins |
| `knowledge/knowledge-bridge.ts` | Bridge to FAISS knowledge store |
| `storage/local-storage-provider.ts` | Local filesystem storage |
| `storage/s3-storage-provider.ts` | AWS S3 storage |
| `config/node-config-loader.ts` | Filesystem-based config loading |
| `memory/file-memory-store.ts` | Persistent episodic memory |

### planner (packages/planner)

Multi-step tool execution planning. Receives an injected `GenerateFn` for LLM
calls — no direct model access.

```
generatePlan(input, generateFn) → Plan
executePlan(plan, toolRegistry) → PlanExecutionResult
```

### layout-engine (packages/layout-engine)

Deterministic, pure conversion of content sections to MDX presentations.

```
InputSections
  → planLayout(sections, designConfig?) → LayoutPlan
  → composeMDX(plan) → MDX string
```

Components: `Hero`, `TwoColumn`, `ArchitectureDiagram`, `FeatureGrid`,
`Timeline`, `Section`.

Rule resolution order: explicit name match → content heuristic → default.

### CLI (packages/cli)

Argument parsing, command routing, output formatting. No business logic.

### API service (services/api)

HTTP adapter with authentication, RBAC, and audit logging. No business logic.

### UI service (services/ui)

Next.js 15 frontend. Calls the API service for all agent execution. No
business logic.

## Data flow

### Agent execution (CLI `agent run` / API `POST /agent/run`)

```
CLI/API
  → AgentRunner (core)
    → resolve config (ConfigResolver)
    → resolve memory (MemoryRegistry)
    → enrich AgentInput (tools, planner, config, memory)
    → Agent.run(input)
      → input.tools.get("tool-name").run(...)
      → input.planner?.generatePlan(...) + executePlan(...)
  → AgentOutput { markdown?, json?, assets? }
```

### Pipeline execution (CLI `run`)

```
Input file → Plugin Loader → Pipeline Loader → Pipeline Runner
  → Extract step (plugin) → Process step (plugin) → Export step (plugin)
  → Output file
```

### Knowledge operations (`ingest` / `query`)

```
CLI/API → @ai-engine/runtime knowledge bridge
  → spawn python3 knowledge_store.py
  → FAISS vector store (disk)
  → LLM provider (Ollama or OpenAI)
  → JSON result
```

## Plugin system

Plugins are loaded at runtime from directories. Each plugin requires:

- `plugin.json` — manifest (name, type, apiVersion, entry)
- `dist/index.js` — compiled entry point with default export
- Optional Python scripts spawned by the TypeScript adapter

Plugin types: `extractor`, `processor`, `exporter`.

## Tool system

Tools are registered in `ToolRegistry` at startup. Side effects (filesystem,
network, LLM) are injected via constructor. `ToolRegistry.get()` throws on a
missing tool name (fail-fast).

```
CLI/API wires concrete tool instances
  → registers in ToolRegistry
  → AgentRunner injects registry into AgentInput
  → Agent calls input.tools.get("extract-section").run(...)
```

## Dependency injection pattern

| Component | Injected via | Purpose |
|-----------|-------------|---------|
| `ConfigLoader` | `ReadFileFn` constructor arg | Read config files |
| `UsageRecorder` | `appendLine` constructor arg | Append usage events |
| `SearchDocumentsTool` | `queryFn` constructor arg | FAISS RAG queries |
| `GenerateMermaidTool` | `generateFn` constructor arg | LLM diagram generation |
| `GenerateContentTool` | `generateFn` constructor arg | LLM content generation |
| `SaveAssetTool` | `storageProviderFn` constructor arg | File persistence |
| `generatePlan()` | `GenerateFn` parameter | LLM plan generation |

## Namespace isolation

Knowledge is stored per namespace at `<workdir>/namespaces/<name>/`:

```
workdir/
  namespaces/
    default/
      index.faiss
      chunks.json
    legal/
      index.faiss
      chunks.json
```

Each namespace is an independent FAISS index. The API service enforces access
control per namespace via API keys.

Storage assets (from `save-asset` tool) follow the same namespace structure,
supporting both local filesystem and S3 backends.
