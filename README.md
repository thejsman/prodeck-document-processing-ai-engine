# AI Engine Document Processing

A CLI-first, open-source AI document processing engine. It runs locally, supports arbitrary document types, executes configurable pipelines, and is extensible via plugins without coupling to any cloud, SaaS, or vendor.

## Repository layout

```
packages/
  types/           Shared TypeScript type definitions
  core/            Pipeline schema, validation, plugin registry
  runtime/         Pipeline runner, plugin loader, knowledge bridge
  cli/             CLI entry point and command handlers
  plugin-sdk/      SDK for plugin authors
  providers/       AI provider adapter stubs
plugins/           Reference plugin implementations
  processor-proposal-generator/  Proposal generation with templates + pricing
  processor-local-faiss-rag/     Persistent FAISS RAG + eval runner
  ...
services/
  api/             HTTP API with auth, RBAC, audit, and provider routing
deployment/        Docker Compose blueprint for on-prem deployment
config/            Configuration files (API keys, provider policy)
docs/              Architecture and feature documentation
examples/          Runnable pipeline examples
```

---

## Quick start

```bash
# Install
pnpm install
pnpm build

# Pull models (requires Ollama running locally)
ollama pull mistral
ollama pull nomic-embed-text

# Ingest documents
node packages/cli/dist/index.js ingest ./docs --namespace default

# Query
node packages/cli/dist/index.js query "What is this project about?"

# List namespaces
node packages/cli/dist/index.js namespaces

# Evaluate retrieval quality
node packages/cli/dist/index.js eval --dataset eval.json --namespace default

# Generate a proposal
node packages/cli/dist/index.js generate-proposal \
  --client "Acme Corp" --industry "Technology" \
  --team-size 5 --duration-weeks 12 --rate-per-week 2500

# Run a pipeline
node packages/cli/dist/index.js run examples/generic-documents/pipeline.yaml ./docs \
  --plugins plugins/extractor-pdf \
  --plugins plugins/processor-summarize \
  --plugins plugins/exporter-json

# Interactive mode
node packages/cli/dist/index.js
```

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

Endpoints:

| Method | Path          | Description                       |
| ------ | ------------- | --------------------------------- |
| `GET`  | `/health`     | Health check                      |
| `POST` | `/ingest`     | Ingest documents into a namespace |
| `POST` | `/query`      | Query a namespace                 |
| `GET`  | `/namespaces` | List accessible namespaces        |

The provider routing policy (`config/provider_policy.json`) enables per-namespace, per-operation provider selection with automatic fallback. See [docs/FEATURES.md](docs/FEATURES.md) for full documentation.

## Docker deployment

```bash
cd deployment
cp .env.example .env
docker compose up
```

See [deployment/README.md](deployment/README.md) for details.

## CLI commands

| Command                                    | Description                             |
| ------------------------------------------ | --------------------------------------- |
| `ai-engine run <pipeline> <input>`         | Execute a pipeline                      |
| `ai-engine ingest <path>`                  | Ingest documents into FAISS index       |
| `ai-engine query "<question>"`             | Query the knowledge base                |
| `ai-engine eval --dataset <file>`          | Evaluate retrieval & generation quality |
| `ai-engine generate-proposal --client <n>` | Generate a structured proposal          |
| `ai-engine namespaces`                     | List available namespaces               |
| `ai-engine` (no args)                      | Enter interactive mode                  |

## Documentation

- [Feature reference](docs/FEATURES.md) — every feature with architecture and usage
- [Architecture](docs/architecture.md) — package structure and data flow
- [CLI usage](docs/cli.md) — complete command reference
- [Pipeline authoring](docs/pipelines.md) — YAML pipeline format
- [Plugin authoring](docs/plugin-authoring.md) — writing custom plugins
- [Deployment guide](deployment/README.md) — Docker Compose on-prem setup
