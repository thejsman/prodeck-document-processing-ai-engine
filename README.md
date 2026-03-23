# AI Engine Document Processing

A CLI-first, open-source AI document processing engine. It runs locally, supports arbitrary document types, executes configurable pipelines, and is extensible via plugins — with no coupling to any cloud, SaaS, or vendor.

## Repository layout

```
packages/
  types/              Shared TypeScript type definitions (contracts only)
  core/               Pure logic: agents, tools, pipelines, config, memory, registries
  runtime/            Side effects: filesystem, plugin loading, config loading, storage
  cli/                CLI adapter: argument parsing, command routing, output formatting
  plugin-sdk/         Public SDK for plugin authors
  planner/            Multi-step tool execution planner (injected LLM function)
  layout-engine/      Deterministic content → MDX layout conversion
  pipelines/          Built-in pipeline YAML definitions
  providers/
    anthropic/        Anthropic provider adapter
    openai/           OpenAI provider adapter
    local/            Local/Ollama provider adapter
  tools/
    extract-section/  Extract named sections from markdown (pure)
    search-documents/ FAISS RAG document search (injected queryFn)
    generate-mermaid/ LLM-based Mermaid diagram generation (injected generateFn)
    generate-content/ LLM-based content generation (injected generateFn)
    save-asset/       File persistence via injected storage provider

agents/
  proposal-section-agent/     Regenerate individual proposal sections
  microsite-generator-agent/  Convert proposals to presentation microsites (MDX)

plugins/                Reference plugin implementations (extractors, processors, presenters)
  extractor-pdf/
  extractor-audio/
  processor-summarize/
  processor-local-ollama/
  processor-local-rag-ollama/
  processor-local-faiss-rag/
  processor-langchain-summarize/
  processor-proposal-generator/
  python-processor-template/
  exporter-json/
  shared/

services/
  api/                Fastify REST API adapter (auth, RBAC, audit, provider routing)
  ui/                 Next.js UI adapter (proposal editing, section locking, version history)

deployment/           Docker Compose blueprint for on-prem deployment
config/               Configuration files (API keys, provider policy)
docs/                 Architecture and feature documentation
examples/             Runnable pipeline examples
```

---

## Quick start

```bash
# Install and build
pnpm install
pnpm build

# Pull models (requires Ollama running locally)
ollama pull mistral
ollama pull nomic-embed-text

# Ingest documents into a namespace
node packages/cli/dist/index.js ingest ./docs --namespace default

# Query the knowledge base
node packages/cli/dist/index.js query "What is this project about?"

# List namespaces
node packages/cli/dist/index.js namespaces

# Evaluate retrieval quality
node packages/cli/dist/index.js eval --dataset eval.json --namespace default

# Generate a proposal
node packages/cli/dist/index.js generate-proposal \
  --client "Acme Corp" --industry "Technology" \
  --team-size 5 --duration-weeks 12 --rate-per-week 2500

# Run a named agent
node packages/cli/dist/index.js agent run microsite-generator --namespace default

# List available tools
node packages/cli/dist/index.js tools list

# Simulate a tool execution plan
node packages/cli/dist/index.js planner simulate --task "Extract and summarize the approach section"

# Run a pipeline
node packages/cli/dist/index.js run examples/generic-documents/pipeline.yaml ./docs \
  --plugins plugins/extractor-pdf \
  --plugins plugins/processor-summarize \
  --plugins plugins/exporter-json

# Interactive mode
node packages/cli/dist/index.js
```

## CLI commands

| Command                                       | Description                               |
| --------------------------------------------- | ----------------------------------------- |
| `ai-engine run <pipeline> <input>`            | Execute a pipeline                        |
| `ai-engine ingest <path>`                     | Ingest documents into FAISS index         |
| `ai-engine query "<question>"`                | Query the knowledge base                  |
| `ai-engine eval --dataset <file>`             | Evaluate retrieval & generation quality   |
| `ai-engine generate-proposal --client <n>`    | Generate a structured proposal            |
| `ai-engine namespaces`                        | List available namespaces                 |
| `ai-engine agent run <name> --namespace <ns>` | Run a named agent                         |
| `ai-engine tools list`                        | List all registered tools                 |
| `ai-engine planner simulate --task <desc>`    | Simulate a multi-step tool execution plan |
| `ai-engine` (no args)                         | Enter interactive REPL mode               |

## Agent system

Agents are task workers that orchestrate tools to accomplish goals. Each agent:

- Implements the `Agent` interface from `@ai-engine/core`
- Receives tools, planner, config, and memory via `AgentInput`
- Accesses side effects exclusively through tools (no direct I/O)
- Supports both planner-driven and manual tool execution

| Agent                       | Package                                | Description                                                            |
| --------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| `proposal-section-agent`    | `@ai-engine/agent-proposal-section`    | Regenerate a named section of a proposal                               |
| `microsite-generator-agent` | `@ai-engine/agent-microsite-generator` | Convert proposal markdown to a presentation microsite (MDX + diagrams) |

## Tool system

Tools are deterministic, single-purpose operations registered in `ToolRegistry`. Side effects are injected via constructor — tools never access the filesystem or network directly.

| Tool               | Package                            | Side Effects                 | Purpose                              |
| ------------------ | ---------------------------------- | ---------------------------- | ------------------------------------ |
| `extract-section`  | `@ai-engine/tool-extract-section`  | None (pure)                  | Extract named sections from markdown |
| `search-documents` | `@ai-engine/tool-search-documents` | `queryFn` injected           | FAISS RAG document search            |
| `generate-mermaid` | `@ai-engine/tool-generate-mermaid` | `generateFn` injected        | LLM-based Mermaid diagram generation |
| `generate-content` | `@ai-engine/tool-generate-content` | `generateFn` injected        | LLM-based content generation         |
| `save-asset`       | `@ai-engine/tool-save-asset`       | `storageProviderFn` injected | Persist files to local or S3 storage |

## API service

The API service (`services/api/`) wraps the engine with HTTP endpoints, API-key authentication, namespace-based RBAC, audit logging, and an optional provider routing policy layer.

```bash
# Configure API keys
cp config/api_keys.example.json config/api_keys.json

# Start (basic)
node services/api/dist/index.js

# Start with provider routing policy
PROVIDER_POLICY_PATH=config/provider_policy.json node services/api/dist/index.js
```

| Method | Path          | Description                       |
| ------ | ------------- | --------------------------------- |
| `GET`  | `/health`     | Health check                      |
| `POST` | `/ingest`     | Ingest documents into a namespace |
| `POST` | `/query`      | Query a namespace                 |
| `GET`  | `/namespaces` | List accessible namespaces        |
| `POST` | `/agent/run`  | Run a named agent                 |
| `GET`  | `/agent/list` | List registered agents            |
| `GET`  | `/tools/list` | List registered tools             |

## UI service

The UI service (`services/ui/`) is a Next.js 15 + React 19 frontend with:

- Proposal editing via a rich text editor (TipTap)
- Section locking and version history
- Mermaid diagram rendering
- Calls the API service for agent execution

## Docker deployment

```bash
cd deployment
cp .env.example .env
docker compose up
```

See [deployment/README.md](deployment/README.md) for details.

## Documentation

- [Feature reference](docs/FEATURES.md) — every feature with architecture and usage
- [Architecture](docs/architecture.md) — package structure and data flow
- [CLI usage](docs/cli.md) — complete command reference
- [Pipeline authoring](docs/pipelines.md) — YAML pipeline format
- [Plugin authoring](docs/plugin-authoring.md) — writing custom plugins
- [Deployment guide](deployment/README.md) — Docker Compose on-prem setup
