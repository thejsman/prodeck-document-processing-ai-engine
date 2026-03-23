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

### `eval` — Evaluate retrieval and generation quality

```
ai-engine eval [options]
```

| Flag | Description |
|------|-------------|
| `--dataset <file>` | JSON file with evaluation questions and expected answers |
| `--namespace <name>` | Namespace to evaluate (default: `default`) |
| `--workdir <path>` | Working directory (default: cwd) |

### `generate-proposal` — Generate a structured proposal

```
ai-engine generate-proposal [options]
```

| Flag | Description |
|------|-------------|
| `--client <name>` | Client name |
| `--industry <name>` | Industry vertical |
| `--team-size <n>` | Number of team members |
| `--duration-weeks <n>` | Project duration in weeks |
| `--rate-per-week <n>` | Weekly rate in dollars |
| `--namespace <name>` | Namespace for context retrieval |

### `agent run` — Run a named agent

```
ai-engine agent run <agent-name> [options]
```

| Flag | Description |
|------|-------------|
| `--namespace <name>` | Namespace for context and storage |
| `--prompt <text>` | Task prompt passed to the agent |
| `--config <key=value>` | Config overrides (repeatable) |

Agents are registered at startup. Use `agent list` to see available agents.

```bash
ai-engine agent run microsite-generator --namespace acme --prompt "Convert proposal to microsite"
ai-engine agent run proposal-section-agent --namespace acme
```

Available agents:

| Agent | Description |
|-------|-------------|
| `proposal-section-agent` | Regenerate a named section of a proposal |
| `microsite-generator-agent` | Convert proposal markdown to a presentation microsite |

### `tools list` — List available tools

```
ai-engine tools list
```

Lists all tools registered in `ToolRegistry` with their names and descriptions.

```bash
ai-engine tools list
# extract-section   Extract named sections from markdown
# search-documents  Search the FAISS knowledge base
# generate-mermaid  Generate a Mermaid diagram via LLM
# generate-content  Generate or enhance content via LLM
# save-asset        Save a file to namespace storage
```

### `planner simulate` — Simulate a tool execution plan

```
ai-engine planner simulate [options]
```

| Flag | Description |
|------|-------------|
| `--task <description>` | Natural-language description of the task to plan |
| `--namespace <name>` | Namespace for context |

Generates and prints a multi-step tool execution plan without running it.
Useful for verifying that the planner produces sensible steps before committing
to a full agent run.

```bash
ai-engine planner simulate --task "Extract the approach section and generate a diagram"
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
- `agent run` outputs markdown and/or JSON to stdout; assets are saved to namespace storage
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
| `PROVIDER_POLICY_PATH` | — | Path to provider routing policy JSON (API service) |
