# CLI Usage

## Installation

```bash
pnpm install
pnpm build
```

The CLI binary is at `packages/cli/dist/index.js`. All commands below assume:

```bash
alias ai-engine="node packages/cli/dist/index.js"
```

## Commands

### `run` — Execute a pipeline

```
ai-engine run <pipeline.yaml> <inputPath> [options]
```

| Flag | Description |
|------|-------------|
| `--plugins <path>` | Plugin directory (repeatable) |
| `--workdir <path>` | Working directory (default: cwd) |
| `--stream` | Stream AI output as it generates |

Input can be a single file or a directory (processes all non-hidden files).
Output is written to `<workdir>/output/<runId>/`.

```bash
ai-engine run examples/generic-documents/pipeline.yaml ./docs \
  --plugins plugins/extractor-pdf \
  --plugins plugins/processor-summarize \
  --plugins plugins/exporter-json
```

### `ingest` — Ingest documents

```
ai-engine ingest <path> [options]
```

| Flag | Description |
|------|-------------|
| `--workdir <path>` | Directory for index storage (default: cwd) |
| `--namespace <name>` | Namespace for index isolation (default: `default`) |

Recursively collects text files (40+ supported extensions) and indexes them
into a FAISS vector store at `<workdir>/namespaces/<namespace>/`.

```bash
ai-engine ingest ./legal-docs --namespace legal
```

### `query` — Query the knowledge base

```
ai-engine query "<question>" [options]
```

| Flag | Description |
|------|-------------|
| `--workdir <path>` | Directory containing the FAISS index (default: cwd) |
| `--namespace <name>` | Namespace to query (default: `default`) |
| `--stream` | Stream the answer as it generates |

```bash
ai-engine query "What are the key findings?" --namespace research
ai-engine query "Summarize the contracts" --namespace legal --stream
```

### `namespaces` — List available namespaces

```
ai-engine namespaces [options]
```

| Flag | Description |
|------|-------------|
| `--workdir <path>` | Directory containing namespaces (default: cwd) |

Lists all namespaces that contain a valid FAISS index.

```bash
ai-engine namespaces
# default
# legal
# research
```

### Interactive mode

```
ai-engine [--stream]
```

Starts a REPL with command history. Supports all commands above plus:

- Type a file path to process it with the default pipeline
- `help` — show available commands
- `exit` — quit

## Output

- `run` writes results to `<workdir>/output/<runId>/`
- `ingest` and `query` write to stdout
- Log messages go to stderr with `[info]` and `[error]` prefixes

## Environment variables

The CLI delegates to Python plugins that read these variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `ollama` | `ollama` or `openai` |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_GENERATION_MODEL` | `mistral` | Generation model |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model |
| `OPENAI_API_KEY` | — | Required when `LLM_PROVIDER=openai` |
| `OPENAI_GENERATION_MODEL` | `gpt-4o-mini` | OpenAI generation model |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI embedding model |
