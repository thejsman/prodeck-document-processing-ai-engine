# Architecture

## Package dependency graph

```
                    ┌──────────────┐
                    │ packages/cli │  CLI adapter
                    └──────┬───────┘
                           │
              ┌────────────▼─────────────┐
              │   packages/runtime       │  Side effects boundary
              │                          │
              │  Pipeline Runner         │
              │  Plugin Loader           │
              │  Python Processor Runner │
              │  Knowledge Bridge        │
              └────────────┬─────────────┘
                           │
              ┌────────────▼─────────────┐
              │    packages/core         │  Pure logic
              │                          │
              │  Pipeline Validator      │
              │  Pipeline Registry       │
              │  Processor/Extractor/    │
              │    Exporter Registries   │
              └────────────┬─────────────┘
                           │
              ┌────────────▼─────────────┐
              │   packages/types         │  Contracts only
              └──────────────────────────┘
```

The API service sits alongside the CLI as an adapter:

```
   ┌──────────────┐        ┌────────────────┐
   │ packages/cli │        │ services/api   │
   │ (CLI adapter)│        │ (HTTP adapter) │
   └──────┬───────┘        └───────┬────────┘
          │                        │
          └──────────┬─────────────┘
                     │
          ┌──────────▼──────────────┐
          │   packages/runtime      │
          │   (shared logic)        │
          └─────────────────────────┘
```

Both adapters import the same functions from `@ai-engine/runtime`.
Neither contains business logic.

## Key boundaries

### Core (packages/core)

Pure logic. No file system, no network, no environment variables.
Contains pipeline validation, schema definitions, and plugin registries.

### Runtime (packages/runtime)

The boundary between pure logic and the real world.
Handles file system access, plugin loading, subprocess execution,
and the knowledge bridge to Python.

Key modules:

| Module | Responsibility |
|--------|---------------|
| `loader/plugin-loader.ts` | Discover and validate plugins from disk |
| `loader/pipeline-loader.ts` | Parse YAML pipeline files |
| `execution/pipeline-runner.ts` | Execute pipeline steps sequentially |
| `execution/python-processor-runner.ts` | Bridge to Python processor plugins |
| `knowledge/knowledge-bridge.ts` | Bridge to FAISS knowledge store |

### CLI (packages/cli)

Argument parsing, command routing, output formatting.
Delegates all operations to runtime. No business logic.

Commands: `run`, `ingest`, `query`, `namespaces`.

### API Service (services/api)

HTTP adapter with authentication, RBAC, and audit logging.
Delegates all operations to runtime. No business logic.

Routes: `POST /ingest`, `POST /query`, `GET /namespaces`, `GET /health`.

## Data flow

### Pipeline execution (CLI `run` command)

```
Input file → Plugin Loader → Pipeline Loader → Pipeline Runner
  → Extract step (plugin) → Process step (plugin) → Export step (plugin)
  → Output file
```

### Knowledge operations (CLI `ingest`/`query`, API `/ingest`/`/query`)

```
CLI/API → @ai-engine/runtime knowledge bridge
  → spawn python3 knowledge_store.py
  → FAISS vector store (disk)
  → LLM provider (Ollama or OpenAI)
  → JSON result
```

## Plugin system

Plugins are loaded at runtime from directories. Each plugin has:

- `plugin.json` — manifest (name, type, apiVersion, entry)
- `dist/index.js` — compiled entry point with default export
- Optional Python scripts spawned by the TypeScript adapter

Plugin types: `extractor`, `processor`, `exporter`.

## Namespace isolation

Knowledge is stored in `<workdir>/namespaces/<name>/`:

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

Each namespace is an independent FAISS index. The API service enforces
access control per namespace via API keys.
